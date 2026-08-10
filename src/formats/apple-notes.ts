import { DataWriteOptions, Notice, Platform, TFile, TFolder, moment, normalizePath } from 'obsidian';
import { NoteConverter, noteTitle } from './apple-notes/convert-note';
import { ANAccount, ANAttachment, ANContext, ANConverter, ANConverterType, ANFolderType } from './apple-notes/models';
import { descriptor } from './apple-notes/descriptor';
import { ImportContext } from '../import-context';
import { fs, fsPromises, nodeBufferToArrayBuffer, os, path, splitext, zlib } from '../filesystem';
import { extensionFromBytes, extractErrorMessage, sanitizeFileName } from '../util';
import { describeFolderFailure, NO_ACCESS_HINT } from './apple-notes/errors';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { selectedNodes } from '../tree';
import { TreePicker, ViewableNode } from '../tree-view';
import { Root } from 'protobufjs';
import SQLiteTag from './apple-notes/sqlite/index';
import { SQLiteTagSpawned } from './apple-notes/models';

const NOTE_FOLDER_PATH = 'Library/Group Containers/group.com.apple.notes';
const NOTE_DB = 'NoteStore.sqlite';
/** Additional amount of seconds that Apple CoreTime datatypes start at, to convert them into Unix timestamps. */
const CORETIME_OFFSET = 978307200;
const NOTE_ID_PROPERTY = 'apple-notes-id';
const LOCAL_STORAGE_KEY = 'apple-notes-importer-file-prefix';

interface AppleNotesTreeNode extends ViewableNode<AppleNotesTreeNode> {
	id: number;
	type: 'account' | 'folder';
	owner: number;
	notes: number;
	collapsed: boolean;
	children: AppleNotesTreeNode[];
}

function countSubtree(node: AppleNotesTreeNode): number {
	node.notes = node.children.reduce((total, child) => total + countSubtree(child), node.notes);

	return node.notes;
}

function notesFolder(): string {
	return path.join(os.homedir(), NOTE_FOLDER_PATH);
}

interface ANAccountRow {
	Z_PK: number;
	ZNAME: string;
}

interface ANFolderRow {
	Z_PK: number;
	ZTITLE2: string;
	ZPARENT: number | null;
	ZFOLDERTYPE: ANFolderType;
	ZOWNER: number;
}

export class AppleNotesImporter extends FormatImporter implements ANContext<TFile> {
	interruption = 'pause' as const;

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
	includeHandwriting = false;

	// A getter, not a field: the vault is unavailable during construction.
	get strictLineBreaks(): boolean {
		return this.vault.getConfig('strictLineBreaks') === true;
	}

	filePrefixFormat: string;

	// Do not initialize fields set by init(); the base constructor calls it first.
	private dataPath: string | null;

	private picker: TreePicker<AppleNotesTreeNode>;

	selectedFolders: number[] = [];

	get sourceReady(): boolean {
		return this.selectedFolders.length > 0;
	}

	init(): void {
		this.defaultOutputFolder = 'Apple Notes';
		this.idProperty = NOTE_ID_PROPERTY;
		this.idLabel = 'Apple Notes ID';

		if (!Platform.isMacOS || !Platform.isDesktop) {
			this.draw(contentEl => contentEl.createEl('p', {
				text:
					'Due to platform limitations, Apple Notes cannot be exported from this device.' +
					' Open your vault on a Mac to export from Apple Notes.'
			}));

			this.notAvailable = true;
			return;
		}

		this.addAccessSetting();
		this.drawFolderPicker();

		if (this.dataPath) {
			void this.loadFolders();
		}

		const storedPrefix: string = this.app.loadLocalStorage(LOCAL_STORAGE_KEY) ?? '';
		this.filePrefixFormat = storedPrefix;

		this.addSetting()
			?.setName('File prefix format')
			.setDesc(
				'Format for the creation date prefix in filenames. Use YYYY, MM, DD for year, month, day.' +
				' Leave blank for no prefix.'
			)
			.addText(t => t
				.setValue(storedPrefix)
				.setPlaceholder('YYYY-MM-DD')
				.onChange(async v => {
					this.filePrefixFormat = v;
					this.app.saveLocalStorage(LOCAL_STORAGE_KEY, v);
				})
			);

		this.addSetting()
			?.setName('Omit first line')
			.setDesc(
				'Don\'t include the first line in the text, since Apple Notes uses it' +
				' as the title. It will still be used as the note name.'
			)
			.addToggle(t => t
				.setValue(true)
				.onChange(async v => this.omitFirstLine = v)
			);

		this.addSetting()
			?.setName('Include handwriting text')
			.setDesc(
				'When Apple Notes has detected handwriting in drawings, include it as text before the drawing.'
			)
			.addToggle(t => t
				.setValue(false)
				.onChange(async v => this.includeHandwriting = v)
			);

	}

