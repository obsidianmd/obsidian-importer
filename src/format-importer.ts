import { App, DataWriteOptions, debounce, normalizePath, Platform, SecretComponent, Setting, TFile, TFolder, Vault } from 'obsidian';
import { getAllFiles, NodePickedFile, NodePickedFolder, path, parseFilePath, PickedFile, WebPickedFile } from './filesystem';
import { HostPlugin } from './plugin-data';
import { AuthCallback } from './constants';
import { FolderSuggest } from './folder-suggest';
import { ImportContext } from './import-context';
import { getUniqueFilePath, parseFrontMatterBlock, plural, sanitizeFileName, sanitizeFilePath } from './util';

const MAX_PATH_DESCRIPTION_LENGTH = 300;

export enum DuplicateHandling {
	Skip = 'skip',
	ImportUpdated = 'import-updated',
	CreateCopy = 'create-copy',
}

const DUPLICATE_HANDLING_LABELS: Record<DuplicateHandling, string> = {
	[DuplicateHandling.Skip]: 'Skip import',
	[DuplicateHandling.ImportUpdated]: 'Import only updated',
	[DuplicateHandling.CreateCopy]: 'Create a copy',
};

/**
 * What an importer needs besides the vault: somewhere to draw its settings,
 * the plugin that stores its credentials, and which importer it is.
 *
 * The dialog is one host. An import driven from a script or a test is another,
 * with no element to draw into - every setting then stays at its default, and
 * the caller sets what it needs directly.
 */
export interface ImporterHost {
	/** Where settings are drawn, or null when there is no dialog. */
	contentEl: HTMLElement | null;
	plugin: HostPlugin;
	/**
	 * Which importer this is, for scoping the credential it stores.
	 *
	 * Not `id`: a host is often something that already has one - the dialog is
	 * a Modal, and Obsidian sets an id on those.
	 */
	importerId: string;
	/** Aborted when the user cancels, for anything that outlives a check. */
	abortController: AbortController;
}

export abstract class FormatImporter {
	app: App;
	vault: Vault;
	host: ImporterHost;

	files: PickedFile[] = [];
	outputLocation: string = '';
	notAvailable: boolean = false;
	/** See addDuplicateHandlingSetting. Copy unless the importer offers a choice. */
	duplicateHandling: DuplicateHandling = DuplicateHandling.CreateCopy;

	/**
	 * How far the dialog can interrupt this import, which is which of its
	 * buttons it draws.
	 *
	 * 'none'  - import() never asks, so neither button appears
	 * 'stop'  - it asks, but not somewhere it can be held: Stop only
	 * 'pause' - it awaits shouldStop() between items, close enough together
	 *           that holding at one feels immediate
	 *
	 * The two are separate because they are asked for different things. Stop
	 * is "wind up when you can", and arriving a moment later still did what it
	 * said. Pause is "hold now", so an importer whose next checkpoint is
	 * minutes away has no Pause worth offering: Evernote reads a whole .enex
	 * before it can be held, while stopping lands within a note.
	 *
	 * Left at 'none' so an importer nobody has thought about this for draws no
	 * button, rather than one that does nothing when pressed.
	 */
	interruption: 'none' | 'stop' | 'pause' = 'none';

	/** Cached value for getOutputFolder. Do not use directly. */
	private outputFolder: TFolder | null = null;

	/** SecretStorage id of the credential linked to this importer, if any. */
	private secretId: string | null = null;

	/**
	 * Settles when init() has finished and everything it started has arrived -
	 * the linked credential, a session restored from a stored token.
	 *
	 * The dialog does not wait for this: it draws what it has and fills the
	 * rest in as it lands, and a failure is reported to the console. An import
	 * driven without one has nothing to redraw, so it waits - and rejects, so
	 * a script hears about a credential that never arrived rather than running
	 * as nobody.
	 */
	readonly ready: Promise<void>;

	/** What ready waits for, beyond init() itself. */
	private pending: Promise<unknown>[] = [];

