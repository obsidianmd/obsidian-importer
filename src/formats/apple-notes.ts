import { Notice, Platform, Setting, TFile, TFolder } from 'obsidian';
import { NoteConverter } from './apple-notes/convert-note';
import { ANAccount, ANAttachment, ANConverter, ANConverterType, ANFolderType } from './apple-notes/models';
import { descriptor } from './apple-notes/descriptor';
import { ImportContext } from '../main';
import { fsPromises, os, path, splitext, zlib } from '../filesystem';
import { sanitizeFileName } from '../util';
import { FormatImporter } from '../format-importer';
import { Root } from 'protobufjs';
import SQLiteTag from './apple-notes/sqlite/index';
import { SQLiteTagSpawned } from './apple-notes/models';

const NOTE_FOLDER_PATH = 'Library/Group Containers/group.com.apple.notes';
const NOTE_DB = 'NoteStore.sqlite';
/** Additional amount of seconds that Apple CoreTime datatypes start at, to convert them into Unix timestamps. */
const CORETIME_OFFSET = 978307200;

export class AppleNotesImporter extends FormatImporter {
	ctx: ImportContext;
	rootFolder: TFolder;

	database: SQLiteTagSpawned;
	protobufRoot: Root;

	keys: Record<string, number>;
	owners: Record<number, number> = {};
	resolvedAccounts: Record<number, ANAccount> = {};
	resolvedFiles: Record<number, TFile> = {};
	resolvedFolders: Record<number, TFolder> = {};

	multiAccount = false;
	noteCount = 0;
	parsedNotes = 0;

	omitFirstLine = true;
	importTrashed = false;
	includeHandwriting = false;
	trashFolders: number[] = [];