	private addAccessSetting(): void {
		const setting = this.addSetting('source');
		if (!setting) return;

		setting.setName('Apple Notes data folder');

		const showAccess = () => {
			if (!this.dataPath) {
				setting.setDesc('macOS only lets Obsidian read your notes once you have pointed it at the folder they are kept in.');
				return;
			}

			setting.setDesc(createFragment(frag => {
				frag.createSpan({ cls: 'u-pop', text: this.dataPath! });
			}));
		};

		this.dataPath = this.readableDataFolder();
		showAccess();

		setting.addButton(button => button
			.setButtonText('Select folder')
			.onClick(() => {
				const dataPath = this.askForDataFolder();
				if (!dataPath) {
					new Notice('Ensure you have selected the correct Apple Notes data folder.');
					return;
				}

				if (dataPath === this.dataPath) return;

				this.dataPath = dataPath;
				showAccess();
				void this.loadFolders();
			}));
	}

	private drawFolderPicker(): void {
		this.draw(contentEl => {
			this.picker = new TreePicker<AppleNotesTreeNode>(contentEl, {
				name: 'Folders to import',
				desc: 'Pick the folders whose notes to bring across.',
				hint: NO_ACCESS_HINT,
				loading: 'Reading folders...',
				empty: 'No folders found.',
				failed: describeFolderFailure,
				view: {
					icon: node => node.type === 'account' ? 'user' : 'folder',
					flair: node => node.type === 'account' ? '' : String(node.notes),
				},
				onChange: () => {
					this.selectedFolders = selectedNodes(this.picker.nodes, node => node.type === 'folder').map(node => node.id);
					this.sourceChanged();
				},
			});

			this.picker.onLoad(() => void this.loadFolders());
		}, 'source');
	}

	private async loadFolders(): Promise<void> {
		if (!this.dataPath) {
			new Notice(NO_ACCESS_HINT);
			return;
		}

		try {
			await this.picker.load(() => this.readFolders());
		}
		catch (e) {
			console.error('Could not read your Apple Notes folders', e);
		}
	}

	private async readFolders(): Promise<AppleNotesTreeNode[]> {
		//@ts-ignore
		const db = new SQLiteTag(path.join(this.dataPath!, NOTE_DB), { readonly: true, persistent: true }) as SQLiteTagSpawned;

		try {
			const keys = Object.fromEntries(
				(await db.all`SELECT z_ent, z_name FROM z_primarykey`).map(k => [k.Z_NAME, k.Z_ENT])
			);

			const folders = await db.all`
				SELECT z_pk, ztitle2, zparent, zfoldertype, zowner
				FROM ziccloudsyncingobject
				WHERE z_ent = ${keys.ICFolder} AND ztitle2 IS NOT NULL
			` as unknown as ANFolderRow[];

			const accounts = await db.all`
				SELECT z_pk, zname FROM ziccloudsyncingobject WHERE z_ent = ${keys.ICAccount}
			` as unknown as ANAccountRow[];

			const counts = await db.all`
				SELECT zfolder, COUNT(*) AS notes FROM ziccloudsyncingobject
				WHERE z_ent = ${keys.ICNote} AND ztitle1 IS NOT NULL
				GROUP BY zfolder
			` as unknown as { ZFOLDER: number, notes: number }[];

			return this.buildTree(folders, accounts, new Map(counts.map(row => [row.ZFOLDER, row.notes])));
		}
		finally {
			db.close();
		}
	}