	constructor(app: App, host: ImporterHost) {
		this.app = app;
		this.vault = app.vault;
		this.host = host;
		// OneNote's init is async because it may restore a session before it can
		// draw its settings. A constructor cannot await, so the failure path is
		// logged here: the importer still opens, just without a signed-in state.
		// init() is what fills `pending`, so this is built from it afterwards
		this.ready = Promise.resolve(this.init())
			.then(() => Promise.all(this.pending))
			.then(() => undefined);

		// Nothing awaits `ready` when there is a dialog - it draws what it has
		// and fills the rest in as it lands - so the failure is reported here.
		// It stays on `ready` for an import that does await it.
		this.ready.catch(e => console.error('Importer failed to initialise', e));
	}

	/**
	 * Something init() started that an import must not run ahead of. See ready.
	 */
	protected whenReady(work: Promise<unknown>): void {
		this.pending.push(work);
	}

	abstract init(): void | Promise<void>;

	/**
	 * Optional: Show template configuration UI and prepare data for import.
	 * This will be called as a configuration step before the import progress.
	 *
	 * Overriding functions are responsible for displaying errors before returning false.
	 *
	 * @param ctx The import context
	 * @param container The container element to show the configuration UI in
	 * @returns true if configuration was successful, false if cancelled or failed, null if no configuration needed
	 */
	async showTemplateConfiguration(ctx: ImportContext, container: HTMLElement): Promise<boolean | null> {
		return null;
	}

	/**
	 * Register a function to be called when the `obsidian://importer-auth/` open
	 * event is received by Obsidian.
	 *
	 * Note: The callback will be cleared after being called. It must be
	 * reregistered if a subsequent auth event is expected.
	 */
	registerAuthCallback(callback: AuthCallback): void {
		this.host.plugin.registerAuthCallback(callback);
	}

	/**
	 * A setting for this importer, or null when there is no dialog to draw in.
	 *
	 * An import run without one - from a script, or a test - draws nothing, so
	 * a setting's only lasting effect is the default it was given. Assign that
	 * default outside the chain, not in the component's callback.
	 */
	protected addSetting(): Setting | null {
		return this.host.contentEl ? new Setting(this.host.contentEl) : null;
	}

	/** Draw into the dialog, if there is one. */
	protected draw<T>(build: (contentEl: HTMLElement) => T): T | undefined {
		return this.host.contentEl ? build(this.host.contentEl) : undefined;
	}

	/**
	 * Add a setting for a credential kept in Obsidian's keychain.
	 *
	 * The credential itself lives in SecretStorage. All this plugin persists is
	 * the id of the secret the user linked, so a token is remembered between
	 * sessions without the importer ever writing it to its own data file.
	 *
	 * Read the credential back with getSecret().
	 */
	addSecretSetting(name: string, description?: string | DocumentFragment): Setting | null {
		let setting = this.addSetting();

		if (!setting) {
			// No dialog to fill in, but an import driven from a script still
			// needs the credential the user linked, so it is read all the same -
			// and waited for, since the import reads it straight away.
			this.whenReady(this.loadSecretId()
				.then(secretId => this.secretId = secretId)
				.catch(e => console.error('Could not read the linked secret', e)));

			return null;
		}

		setting.setName(name);

		if (description) {
			setting.setDesc(description);
		}

		setting.addComponent(el => {
			let component = new SecretComponent(this.app, el)
				.onChange(async secretId => {
					this.secretId = secretId || null;
					await this.saveSecretId(this.secretId);
				});

			// Plugin data is only readable asynchronously, and init() is not, so
			// the previously linked secret is filled in once it arrives. Nothing
			// can await this, so a failure is logged rather than left unhandled -
			// the field simply stays empty and the user picks the secret again.
			this.loadSecretId()
				.then(secretId => {
					this.secretId = secretId;
					component.setValue(secretId ?? '');
				})
				.catch(e => console.error('Could not read the linked secret', e));

			return component;
		});

		return setting;
	}