	init(): void {
		if (!Platform.isMacOS || !Platform.isDesktop) {
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

		new Setting(this.modal.contentEl)
			.setName('Include handwriting text')
			.setDesc(
				'When Apple Notes has detected handwriting in drawings, include it as text before the drawing.'
			)
			.addToggle(t => t
				.setValue(false)
				.onChange(async v => this.includeHandwriting = v)
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

		await fsPromises.copyFile(originalDB, clonedDB);
		await fsPromises.copyFile(originalDB + '-shm', clonedDB + '-shm');
		await fsPromises.copyFile(originalDB + '-wal', clonedDB + '-wal');

		//@ts-ignore
		return new SQLiteTag(clonedDB, { readonly: true, persistent: true });
	}

	async import(ctx: ImportContext): Promise<void> {
		this.ctx = ctx;
		this.protobufRoot = Root.fromJSON(descriptor);
		this.rootFolder = await this.getOutputFolder() as TFolder;

		if (!this.rootFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		this.database = await this.getNotesDatabase() as SQLiteTagSpawned;
		if (!this.database) return;

		this.keys = Object.fromEntries(
			(await this.database.all`SELECT z_ent, z_name FROM z_primarykey`).map(k => [k.Z_NAME, k.Z_ENT])
		);

		const noteAccounts = await this.database.all`
			SELECT z_pk FROM ziccloudsyncingobject WHERE z_ent = ${this.keys.ICAccount}
		`;
		const noteFolders = await this.database.all`
			SELECT z_pk, ztitle2 FROM ziccloudsyncingobject WHERE z_ent = ${this.keys.ICFolder}
		`;

		for (let a of noteAccounts) await this.resolveAccount(a.Z_PK);

		for (let f of noteFolders) {
			try {
				await this.resolveFolder(f.Z_PK);
			}
			catch (e) {
				this.ctx.reportFailed(f.ZTITLE2, e?.message);
				console.error(e);
			}
		}

		const notes = await this.database.all`
			SELECT
				z_pk, zfolder, ztitle1 FROM ziccloudsyncingobject
			WHERE
				z_ent = ${this.keys.ICNote}
				AND ztitle1 IS NOT NULL
				AND zfolder NOT IN (${this.trashFolders})
		`;
		this.noteCount = notes.length;

		for (let n of notes) {
			try {
				await this.resolveNote(n.Z_PK);
			}
			catch (e) {
				this.ctx.reportFailed(n.ZTITLE1, e?.message);
				console.error(e);
			}
		}

		this.database.close();
	}

	async resolveAccount(id: number): Promise<void> {
		if (!this.multiAccount && Object.keys(this.resolvedAccounts).length) {
			this.multiAccount = true;
		}

		const account = await this.database.get`
			SELECT zname, zidentifier FROM ziccloudsyncingobject
			WHERE z_ent = ${this.keys.ICAccount} AND z_pk = ${id}
		`;

		this.resolvedAccounts[id] = {
			name: account.ZNAME,
			uuid: account.ZIDENTIFIER,
			path: path.join(os.homedir(), NOTE_FOLDER_PATH, 'Accounts', account.ZIDENTIFIER)
		};
	}

	async resolveFolder(id: number): Promise<TFolder | null> {
		if (id in this.resolvedFiles) return this.resolvedFolders[id];

		const folder = await this.database.get`
			SELECT ztitle2, zparent, zidentifier, zfoldertype, zowner
			FROM ziccloudsyncingobject
			WHERE z_ent = ${this.keys.ICFolder} AND z_pk = ${id}
		`;
		let prefix;

		if (folder.ZFOLDERTYPE == ANFolderType.Smart) {
			return null;
		}
		else if (!this.importTrashed && folder.ZFOLDERTYPE == ANFolderType.Trash) {
			this.trashFolders.push(id);
			return null;
		}
		else if (folder.ZPARENT !== null) {
			prefix = (await this.resolveFolder(folder.ZPARENT))?.path + '/';
		}
		else if (this.multiAccount) {
			// If there's a parent, the account root is already handled by that
			const account = this.resolvedAccounts[folder.ZOWNER].name;
			prefix = `${this.rootFolder.path}/${account}/`;
		}
		else {
			prefix = `${this.rootFolder.path}/`;
		}

		if (!folder.ZIDENTIFIER.startsWith('DefaultFolder')) {
			// Notes in the default "Notes" folder are placed in the main directory
			prefix += sanitizeFileName(folder.ZTITLE2);
		}

		const resolved = await this.createFolders(prefix);
		this.resolvedFolders[id] = resolved;
		this.owners[id] = folder.ZOWNER;

		return resolved;
	}

	async resolveNote(id: number): Promise<TFile | null> {
		if (id in this.resolvedFiles) return this.resolvedFiles[id];

		const row = await this.database.get`
			SELECT
				nd.z_pk, hex(nd.zdata) as zhexdata, zcso.ztitle1, zfolder,
				zcreationdate1, zcreationdate2, zcreationdate3, zmodificationdate1, zispasswordprotected
			FROM
				zicnotedata AS nd,
				(SELECT
					*, NULL AS zcreationdate3, NULL AS zcreationdate2,
					NULL AS zispasswordprotected FROM ziccloudsyncingobject
				) AS zcso
			WHERE
				zcso.z_pk = nd.znote
				AND zcso.z_pk = ${id}
		`;

		if (row.ZISPASSWORDPROTECTED) {
			this.ctx.reportSkipped(row.ZTITLE1, 'note is password protected');
			return null;
		}

		const folder = this.resolvedFolders[row.ZFOLDER] || this.rootFolder;

		const title = `${row.ZTITLE1}.md`;
		const file = await this.saveAsMarkdownFile(folder, title, '');

		this.ctx.status(`Importing note ${title}`);
		this.resolvedFiles[id] = file;
		this.owners[id] = this.owners[row.ZFOLDER];

		// Notes may reference other notes, so we want them in resolvedFiles before we parse to avoid cycles
		const converter = this.decodeData(row.zhexdata, NoteConverter);

		this.vault.modify(file, await converter.format(false, file.path), {
			ctime: this.decodeTime(row.ZCREATIONDATE3 || row.ZCREATIONDATE2 || row.ZCREATIONDATE1),
			mtime: this.decodeTime(row.ZMODIFICATIONDATE1)
		});

		this.parsedNotes++;
		this.ctx.reportProgress(this.parsedNotes, this.noteCount);
		return file;
	}

	async resolveAttachment(id: number, uti: ANAttachment | string): Promise<TFile | null> {
		if (id in this.resolvedFiles) return this.resolvedFiles[id];

		let sourcePath, outName, outExt, row, file;

		switch (uti) {
			case ANAttachment.ModifiedScan:
				// A PDF only seems to be generated when you modify the scan :(
				row = await this.database.get`
					SELECT
						zidentifier, zfallbackpdfgeneration, zcreationdate, zmodificationdate, znote
					FROM
						(SELECT *, NULL AS zfallbackpdfgeneration FROM ziccloudsyncingobject)
					WHERE
						z_ent = ${this.keys.ICAttachment}
						AND z_pk = ${id}
				`;

				sourcePath = path.join('FallbackPDFs', row.ZIDENTIFIER, row.ZFALLBACKPDFGENERATION || '', 'FallbackPDF.pdf');
				outName = 'Scan';
				outExt = 'pdf';
				break;

			case ANAttachment.Scan:
				row = await this.database.get`
					SELECT
						zidentifier, zsizeheight, zsizewidth, zcreationdate, zmodificationdate, znote
					FROM ziccloudsyncingobject
					WHERE
						z_ent = ${this.keys.ICAttachment}
						AND z_pk = ${id}
				`;

				sourcePath = path.join('Previews', `${row.ZIDENTIFIER}-1-${row.ZSIZEWIDTH}x${row.ZSIZEHEIGHT}-0.jpeg`);
				outName = 'Scan Page';
				outExt = 'jpg';
				break;

			case ANAttachment.Drawing:
				row = await this.database.get`
					SELECT
						zidentifier, zfallbackimagegeneration, zcreationdate, zmodificationdate,
						znote, zhandwritingsummary
					FROM
						(SELECT *, NULL AS zfallbackimagegeneration FROM ziccloudsyncingobject)
					WHERE
						z_ent = ${this.keys.ICAttachment}
						AND z_pk = ${id}
				`;

				if (row.ZFALLBACKIMAGEGENERATION) {
					// macOS 14/iOS 17 and above
					sourcePath = path.join('FallbackImages', row.ZIDENTIFIER, row.ZFALLBACKIMAGEGENERATION, 'FallbackImage.png');
				}
				else {
					sourcePath = path.join('FallbackImages', `${row.ZIDENTIFIER}.jpg`);
				}

				outName = 'Drawing';
				outExt = 'png';
				break;

			default:
				row = await this.database.get`
					SELECT
						a.zidentifier, a.zfilename,
						a.zgeneration1, b.zcreationdate, b.zmodificationdate, b.znote
					FROM
						(SELECT *, NULL AS zgeneration1 FROM ziccloudsyncingobject) AS a,
						ziccloudsyncingobject AS b
					WHERE
						a.z_ent = ${this.keys.ICMedia}
						AND a.z_pk = ${id}
						AND a.z_pk = b.zmedia
				`;

				sourcePath = path.join('Media', row.ZIDENTIFIER, row.ZGENERATION1 || '', row.ZFILENAME);
				[outName, outExt] = splitext(row.ZFILENAME);
				break;
		}

		try {
			const binary = await this.getAttachmentSource(this.resolvedAccounts[this.owners[row.ZNOTE]], sourcePath);
			const attachmentPath = await this.getAvailablePathForAttachment(`${outName}.${outExt}`, []);

			file = await this.vault.createBinary(
				attachmentPath, binary,
				{ ctime: this.decodeTime(row.ZCREATIONDATE), mtime: this.decodeTime(row.ZMODIFICATIONDATE) }
			);
		}
		catch (e) {
			this.ctx.reportFailed(sourcePath);
			console.error(e);
			return null;
		}

		this.resolvedFiles[id] = file;
		this.ctx.reportAttachmentSuccess(this.resolvedFiles[id].path);
		return file;
	}

	decodeData<T extends ANConverter>(hexdata: string, converterType: ANConverterType<T>) {
		const unzipped = zlib.gunzipSync(Buffer.from(hexdata, 'hex'));
		const decoded = this.protobufRoot.lookupType(converterType.protobufType).decode(unzipped);
		return new converterType(this, decoded);
	}

	decodeTime(timestamp: number): number {
		if (!timestamp || timestamp < 1) return new Date().getTime();
		return Math.floor((timestamp + CORETIME_OFFSET) * 1000);
	}

	async getAttachmentSource(account: ANAccount, sourcePath: string): Promise<Buffer> {
		try {
			return await fsPromises.readFile(path.join(account.path, sourcePath));
		}
		catch (e) {
			return await fsPromises.readFile(path.join(os.homedir(), NOTE_FOLDER_PATH, sourcePath));
		}
	}
}
