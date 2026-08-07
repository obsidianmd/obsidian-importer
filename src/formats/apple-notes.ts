import { ButtonComponent, DataWriteOptions, Notice, Platform, TFile, TFolder, moment, normalizePath } from 'obsidian';
import { NoteConverter } from './apple-notes/convert-note';
import { ANAccount, ANAttachment, ANContext, ANConverter, ANConverterType, ANFolderType } from './apple-notes/models';
import { descriptor } from './apple-notes/descriptor';
import { ImportContext } from '../import-context';
import { fs, fsPromises, nodeBufferToArrayBuffer, os, parseFilePath, path, splitext, zlib } from '../filesystem';
import { extractErrorMessage, sanitizeFileName, serializeFrontMatter } from '../util';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { areAllSelected, redrawTree, setAllSelection } from '../tree';
import { renderTreeNodes, showTreePlaceholder, ViewableNode } from '../tree-view';
import { Root } from 'protobufjs';
import SQLiteTag from './apple-notes/sqlite/index';
import { SQLiteTagSpawned } from './apple-notes/models';

const NOTE_FOLDER_PATH = 'Library/Group Containers/group.com.apple.notes';
const NOTE_DB = 'NoteStore.sqlite';
/** Additional amount of seconds that Apple CoreTime datatypes start at, to convert them into Unix timestamps. */
const CORETIME_OFFSET = 978307200;
/** Frontmatter property holding the Apple Notes id a note was imported from. */
const NOTE_ID_PROPERTY = 'apple-notes-id';
const LOCAL_STORAGE_KEY = 'apple-notes-importer-file-prefix';
/** What the picker says while it has not been let into the notes database. */
const NO_ACCESS_HINT = 'Allow access to your notes to see the folders in them.';

/**
 * A folder, or the account it belongs to, as the picker holds it.
 *
 * The same shape the other importers pick from, so the ticking and the drawing
 * are the shared ones. Only a folder holds notes; an account is a heading with
 * a checkbox, and is only there when there is more than one.
 */
interface AppleNotesTreeNode extends ViewableNode<AppleNotesTreeNode> {
	id: number;
	type: 'account' | 'folder';
	collapsed: boolean;
	children: AppleNotesTreeNode[];
}

/** One row of the account listing, for the level above the folders. */
interface ANAccountRow {
	Z_PK: number;
	ZNAME: string;
}

/** One row of the folder listing the picker is built from. */
interface ANFolderRow {
	Z_PK: number;
	ZTITLE2: string;
	ZPARENT: number | null;
	ZFOLDERTYPE: number;
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
	filePrefixFormat: string;
	/** Every note path this run has written, to tell a copy from an update. */
	private claimedPaths = new Set<string>();

	/**
	 * The notes folder, once macOS is letting Obsidian read it.
	 *
	 * Without an initialiser: init() runs from the base class constructor,
	 * before a derived class assigns its fields, so `= null` would throw away
	 * the access addAccessSetting had just found.
	 */
	private dataPath: string | null;

	/** The folder picker, and what it was drawn from. */
	private tree: AppleNotesTreeNode[];
	private treeContainer: HTMLElement;
	private toggleSelectButton: ButtonComponent;
	private loadButton: ButtonComponent;

	/**
	 * Which folders the import walks, worked out from the tree the dialog draws.
	 * An import run without one says which it wants directly.
	 */
	selectedFolders: number[] = [];

	/** How many notes each folder holds, for the count beside its name. */
	private noteCounts = new Map<number, number>();

	/** Nothing to import until some of the folders have been ticked. */
	get sourceReady(): boolean {
		return this.selectedFolders.length > 0;
	}

	init(): void {
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

		// Already allowed in, so the folders can be listed without being asked
		if (this.dataPath) {
			void this.loadFolders().catch(e => console.error('Could not read your Apple Notes folders', e));
		}

		this.addOutputLocationSetting('Apple Notes');

		// Retrieve stored file prefix format. Scoped to the vault rather than
		// shared across all of them, so a prefix set here does not follow the
		// user into an unrelated vault.
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

		this.addDuplicateHandlingSetting({ idProperty: NOTE_ID_PROPERTY });
	}