	/**
	 * The credential linked via addSecretSetting, or null if none is linked or
	 * the secret has since been removed from the keychain.
	 */
	getSecret(): string | null {
		if (!this.secretId) {
			return null;
		}
		return this.app.secretStorage.getSecret(this.secretId);
	}

	private async loadSecretId(): Promise<string | null> {
		let data = await this.host.plugin.loadData();
		return data.secrets?.[this.host.importerId] ?? null;
	}

	private async saveSecretId(secretId: string | null): Promise<void> {
		let data = await this.host.plugin.loadData();

		// Copy rather than mutate: loadData shallow-merges DEFAULT_DATA, so a
		// data file with no secrets yet hands back the default object itself,
		// and writing into it would leave stale ids on the module-level default
		// for the rest of the session.
		let secrets = { ...data.secrets };

		if (secretId) {
			secrets[this.host.importerId] = secretId;
		}
		else {
			delete secrets[this.host.importerId];
		}

		data.secrets = secrets;

		await this.host.plugin.saveData(data);
	}

	addFileChooserSetting(name: string, extensions: string[], allowMultiple: boolean = false, description?: string, defaultPath?: string) {
		const fileLocationSetting = this.addSetting();
		// Nothing to pick without a dialog: the caller sets this.files itself
		if (!fileLocationSetting) return;

		fileLocationSetting
			.setName('Files to import')
			.setDesc(description || 'Pick the files that you want to import.')
			.addButton(button => button
				.setButtonText(allowMultiple ? 'Choose files' : 'Choose file')
				.onClick(async () => {
					if (Platform.isDesktopApp) {
						let properties = ['openFile', 'dontAddToRecent'];
						if (allowMultiple) {
							properties.push('multiSelections');
						}
						let filePaths: string[] = window.electron.remote.dialog.showOpenDialogSync({
							title: 'Pick files to import', properties,
							filters: [{ name, extensions }],
							defaultPath: defaultPath || undefined,
						});

						if (filePaths && filePaths.length > 0) {
							this.files = filePaths.map((filepath: string) => new NodePickedFile(filepath));
							updateFiles();
						}
					}
					else {
						let inputEl = createEl('input');
						inputEl.type = 'file';
						inputEl.accept = extensions.map(e => '.' + e.toLowerCase()).join(',');
						inputEl.addEventListener('change', () => {
							if (!inputEl.files) return;
							let files = Array.from(inputEl.files);
							if (files.length > 0) {
								this.files = files.map(file => new WebPickedFile(file))
									.filter(file => extensions.contains(file.extension));
								updateFiles();
							}
						});
						inputEl.click();
					}
				}));

		if (allowMultiple && Platform.isDesktopApp) {
			fileLocationSetting.addButton(button => button
				.setButtonText('Choose folders')
				.onClick(async () => {
					if (Platform.isDesktopApp) {
						let filePaths: string[] = window.electron.remote.dialog.showOpenDialogSync({
							title: 'Pick folders to import',
							properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
							defaultPath: defaultPath || undefined,
						});

						if (filePaths && filePaths.length > 0) {
							fileLocationSetting.setDesc('Reading folders...');
							let folders = filePaths.map((filepath: string) => new NodePickedFolder(filepath));
							this.files = await getAllFiles(folders, (file: PickedFile) => extensions.contains(file.extension));
							updateFiles();
						}
					}
				}));
		}

		let updateFiles = () => {
			let descriptionFragment = createFragment();
			let fileCount = this.files.length;
			let pathText = this.files.map(f => f.name).join(', ');
			if (pathText.length > MAX_PATH_DESCRIPTION_LENGTH) {
				pathText = pathText.substring(0, MAX_PATH_DESCRIPTION_LENGTH) + '...';
			}
			descriptionFragment.createSpan({ text: `These ${fileCount} files will be imported: ` });
			descriptionFragment.createEl('br');
			descriptionFragment.createSpan({ cls: 'u-pop', text: pathText });
			fileLocationSetting.setDesc(descriptionFragment);
		};
	}

