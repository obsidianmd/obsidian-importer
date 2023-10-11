import { Notice, Platform, Setting, TAbstractFile, TFile, TFolder } from 'obsidian';
import { NoteConverter } from './apple-notes/convert-note';
import { ANAccount, ANAttachment, ANDocument, ANFolderType } from './apple-notes/models';
import { descriptor } from './apple-notes/descriptor';
import { ImportContext } from '../main';
import { fs, os, path, splitext } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ungzip } from 'pako';
import { Root, Message } from 'protobufjs';
import SQLiteTagSpawned from 'sqlite-tag-spawned';

const NOTE_FOLDER_PATH = 'Library/Group Containers/group.com.apple.notes';
const NOTE_DB = 'NoteStore.sqlite';
/** Additional amount of seconds that Apple CoreTime datatypes start at, to convert them into Unix timestamps. */
const CORETIME_OFFSET = 978307200; 

const ROOT_DOC = Root.fromJSON(descriptor);

export class AppleNotesImporter extends FormatImporter {
	rootFolder: TFolder;
	ctx: ImportContext;
	attachmentPath: string;
	
	database: SQLiteTagSpawned;
	resolvedAccounts: Record<number, ANAccount> = {};
	resolvedFiles: Record<number, TAbstractFile | TFolder> = {};
	
	multiAccount = false;
	noteCount = 0;
	parsedNotes = 0;
	
	omitFirstLine = true;
	importTrashed = false;
	trashFolder = -1;
	
	init(): void {
		if (!Platform.isMacOS) {
			this.modal.contentEl.createEl('p', { text:
				'Due to platform limitations, Apple Notes cannot be exported from this device.' +
				' Open your vault on a Mac to export from Apple Notes.'
			});

			this.notAvailable = true;
			return;
		}
		
		this.addOutputLocationSetting('Apple Notes');
		
		new Setting(this.modal.contentEl)
			.setName('Import recently deleted notes')
			.setDesc(
				'Import notes in the "Recently Deleted" folder. Unlike in Apple Notes' +
				', they will not be automatically removed after a set amount of time.'
			)
			.addToggle(t => t
				.setValue(false)
				.onChange(async v => this.importTrashed = v)
			);
			
		new Setting(this.modal.contentEl)
			.setName('Omit first line')
			.setDesc(
				'Don\'t include the first line in the text, since Apple Notes uses it' +
				' as the title. It will still be used as the note name.'
			)
			.addToggle(t => t
				.setValue(true)
				.onChange(async v => this.omitFirstLine = v)
			);
	}
	
	async getNotesDatabase(): Promise<SQLiteTagSpawned | null> {
		const dataPath = path.join(os.homedir(), NOTE_FOLDER_PATH);
		
		const names = window.electron.remote.dialog.showOpenDialogSync({
			defaultPath: dataPath,
			properties: ['openDirectory'],
			//see https://developer.apple.com/videos/play/wwdc2019/701/
			message: 'Select the "group.com.apple.notes" folder to allow Obsidian to read Apple Notes data.'
		});
		
		if (!names?.includes(dataPath)) {
			new Notice('Data import failed. Ensure you have selected the correct Apple Notes data folder.');
			return null;
		}
				
		const originalDB = path.join(dataPath, NOTE_DB);
		const clonedDB = path.join(os.tmpdir(), NOTE_DB);

		fs.copyFileSync(originalDB, clonedDB);
		fs.copyFileSync(originalDB + '-shm', clonedDB + '-shm');
		fs.copyFileSync(originalDB + '-wal', clonedDB + '-wal');

		return new SQLiteTagSpawned(clonedDB, { readonly: true, persistent: true });
	}