	/**
	 * Where the notes come from, which macOS only lets Obsidian read once the
	 * user has pointed at the folder themselves.
	 *
	 * That is asked here rather than when the import starts, so that the step
	 * about where the notes are coming from is the one that asks for them - and
	 * only when it still has to be asked, since the answer outlasts the session.
	 */
	private addAccessSetting(): void {
		const setting = this.addSetting('source');
		if (!setting) return;

		setting.setName('Apple Notes data folder');

		const showAccess = () => {
			if (this.dataPath) {
				setting.setDesc(`Obsidian can read your notes from ${this.dataPath}`);
			}
			else {
				setting.setDesc('macOS only lets Obsidian read your notes once you have pointed it at the folder they are kept in.');
			}
		};

		// Already granted, from this import or a previous one
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

				this.dataPath = dataPath;
				showAccess();
				void this.loadFolders().catch(e => console.error('Could not read your Apple Notes folders', e));
			}));
	}

	/** The folders to import from, which is the tree and the buttons over it. */
	private drawFolderPicker(): void {
		const setting = this.addSetting('source');
		if (!setting) return;

		setting
			.setName('Folders to import')
			.setDesc('Pick the folders whose notes to bring across.')
			.addButton(button => {
				this.toggleSelectButton = button;
				button.buttonEl.addClass('importer-tree-button');
				button.buttonEl.hide();
				button.setButtonText('Select all').onClick(() => {
					setAllSelection(this.tree, !areAllSelected(this.tree));
					this.renderTree();
				});
			})
			.addButton(button => {
				this.loadButton = button;
				button.buttonEl.addClass('importer-tree-button', 'mod-cta');
				button.setButtonText('Load').onClick(() => void this.loadFolders()
					.catch(e => console.error('Could not read your Apple Notes folders', e)));
			});

		this.treeContainer = this.draw(contentEl => contentEl
			.createDiv('import-section file-tree publish-section')
			.createDiv('publish-change-list'), 'source')!;

		this.tree = [];
		showTreePlaceholder(this.treeContainer, NO_ACCESS_HINT);
	}

	/**
	 * Read the folders out of the notes database and put them in the picker.
	 *
	 * The database is read where it lives rather than copied first: this is one
	 * quick query, and the copy the import makes is for the long walk that comes
	 * after it, which wants a snapshot the Notes app cannot move underneath.
	 */
	private async loadFolders(): Promise<void> {
		if (!this.dataPath) {
			new Notice(NO_ACCESS_HINT);
			return;
		}

		this.tree = [];
		this.selectedFolders = [];
		this.loadButton.setDisabled(true).setButtonText('Loading...');
		this.toggleSelectButton.buttonEl.hide();
		showTreePlaceholder(this.treeContainer, 'Reading folders...');

		//@ts-ignore
		const db = new SQLiteTag(path.join(this.dataPath, NOTE_DB), { readonly: true, persistent: true }) as SQLiteTagSpawned;

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

			// The notes each folder holds directly, counted the way the import
			// counts them: a note with no title is not one it would write
			const counts = await db.all`
				SELECT zfolder, COUNT(*) AS notes FROM ziccloudsyncingobject
				WHERE z_ent = ${keys.ICNote} AND ztitle1 IS NOT NULL
				GROUP BY zfolder
			` as unknown as { ZFOLDER: number, notes: number }[];

			this.noteCounts = new Map(counts.map(row => [row.ZFOLDER, row.notes]));
			this.tree = this.buildTree(folders, accounts);
			this.renderTree();
			this.toggleSelectButton.buttonEl.show();
		}
		finally {
			db.close();
			this.loadButton.setDisabled(false).setButtonText('Refresh').removeCta();
		}
	}

	/**
	 * The folders as a tree, under their accounts when there is more than one.
	 *
	 * A smart folder is left out: it is a saved search rather than somewhere
	 * notes live, and resolveFolder skips it for the same reason.
	 */
	private buildTree(folders: ANFolderRow[], accounts: ANAccountRow[]): AppleNotesTreeNode[] {
		const nodes = new Map<number, AppleNotesTreeNode>();

		for (const folder of folders) {
			if (folder.ZFOLDERTYPE === ANFolderType.Smart) continue;

			nodes.set(folder.Z_PK, {
				id: folder.Z_PK,
				title: folder.ZTITLE2,
				type: 'folder',
				selected: false,
				disabled: false,
				collapsed: false,
				children: [],
			});
		}

		// Nested under its parent where it has one that survived the filtering
		const roots: AppleNotesTreeNode[] = [];
		for (const folder of folders) {
			const node = nodes.get(folder.Z_PK);
			if (!node) continue;

			const parent = folder.ZPARENT === null ? undefined : nodes.get(folder.ZPARENT);
			if (parent) parent.children.push(node);
			else roots.push(node);
		}

		// One account is the account everything is in, and says nothing
		if (accounts.length < 2) return roots;

		return accounts
			.map(account => ({
				id: account.Z_PK,
				title: account.ZNAME,
				type: 'account' as const,
				selected: false,
				disabled: false,
				collapsed: false,
				children: roots.filter(node => folders.find(f => f.Z_PK === node.id)?.ZOWNER === account.Z_PK),
			}))
			.filter(account => account.children.length > 0);
	}

	private renderTree(): void {
		redrawTree(this.treeContainer, () => {
			if (this.tree.length === 0) {
				this.treeContainer.createDiv({ cls: 'publish-placeholder', text: 'No folders found.' });
				return;
			}

			renderTreeNodes(this.treeContainer, this.tree, {
				icon: node => node.type === 'account' ? 'user' : 'folder',
				// An account holds nothing of its own; its folders each say theirs
				flair: node => node.type === 'account' ? '' : String(this.noteCounts.get(node.id) ?? 0),
				redraw: () => this.renderTree(),
			});
		});

		// What the import walks, kept in step with what the tree shows
		this.selectedFolders = this.selectedFolderIds(this.tree);

		this.toggleSelectButton.setButtonText(areAllSelected(this.tree) ? 'Deselect all' : 'Select all');
		this.sourceChanged();
	}

	/** Every folder the selection covers; an account holds none of its own. */
	private selectedFolderIds(nodes: AppleNotesTreeNode[], into: number[] = []): number[] {
		for (const node of nodes) {
			if (node.type === 'folder' && node.selected) into.push(node.id);
			this.selectedFolderIds(node.children, into);
		}

		return into;
	}

	/**
	 * The notes folder, if macOS is already letting Obsidian read it.
	 *
	 * The access a user grants by picking the folder outlives the session, so
	 * asking again is asking a question that has been answered. Tried rather
	 * than remembered: what was granted is the system's to say, not ours, and a
	 * grant that has since been withdrawn would answer the same either way.
	 */
	private readableDataFolder(): string | null {
		const dataPath = path.join(os.homedir(), NOTE_FOLDER_PATH);

		try {
			fs.accessSync(path.join(dataPath, NOTE_DB), fs.constants.R_OK);
			return dataPath;
		}
		catch {
			return null;
		}
	}

	/**
	 * Ask for the notes folder, and give back the path if that is what was
	 * chosen. Selecting it is what grants the access; nothing else does.
	 */
	private askForDataFolder(): string | null {
		const dataPath = path.join(os.homedir(), NOTE_FOLDER_PATH);

		const names: string[] | undefined = window.electron.remote.dialog.showOpenDialogSync({
			defaultPath: dataPath,
			properties: ['openDirectory'],
			//see https://developer.apple.com/videos/play/wwdc2019/701/
			message: 'Select the "group.com.apple.notes" folder to allow Obsidian to read Apple Notes data.'
		});

		return names?.includes(dataPath) ? dataPath : null;
	}

	async getNotesDatabase(): Promise<SQLiteTagSpawned | null> {
		// Asked for here too, for an import run without the dialog that asks
		const dataPath = this.dataPath ?? this.askForDataFolder();

		if (!dataPath) {
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
		// Only the folders that were picked, and only those the notes are in
		const noteFolders = await this.database.all`
			SELECT z_pk, ztitle2 FROM ziccloudsyncingobject
			WHERE z_ent = ${this.keys.ICFolder} AND z_pk IN (${this.selectedFolders})
		`;

		for (let a of noteAccounts) await this.resolveAccount(a.Z_PK);

		// Breaks rather than returns, here and below: the sqlite process this
		// spawned is closed at the end of the method
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

		// Get creation date and format it according to user preference
		let title = row.ZTITLE1;
		if (this.filePrefixFormat) {
			const creationTimestamp = this.decodeTime(row.ZCREATIONDATE3 || row.ZCREATIONDATE2 || row.ZCREATIONDATE1);
			const datePrefix = moment(creationTimestamp).format(this.filePrefixFormat);
			title = `${datePrefix} ${title}`;
		}

		// Check for duplicate notes based on the selected handling option
		const existingFile = await this.previouslyImported(folder, `${title}.md`, row.ZIDENTIFIER);

		if (existingFile) {
			if (this.duplicateHandling === DuplicateHandling.Skip) {
				this.ctx.reportSkipped(row.ZTITLE1, 'note is a duplicate');
				return existingFile;
			}
			else if (this.duplicateHandling === DuplicateHandling.ImportUpdated) {
				// Check modification times before skipping
				const appleNoteModTime = this.decodeTime(row.ZMODIFICATIONDATE1);
				const existingFileModTime = existingFile.stat.mtime;

				// Only skip if the Apple Note hasn't been modified since the existing file
				if (appleNoteModTime <= existingFileModTime) {
					this.ctx.reportSkipped(row.ZTITLE1, 'note unchanged since last import');
					return existingFile;
				}
				// If Apple Note is newer, continue with import (will overwrite)
			}
		}

		// The note an earlier import wrote is written over; anything else gets a
		// name of its own, a copy's if the title is taken.
		const file = existingFile ?? await this.saveAsMarkdownFile(folder, `${title}.md`, '');

		this.ctx.status(`Importing note ${title}`);
		this.resolvedFiles[id] = file;
		this.owners[id] = this.owners[row.ZFOLDER];

		// Notes may reference other notes, so we want them in resolvedFiles before we parse to avoid cycles
		const converter = this.decodeData(row.zhexdata, NoteConverter);

		const body = await converter.format(false, file.path);

		await this.vault.modify(file, this.noteIdFrontMatter(row.ZIDENTIFIER) + body, {
			ctime: this.decodeTime(row.ZCREATIONDATE3 || row.ZCREATIONDATE2 || row.ZCREATIONDATE1),
			mtime: this.decodeTime(row.ZMODIFICATIONDATE1)
		});

		this.parsedNotes++;
		this.ctx.reportProgress(this.parsedNotes, this.noteCount);
		this.ctx.reportNoteSuccess(title);
		return file;
	}

	async resolveAttachment(id: number, uti: ANAttachment | (string & {})): Promise<TFile | null> {
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

			// Apple has used three UTIs for a drawing, and the converter hands
			// over all three. An older one taken for a file attachment finds no
			// media row at that key and fails the note it was in.
			case ANAttachment.DrawingLegacy:
			case ANAttachment.DrawingLegacy2:
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

		// Apply date prefix to attachment name if configured
		let finalAttachmentName = outName;
		if (this.filePrefixFormat && row.ZCREATIONDATE) {
			const creationTimestamp = this.decodeTime(row.ZCREATIONDATE);
			const datePrefix = moment(creationTimestamp).format(this.filePrefixFormat);
			finalAttachmentName = `${datePrefix} ${outName}`;
		}

		// Check for existing attachment based on the selected handling option
		// Abuse getAvailablePathForAttachment to get the expected attachment path
		const uniqueAttachmentPath = await this.getAvailablePathForAttachment(`${finalAttachmentName}.${outExt}`, []);
		const { parent } = parseFilePath(uniqueAttachmentPath);
		const expectedAttachmentPath = path.join(parent, `${finalAttachmentName}.${outExt}`);
		const existingAttachment = this.vault.getAbstractFileByPath(expectedAttachmentPath);

		if (existingAttachment && existingAttachment instanceof TFile) {
			if (this.duplicateHandling === DuplicateHandling.Skip) {
				this.ctx.reportSkipped(finalAttachmentName, 'attachment already exists');
				return existingAttachment;
			}
			else if (this.duplicateHandling === DuplicateHandling.ImportUpdated) {
				// Check modification times for attachments
				const appleAttachmentModTime = this.decodeTime(row.ZMODIFICATIONDATE);
				const existingAttachmentModTime = existingAttachment.stat.mtime;

				if (appleAttachmentModTime <= existingAttachmentModTime) {
					this.ctx.reportSkipped(finalAttachmentName, 'attachment unchanged since last import');
					return existingAttachment;
				}
				// If Apple attachment is newer, continue with import (will overwrite)
			}
			// For CreateCopy option, we continue without skipping (will create numbered copy)
		}

		try {
			const binary = await this.getAttachmentSource(this.resolvedAccounts[this.owners[row.ZNOTE]], sourcePath);
			const attachmentPath = await this.getAvailablePathForAttachment(`${finalAttachmentName}.${outExt}`, []);

			file = await this.vault.createBinary(
				attachmentPath, nodeBufferToArrayBuffer(binary),
				{ ctime: this.decodeTime(row.ZCREATIONDATE), mtime: this.decodeTime(row.ZMODIFICATIONDATE) }
			);
		}
		catch (e) {
			this.ctx.reportFailed(sourcePath);
			console.error(e);
			return null;
		}

		this.resolvedFiles[id] = file;
		this.ctx.reportAttachmentSuccess(`${finalAttachmentName}.${outExt}`);
		return file;
	}

	/** A link to a file, in whichever form the vault is set to write. See ANContext. */
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

	async getAttachmentSource(account: ANAccount, sourcePath: string): Promise<Buffer<ArrayBuffer>> {
		try {
			return await fsPromises.readFile(path.join(account.path, sourcePath));
		}
		catch {
			return await fsPromises.readFile(path.join(os.homedir(), NOTE_FOLDER_PATH, sourcePath));
		}
	}

	/**
	 * The note an earlier import left at this title, if there is one.
	 *
	 * A note this run already wrote is not that. Apple Notes lets two notes
	 * share a title, and the second is a note of its own - it gets a copy's
	 * name rather than being treated as an update of the first and collapsing
	 * into it.
	 *
	 * Matching on the title is what makes this approximate: a note renamed in
	 * Apple Notes reads as a new one. Recognising it properly needs the id the
	 * source carries, which is not written down yet.
	 */
	private async previouslyImported(folder: TFolder, title: string, noteId?: string): Promise<TFile | null> {
		if (this.duplicateHandling === DuplicateHandling.CreateCopy) return null;

		// Normalized, because what it is held against is: the vault's own paths,
		// and the ones this run has written. At the vault root path.join leaves a
		// leading slash that neither of those carries.
		const fullPath = normalizePath(path.join(folder.path, `${sanitizeFileName(title).replace(/\.md$/i, '')}.md`));
		if (this.claimedPaths.has(fullPath)) return null;

		const existingFile = this.vault.getAbstractFileByPath(fullPath);
		if (!(existingFile instanceof TFile)) return null;

		// A note that carries an id says which note it is. A different one is a
		// note of its own however much the titles agree, and one with no id at
		// all was written before ids were, so the title is all there is to go on.
		const existingId = await this.sourceIdOf(existingFile, NOTE_ID_PROPERTY);
		if (existingId && noteId && existingId !== noteId) return null;

		return existingFile;
	}

	/**
	 * The id a note was imported from, for the next import to recognise it by.
	 *
	 * Only written where it will be read. An Apple Notes import is usually a
	 * one-time move, and a property in every note of a vault that will never be
	 * imported into again is clutter that earns nothing. Choosing to skip or to
	 * update existing notes is what says otherwise.
	 */
	private noteIdFrontMatter(noteId: string | undefined): string {
		if (this.duplicateHandling === DuplicateHandling.CreateCopy || !noteId) return '';

		return serializeFrontMatter({ [NOTE_ID_PROPERTY]: noteId });
	}

	async saveAsMarkdownFile(folder: TFolder, title: string, content: string, options?: DataWriteOptions): Promise<TFile> {
		const file = await super.saveAsMarkdownFile(folder, title, content, options);
		this.claimedPaths.add(file.path);

		return file;
	}
}