	/**
	 * Let the user say what to do with a note the vault already holds.
	 *
	 * Only for an importer that can recognise a note it wrote before. It says
	 * which property carries the id, and which modes it can honour: an importer
	 * that skips but does not compare times leaves ImportUpdated out rather
	 * than offering a mode that behaves as Skip.
	 *
	 * An importer that offers nothing here keeps the default, and every import
	 * it runs adds notes and writes over none.
	 */
	protected addDuplicateHandlingSetting(options: {
		/** The property that carries the source id, where the importer has one. */
		idProperty?: string;
		/** The modes to offer. All three, unless the importer says otherwise. */
		modes?: DuplicateHandling[];
	} = {}): void {
		const setting = this.addSetting();
		if (!setting) return;

		const { idProperty, modes = [DuplicateHandling.Skip, DuplicateHandling.ImportUpdated, DuplicateHandling.CreateCopy] } = options;
		const copy = DUPLICATE_HANDLING_LABELS[DuplicateHandling.CreateCopy];

		setting
			.setName('Notes already in the vault')
			.setDesc(idProperty
				? `What to do when a note is already there. Every mode but "${copy}" adds a` +
					` ${idProperty} property to each note, so that a later import knows which note is which.`
				: `What to do when a note is already there. Every mode but "${copy}" finds that note by its file name.`)
			.addDropdown(dropdown => {
				for (const mode of modes) dropdown.addOption(mode, DUPLICATE_HANDLING_LABELS[mode]);

				dropdown
					.setValue(this.duplicateHandling)
					.onChange(value => this.duplicateHandling = value as DuplicateHandling);
			});
	}

	/**
	 * Where the import writes, remembered between runs. The name passed in is
	 * the fallback for an importer that has not been run before.
	 */
	addOutputLocationSetting(defaultExportFolderName: string) {
		this.outputLocation = defaultExportFolderName;
		this.addSetting()
			?.setName('Output folder')
			.setDesc('Choose a folder in the vault to put the imported files. Leave empty to output to vault root.')
			.addText(text => {
				text
					.setValue(defaultExportFolderName)
					.onChange(value => {
						this.outputLocation = value;
						this.outputFolder = null;
						this.saveOutputLocation(value);
					});
				new FolderSuggest(this.app, text.inputEl);

				// Plugin data is only readable asynchronously, and init() is not,
				// so the remembered folder is filled in once it arrives. Nothing
				// can await it, so a failure leaves the default in place.
				this.loadOutputLocation()
					.then(location => {
						if (location === null) return;
						this.outputLocation = location;
						this.outputFolder = null;
						text.setValue(location);
					})
					.catch(e => console.error('Could not read the output folder', e));
			});
	}

	private async loadOutputLocation(): Promise<string | null> {
		let data = await this.host.plugin.loadData();
		return data.outputLocations?.[this.host.importerId] ?? null;
	}

	/** Debounced: onChange runs per keystroke, and each save rewrites the file. */
	private saveOutputLocation = debounce((location: string) => {
		void (async () => {
			try {
				let data = await this.host.plugin.loadData();
				// Copy rather than mutate, for the reason saveSecretId gives.
				data.outputLocations = { ...data.outputLocations, [this.host.importerId]: location };
				await this.host.plugin.saveData(data);
			}
			catch (e) {
				console.error('Could not remember the output folder', e);
			}
		})();
	}, 1000, true);

	async getOutputFolder(): Promise<TFolder | null> {
		if (this.outputFolder) {
			return this.outputFolder;
		}

		let { vault } = this.app;

		let folderPath = this.outputLocation;
		if (folderPath === '') {
			folderPath = '/';
		}
		folderPath = normalizePath(folderPath);

		let folder = vault.getAbstractFileByPath(folderPath);

		if (folder === null || !(folder instanceof TFolder)) {
			await vault.createFolder(folderPath);
			folder = vault.getAbstractFileByPath(folderPath);
		}

		if (folder instanceof TFolder) {
			this.outputFolder = folder;
			return folder;
		}

		return null;
	}