	async import(ctx: ImportContext): Promise<void> {
		this.ctx = ctx;
		this.rootFolder = await this.getOutputFolder() as TFolder;
		this.attachmentPath = this.getAttachmentPath();
		
		if (!this.rootFolder) {
			new Notice('Please select a location to export to.');
			return;
		}
		
		this.database = await this.getNotesDatabase() as SQLiteTagSpawned;
		if (!this.database) return;
				
		const noteAccounts = await this.database.all`
			SELECT z_pk FROM ziccloudsyncingobject WHERE z_ent = 13 /* account entity */
		`;
		const noteFolders = await this.database.all`
			SELECT z_pk FROM ziccloudsyncingobject WHERE z_ent = 14 /* folder entity */
		`;
		
		for (let a of noteAccounts) await this.resolveAccount(a.Z_PK);
		for (let f of noteFolders) await this.resolveFolder(f.Z_PK);
		
		const notes = await this.database.all`
			SELECT
				z_pk, zfolder, ztitle1 FROM ziccloudsyncingobject 
			WHERE
				z_ent = 11 /* Note entity */
				AND ztitle1 IS NOT NULL
				AND zfolder != ${this.trashFolder}
		`;
		this.noteCount = notes.length;
		
		for (let n of notes) {
			try { 
				await this.resolveNote(n.Z_PK); 
			}
			catch (e) { 
				this.ctx.reportFailed(n.ZTITLE1, e?.message); 
			}
		}
	}
	
	async resolveAccount(id: number): Promise<void> {
		if (!this.multiAccount && Object.keys(this.resolvedAccounts).length) {
			this.multiAccount = true;
		}
		
		const account = await this.database.get`
			SELECT zname, zidentifier FROM ziccloudsyncingobject
			WHERE z_ent = 13 AND z_pk = ${id}
		`;
			
		this.resolvedAccounts[id] = {
			name: account.ZNAME,
			uuid: account.ZIDENTIFIER
		};
	}
	
	async resolveFolder(id: number): Promise<void> {
		if (id in this.resolvedFiles) return;
		
		const folder = await this.database.get`
			SELECT ztitle2, zparent, zidentifier, zfoldertype, zowner
			FROM ziccloudsyncingobject
			WHERE z_ent = 14 AND z_pk = ${id}
		`;
		let prefix;
		
		if (folder.ZFOLDERTYPE == ANFolderType.Smart) {
			return;	
		}
		else if (!this.importTrashed && folder.ZFOLDERTYPE == ANFolderType.Trash) {
			this.trashFolder = id;
			return;	
		}
		else if (folder.ZPARENT !== null) {
			await this.resolveFolder(folder.ZPARENT);
			prefix = this.resolvedFiles[folder.ZPARENT].path + '/';
		}
		else if (this.multiAccount) {
			//if there's a parent, the account root is already handled by that
			const account = this.resolvedAccounts[folder.ZOWNER].name;
			prefix = `${this.rootFolder.path}/${account}/`;
		}
		else {
			prefix = `${this.rootFolder.path}/`;
		}
		
		if (folder.ZIDENTIFIER !== 'DefaultFolder-CloudKit') {
			//notes in the default "Notes" folder are placed in the main directory
			prefix += folder.ZTITLE2;
		}
		
		this.resolvedFiles[id] = await this.createFolders(prefix);
	}
	
	async resolveNote(id: number): Promise<void> {
		if (id in this.resolvedFiles) return;

		const row = await this.database.get`
			SELECT 
				nd.z_pk, hex(nd.zdata) as zhexdata, zcso.ztitle1, zfolder, 
				zcreationdate2, zcreationdate3, zmodificationdate1, zispasswordprotected
			FROM
				zicnotedata AS nd, 
				(SELECT *, NULL AS zcreationdate3 FROM ziccloudsyncingobject) AS zcso 
			WHERE
				zcso.z_pk = nd.znote
				AND zcso.z_pk = ${id}
		`;
		
		if (row.ZISPASSWORDPROTECTED) {
			this.ctx.reportSkipped(row.ZTITLE1, 'note is password protected');
			return;
		}
		
		const value = this.decodeData<ANDocument>(row.zhexdata).note;		
		const folder = this.resolvedFiles[row.ZFOLDER] as TFolder;
		const title = `${row.ZTITLE1}.md`;
		
		this.ctx.status(`Importing note ${title}`);
		this.resolvedFiles[id] = await this.saveAsMarkdownFile(folder, title, ''); 
		
		//notes may reference other notes, so we want them in resolvedFiles before we parse to avoid cycles
		const converter = new NoteConverter(this, value);
		
		this.vault.modify(this.resolvedFiles[id] as TFile, await converter.format(), { 
			ctime: this.decodeTime(row.ZCREATIONDATE3 || row.ZCREATIONDATE2),
			mtime: this.decodeTime(row.ZMODIFICATIONDATE1) 
		});
		
		this.parsedNotes++;
		this.ctx.reportProgress(this.parsedNotes, this.noteCount);
	}
	