	private buildTree(folders: ANFolderRow[], accounts: ANAccountRow[], counts: Map<number, number>): AppleNotesTreeNode[] {
		const nodes = new Map<number, AppleNotesTreeNode>();

		for (const folder of folders) {
			if (folder.ZFOLDERTYPE === ANFolderType.Smart) continue;

			nodes.set(folder.Z_PK, {
				id: folder.Z_PK,
				title: folder.ZTITLE2,
				type: 'folder',
				owner: folder.ZOWNER,
				notes: counts.get(folder.Z_PK) ?? 0,
				selected: false,
				disabled: false,
				collapsed: false,
				children: [],
			});
		}

		const roots: AppleNotesTreeNode[] = [];
		for (const folder of folders) {
			const node = nodes.get(folder.Z_PK);
			if (!node) continue;

			const parent = folder.ZPARENT === null ? undefined : nodes.get(folder.ZPARENT);
			if (parent) parent.children.push(node);
			else roots.push(node);
		}

		for (const root of roots) countSubtree(root);

		if (accounts.length < 2) return roots;

		return accounts
			.map(account => ({
				id: account.Z_PK,
				title: account.ZNAME,
				type: 'account' as const,
				owner: account.Z_PK,
				notes: 0,
				selected: false,
				disabled: false,
				collapsed: false,
				children: roots.filter(node => node.owner === account.Z_PK),
			}))
			.filter(account => account.children.length > 0);
	}

	private readableDataFolder(): string | null {
		const dataPath = notesFolder();

		try {
			fs.accessSync(path.join(dataPath, NOTE_DB), fs.constants.R_OK);
			return dataPath;
		}
		catch {
			return null;
		}
	}

	private askForDataFolder(): string | null {
		const dataPath = notesFolder();

		const names: string[] | undefined = window.electron.remote.dialog.showOpenDialogSync({
			defaultPath: dataPath,
			properties: ['openDirectory'],
			//see https://developer.apple.com/videos/play/wwdc2019/701/
			message: 'Select the "group.com.apple.notes" folder to allow Obsidian to read Apple Notes data.'
		});

		return names?.includes(dataPath) ? dataPath : null;
	}

	async getNotesDatabase(): Promise<SQLiteTagSpawned | null> {
		const dataPath = this.dataPath ?? this.askForDataFolder();

		if (!dataPath) {
			new Notice('Data import failed. Ensure you have selected the correct Apple Notes data folder.');
			return null;
		}

		const originalDB = path.join(dataPath, NOTE_DB);
		const clonedDB = path.join(os.tmpdir(), NOTE_DB);

		// Copy the database and its WAL files so Notes cannot change them mid-import.
		await fsPromises.copyFile(originalDB, clonedDB);
		await fsPromises.copyFile(originalDB + '-shm', clonedDB + '-shm');
		await fsPromises.copyFile(originalDB + '-wal', clonedDB + '-wal');

		//@ts-ignore
		return new SQLiteTag(clonedDB, { readonly: true, persistent: true });
	}