	/**
	 * Resolves a unique path for the attachment file being saved.
	 * Ensures that the parent directory exists and dedupes the
	 * filename if the destination filename already exists.
	 *
	 * NOTE: This is a duplicate of `fileManager.getAvailablePathForAttachment`
	 * which adds two key adjustments to aid Importer:
	 *   - Use the provided `sourcePath` even if the file doesn't exist yet.
	 *   - Avoid duplicating a list of provided filesnames that do not yet exist, but will in the future.
	 *
	 * @param filename Name of the attachment being saved
	 * @param claimedPaths List of filepaths that may not exist yet but will in the future.
	 * @param sourcePath Optional path of the current file being imported (for "Same folder as current file" setting)
	 * @returns Full path for where the attachment should be saved, according to the user's settings
	 */
	async getAvailablePathForAttachment(filename: string, claimedPaths: string[], sourcePath?: string): Promise<string> {
		// XXX: (Ab)use the fact that getAvailablePathForAttachments only looks at
		// sourceFile.parent, so a stand-in carrying just the folder is enough.
		let sourceFile: { parent: TFolder } | null = null;

		// If sourcePath is provided, use its parent folder for attachment placement
		// This is important for respecting user's "Same folder as current file" setting
		if (sourcePath) {
			const { parent } = parseFilePath(sourcePath);
			if (parent) {
				const parentFolder = this.vault.getAbstractFileByPath(normalizePath(parent));
				if (parentFolder instanceof TFolder) {
					sourceFile = { parent: parentFolder };
				}
			}
		}

		// Fallback to outputFolder if sourcePath not provided or parent folder not found
		if (!sourceFile) {
			const outputFolder = await this.getOutputFolder();
			sourceFile = outputFolder ? { parent: outputFolder } : null;
		}

		const { basename, extension } = parseFilePath(filename);

		// Use getAvailablePathForAttachments because it can give us the configured output path.
		//@ts-ignore
		const prelimOutPath = await this.vault.getAvailablePathForAttachments(basename, extension, sourceFile);
		const parsedPrelimOutPath = parseFilePath(prelimOutPath);

		const fullExt = parsedPrelimOutPath.extension ?
			'.' + parsedPrelimOutPath.extension
			: '.' + extension;

		// Increase number until the path is unique.
		let i = 1;
		let outputPath = prelimOutPath;
		while (claimedPaths.includes(outputPath) || !!this.vault.getAbstractFileByPath(outputPath)) {
			outputPath = path.join(parsedPrelimOutPath.parent, `${parsedPrelimOutPath.name} ${i}${fullExt}`);
			i++;
		}

		// Normalize the final outputPath before returning
		return normalizePath(outputPath);
	}

	/**
	 * Wait, because the far end has asked us to, saying so where the import
	 * says what it is doing.
	 *
	 * Not ctx.pause(), which is the user holding the import until they lift it.
	 * This one ends on its own, and the word is kept away from it so that the
	 * status line means one thing: an import that says it is paused was paused
	 * by someone.
	 */
	async backOff(durationSeconds: number, reason: string, ctx: ImportContext | undefined): Promise<void> {
		const promise = new Promise(resolve => window.setTimeout(resolve, durationSeconds * 1_000));

		if (ctx) {
			const previousStatusMessage = ctx.statusMessage;
			ctx.status(`Waiting ${plural(durationSeconds, 'second')} (${reason})`);
			await promise;
			ctx.status(previousStatusMessage);
		}
		else {
			await promise;
		}
	}

	abstract import(ctx: ImportContext): Promise<void>;

	// Utility functions for vault

	/** Make a path out of names that came from the source. See sanitizeFilePath. */
	sanitizeFilePath(path: string): string {
		return sanitizeFilePath(path);
	}

	/**
	 * Recursively create folders, if they don't exist.
	 */
	async createFolders(path: string): Promise<TFolder> {
		// can't create folders starting with a dot
		const sanitizedPath = path.split('/').map(segment => segment.replace(/^\.+/, '')).join('/');
		let normalizedPath = normalizePath(sanitizedPath);
		let folder = this.vault.getAbstractFileByPathInsensitive(normalizedPath);
		if (folder && folder instanceof TFolder) {
			return folder;
		}

		await this.vault.createFolder(normalizedPath);
		folder = this.vault.getAbstractFileByPathInsensitive(normalizedPath);
		if (!(folder instanceof TFolder)) {
			throw new Error(`Failed to create folder at "${path}"`);
		}

		return folder;
	}