	async resolveAttachment(id: number, uti: ANAttachment | string): Promise<void> {
		let sourcePath, outName, outExt, row;
		
		if (uti !== ANAttachment.Drawing) {
			row = await this.database.get`
				SELECT
					a.zidentifier, a.zfilename, a.zaccount6, a.zaccount5, 
					a.zgeneration1, b.zcreationdate, b.zmodificationdate
				FROM
					(SELECT *, NULL AS zaccount6, NULL AS zgeneration1 FROM ziccloudsyncingobject) AS a,
					ziccloudsyncingobject AS b
				WHERE
					a.z_ent = 10 /* drawing entity */
					AND a.z_pk = ${id} 
					AND a.z_pk = b.zmedia
			`;
			
			const account = row.ZACCOUNT6 || row.ZACCOUNT5;
			sourcePath = path.join(
				os.homedir(), NOTE_FOLDER_PATH, 'Accounts', this.resolvedAccounts[account].uuid, 
				'Media', row.ZIDENTIFIER, row.ZGENERATION1 || '', row.ZFILENAME
			);
			[outName, outExt] = splitext(row.ZFILENAME);
		}
		else {
			row = await this.database.get`
				SELECT
					zidentifier, zfallbackimagegeneration, zcreationdate, zmodificationdate, zaccount1
				FROM
					(SELECT *, NULL AS zaccount6, NULL AS zfallbackimagegeneration FROM ziccloudsyncingobject)
				WHERE
					z_ent = 4 /* attachment entity */
					AND z_pk = ${id} 
			`;
			
			sourcePath = path.join(
				os.homedir(), NOTE_FOLDER_PATH, 'Accounts', this.resolvedAccounts[row.ZACCOUNT1].uuid, 
				'FallbackImages', row.ZIDENTIFIER, row.ZFALLBACKIMAGEGENERATION || '', 'FallbackImage.png'
			);
			outName = 'Drawing', outExt = 'png';
		}
		
		this.resolvedFiles[id] = await this.vault.createBinary(
			//@ts-ignore
			this.app.vault.getAvailablePath(`${this.attachmentPath}/${outName}`, outExt), 
			fs.readFileSync(sourcePath), 
			{ ctime: this.decodeTime(row.ZCREATIONDATE), mtime: this.decodeTime(row.ZMODIFICATIONDATE) }
		);
		
		this.ctx.reportAttachmentSuccess(this.resolvedFiles[id].path);
	}
	
	decodeData<T extends Message>(hexdata: string, protobufType = 'ciofecaforensics.Document'): T {
		const converted = ungzip(Buffer.from(hexdata, 'hex'));
		return ROOT_DOC.lookupType(protobufType).decode(converted) as T;
	}
	
	decodeTime(timestamp: number): number {
		if (!timestamp || timestamp < 1) return new Date().getTime();
		return Math.floor((timestamp + CORETIME_OFFSET) * 1000);
	}
	
	getAttachmentPath(): string {
		let outPath = path.join(this.outputLocation, 'Attachments');
		
		if (this.app.vault.getConfig('attachmentFolderPath') !== '/') {
			outPath = path.join(
				this.app.vault.getConfig('attachmentFolderPath'), `${this.outputLocation} Attachments`
			);
		}
		
		this.createFolders(outPath);
		return outPath;
	}
}