	async import(ctx: ImportContext): Promise<void> {
		this.ctx = ctx;
		this.protobufRoot = Root.fromJSON(descriptor);
		const rootFolder = await this.getOutputFolder();

		if (!rootFolder) {
			new Notice('Please select a location to export to.');
			return;
		}
		this.rootFolder = rootFolder;

		if (this.selectedFolders.length === 0) {
			new Notice('Please select at least one folder to import.');
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
			SELECT z_pk, ztitle2 FROM ziccloudsyncingobject
			WHERE z_ent = ${this.keys.ICFolder} AND z_pk IN (${this.selectedFolders})
		`;

		for (let a of noteAccounts) await this.resolveAccount(a.Z_PK);

		// Break instead of returning so the database is closed below.
		for (let f of noteFolders) {
			if (await ctx.shouldStop()) break;

			try {
				await this.resolveFolder(f.Z_PK);
			}
			catch (e) {
				this.ctx.reportFailed(f.ZTITLE2, extractErrorMessage(e));
				console.error(e);
			}
		}

		const notes = await this.database.all`
			SELECT
				z_pk, zfolder, ztitle1 FROM ziccloudsyncingobject
			WHERE
				z_ent = ${this.keys.ICNote}
				AND ztitle1 IS NOT NULL
				AND zfolder IN (${this.selectedFolders})
		`;
		this.noteCount = notes.length;

		for (let n of notes) {
			if (await ctx.shouldStop()) break;

			try {
				await this.resolveNote(n.Z_PK);
			}
			catch (e) {
				this.ctx.reportFailed(n.ZTITLE1, extractErrorMessage(e));
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
				nd.z_pk, hex(nd.zdata) as zhexdata, zcso.ztitle1, zfolder, zcso.zidentifier,
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

		const converter = this.decodeData(row.zhexdata, NoteConverter);

		// Get creation date and format it according to user preference
		let prefix = '';
		if (this.filePrefixFormat) {
			const creationTimestamp = this.decodeTime(row.ZCREATIONDATE3 || row.ZCREATIONDATE2 || row.ZCREATIONDATE1);
			prefix = `${moment(creationTimestamp).format(this.filePrefixFormat)} `;
		}

		const storedTitle = String(row.ZTITLE1);
		const title = prefix + noteTitle(converter.note.noteText, storedTitle);

		const existingFile = this.existingNoteFor(
			folder, [`${title}.md`, `${prefix}${storedTitle}.md`], row.ZIDENTIFIER
		);

		if (existingFile) {
			if (this.duplicateHandling === DuplicateHandling.Skip) {
				this.ctx.reportSkipped(title, 'note is a duplicate');
				return existingFile;
			}
			else if (this.duplicateHandling === DuplicateHandling.Update) {
				// Check modification times before skipping
				const appleNoteModTime = this.decodeTime(row.ZMODIFICATIONDATE1);
				const existingFileModTime = existingFile.stat.mtime;

				// Only skip if the Apple Note hasn't been modified since the existing file
				if (appleNoteModTime <= existingFileModTime) {
					this.ctx.reportSkipped(title, 'note unchanged since last import');
					return existingFile;
				}
				// If Apple Note is newer, continue with import (will overwrite)
			}
		}

		const file = existingFile ?? await this.saveAsMarkdownFile(folder, `${title}.md`, '');

		this.ctx.status(`Importing note ${title}`);
		this.resolvedFiles[id] = file;
		this.owners[id] = this.owners[row.ZFOLDER];

		// Notes may reference other notes, so we want them in resolvedFiles before we parse to avoid cycles
		const body = await converter.format(false, file.path);

		await this.modifyMarkdown(file, this.withSourceId(body, row.ZIDENTIFIER), {
			ctime: this.decodeTime(row.ZCREATIONDATE3 || row.ZCREATIONDATE2 || row.ZCREATIONDATE1),
			mtime: this.decodeTime(row.ZMODIFICATIONDATE1)
		});

		this.parsedNotes++;
		this.ctx.reportProgress(this.parsedNotes, this.noteCount);
		this.ctx.reportNoteSuccess(title);
		return file;
	}

	async resolveAttachment(
		id: number, uti: ANAttachment | (string & {}), hasFallback = false
	): Promise<TFile | null> {
		if (id in this.resolvedFiles) return this.resolvedFiles[id];

		let sourcePath, outName, outExt, row, file;
		let neverDownloaded = false;

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

				if (!row) break;
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

				if (!row) break;
				sourcePath = path.join('Previews', `${row.ZIDENTIFIER}-1-${row.ZSIZEWIDTH}x${row.ZSIZEHEIGHT}-0.jpeg`);
				outName = 'Scan Page';
				outExt = 'jpg';
				break;

			case ANAttachment.DrawingLegacy:
			case ANAttachment.DrawingLegacy2:
			case ANAttachment.Drawing:
				row = await this.database.get`
					SELECT
						zidentifier, zfallbackimagegeneration, zcreationdate, zmodificationdate,
						znote, zhandwritingsummary, zsizewidth,
					zmergeabledata1 IS NOT NULL AS hasdrawing
					FROM
						(SELECT *, NULL AS zfallbackimagegeneration FROM ziccloudsyncingobject)
					WHERE
						z_ent = ${this.keys.ICAttachment}
						AND z_pk = ${id}
				`;

				if (!row) break;

				// This combination means the drawing still exists only in iCloud.
				neverDownloaded = !row.ZFALLBACKIMAGEGENERATION && !row.hasdrawing && !row.ZSIZEWIDTH;

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

				if (!row || !row.ZFILENAME) break;
				sourcePath = path.join('Media', row.ZIDENTIFIER, row.ZGENERATION1 || '', row.ZFILENAME);
				[outName, outExt] = splitext(row.ZFILENAME);
				break;
		}

		// A missing row must not abort conversion once the note file exists (#218, #391).
		if (!row || sourcePath === undefined || outName === undefined || outExt === undefined) {
			if (!hasFallback) this.ctx.reportFailed(`Attachment ${id}`, `no ${uti} row to read it from`);
			return null;
		}

		// Apply date prefix to attachment name if configured
		let finalAttachmentName = outName;
		if (this.filePrefixFormat && row.ZCREATIONDATE) {
			const creationTimestamp = this.decodeTime(row.ZCREATIONDATE);
			const datePrefix = moment(creationTimestamp).format(this.filePrefixFormat);
			finalAttachmentName = `${datePrefix} ${outName}`;
		}

		try {
			let binary;

			// Unknown extensions must be detected before checking for duplicates (#471).
			if (!outExt) {
				binary = await this.getAttachmentSource(this.resolvedAccounts[this.owners[row.ZNOTE]], sourcePath);
				outExt = extensionFromBytes(binary) ?? '';
			}

			const attachmentName = outExt ? `${finalAttachmentName}.${outExt}` : finalAttachmentName;

			const notePath = this.resolvedFiles[row.ZNOTE]?.path;
			const mtime = this.decodeTime(row.ZMODIFICATIONDATE);
			const { path: attachmentPath, reuse } = await this.placeAttachment(attachmentName, notePath, mtime);

			if (reuse) {
				this.ctx.reportSkipped(finalAttachmentName, this.duplicateHandling === DuplicateHandling.Skip
					? 'attachment already exists'
					: 'attachment unchanged since last import');
				return reuse;
			}

			binary ??= await this.getAttachmentSource(this.resolvedAccounts[this.owners[row.ZNOTE]], sourcePath);

			file = await this.writeAttachment(
				attachmentPath, nodeBufferToArrayBuffer(binary),
				{ ctime: this.decodeTime(row.ZCREATIONDATE), mtime }
			);
		}
		catch (e) {
			// An expected failed probe; the caller reports only if its fallback also fails (#393).
			if (hasFallback) return null;

			const label = await this.describeAttachment(outName, Number(row.ZNOTE));

			if (neverDownloaded) {
				this.ctx.reportSkipped(
					label, 'it has not been downloaded from iCloud - open the note in Apple Notes to fetch it'
				);
				return null;
			}

			this.ctx.reportFailed(label, extractErrorMessage(e));
			console.error(e);
			return null;
		}

		this.resolvedFiles[id] = file;
		this.ctx.reportAttachmentSuccess(file.name);
		return file;
	}

	linkTo(file: TFile, sourcePath: string, subpath?: string, display?: string): string {
		return this.app.fileManager.generateMarkdownLink(file, sourcePath, subpath, display);
	}

	decodeData<T extends ANConverter>(hexdata: string, converterType: ANConverterType<T>): T {
		const unzipped = zlib.unzipSync(Buffer.from(hexdata, 'hex'));
		const decoded = this.protobufRoot.lookupType(converterType.protobufType).decode(unzipped);
		return new converterType(this, decoded);
	}

	decodeTime(timestamp: number): number {
		if (!timestamp || timestamp < 1) return new Date().getTime();
		return Math.floor((timestamp + CORETIME_OFFSET) * 1000);
	}

	private async describeAttachment(outName: string, notePk: number): Promise<string> {
		const imported = this.resolvedFiles[notePk];
		if (imported) return `${outName} in ${imported.basename}`;

		const note = await this.database.get`
			SELECT ztitle1 FROM ziccloudsyncingobject WHERE z_pk = ${notePk}
		`;

		return note?.ZTITLE1 ? `${outName} in ${String(note.ZTITLE1)}` : outName;
	}

	async getAttachmentSource(account: ANAccount, sourcePath: string): Promise<Buffer<ArrayBuffer>> {
		const candidates = [
			path.join(account.path, sourcePath),
			// Older Notes versions stored attachments outside account folders.
			path.join(os.homedir(), NOTE_FOLDER_PATH, sourcePath),
		];

		for (const candidate of candidates) {
			try {
				return await fsPromises.readFile(candidate);
			}
			catch {
				continue;
			}
		}

		throw new Error(`there is no file at ${candidates.join(' or ')}`);
	}

	private existingNoteFor(folder: TFolder, titles: string[], noteId?: string): TFile | null {
		if (this.duplicateHandling === DuplicateHandling.CreateCopy) return null;

		for (const title of new Set(titles)) {
			const fullPath = normalizePath(path.join(folder.path, `${sanitizeFileName(title).replace(/\.md$/i, '')}.md`));
			const existingFile = this.previouslyImported(fullPath, noteId);
			if (existingFile) return existingFile;
		}

		return null;
	}



	async saveAsMarkdownFile(folder: TFolder, title: string, content: string, options?: DataWriteOptions): Promise<TFile> {
		const file = await super.saveAsMarkdownFile(folder, title, content, options);
		this.claimPath(file.path);

		return file;
	}
}