	/**
	 * Write a file at a name no existing file occupies.
	 *
	 * The one place an importer creates something in the vault, so that what
	 * happens when a name is taken is answered once. It is answered the way
	 * Obsidian answers it: getUniqueFilePath defers to Vault.getAvailablePath,
	 * which appends " 1", " 2" and compares case-insensitively, so nothing an
	 * import writes lands on a note that is already there.
	 *
	 * Two notes wanting one name are two notes. Recognising that an incoming
	 * note is one an earlier import already wrote is a different question -
	 * it needs an id from the source, not a file name - and belongs to the
	 * importers that carry one.
	 *
	 * @param fileName - Name with extension, e.g. "Note.md"
	 */
	async createFile(folder: TFolder, fileName: string, content: string, options?: DataWriteOptions): Promise<TFile> {
		const path = getUniqueFilePath(this.vault, folder.path, fileName);

		return await this.vault.create(path, content, options);
	}

	/**
	 * The id an earlier import wrote into a note, if it wrote one.
	 *
	 * Read out of the note's own text rather than the metadata cache: the cache
	 * is filled in afterwards, so a note written moments ago in this same import
	 * reads as having no frontmatter at all.
	 */
	protected sourceIdIn(content: string, idProperty: string): string | null {
		const parsed = parseFrontMatterBlock(content);
		const id: unknown = parsed?.frontMatter[idProperty];

		return typeof id === 'string' ? id : null;
	}

	/** sourceIdIn, for a caller that has the note rather than its text. */
	protected async sourceIdOf(file: TFile, idProperty: string): Promise<string | null> {
		try {
			return this.sourceIdIn(await this.vault.read(file), idProperty);
		}
		catch (error) {
			console.error(`Failed to read frontmatter from: ${file.path}`, error);
			return null;
		}
	}

	/**
	 * The note an earlier import wrote for this record, if it is still there.
	 *
	 * Confirms rather than searches: the note at the path the record would take
	 * is the candidate, and the id it carries says whether it is really that
	 * record. A note that carries a different one is a note of its own.
	 *
	 * Case-insensitively, because the filesystem is: a note that differs only in
	 * spelling is the same file, and an exact lookup would miss it and go on to
	 * write a second one.
	 */
	protected async noteImportedFrom(path: string, idProperty: string, sourceId: string): Promise<TFile | null> {
		const file = this.vault.getAbstractFileByPathInsensitive(normalizePath(path));
		if (!(file instanceof TFile)) return null;

		return await this.sourceIdOf(file, idProperty) === sourceId ? file : null;
	}

	/**
	 * Write an attachment at a name no existing file occupies.
	 *
	 * createFile for the things an import carries alongside its notes. The
	 * vault throws on a name that is taken rather than picking another, so a
	 * second attachment of a name fails its note without this.
	 *
	 * @param fileName - Name with extension, e.g. "photo.jpg"
	 */
	async createBinaryFile(folder: TFolder, fileName: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
		const path = getUniqueFilePath(this.vault, folder.path, fileName);

		return await this.vault.createBinary(path, data, options);
	}

	/**
	 * Write a note, optionally carrying the timestamps it had in the source.
	 *
	 * Callers hand the title both with and without the extension, which
	 * createNewMarkdownFile used to absorb: it treats a trailing ".md" as the
	 * extension it was about to add, and any other dot as part of the name.
	 */
	async saveAsMarkdownFile(folder: TFolder, title: string, content: string, options?: DataWriteOptions): Promise<TFile> {
		const sanitizedName = sanitizeFileName(title).replace(/\.md$/i, '');

		return await this.createFile(folder, `${sanitizedName}.md`, content, options);
	}
}
