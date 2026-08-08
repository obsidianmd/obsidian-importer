import { App, DataWriteOptions, debounce, normalizePath, Platform, SecretComponent, Setting, TFile, TFolder, Vault } from 'obsidian';
import { getAllFiles, NodePickedFile, NodePickedFolder, path, parseFilePath, PickedFile, WebPickedFile } from './filesystem';
import { HostPlugin } from './plugin-data';
import { AuthCallback } from './constants';
import { FolderSuggest } from './folder-suggest';
import { ImportContext } from './import-context';
import { createMarkdown, formatMarkdown, markdownOutputFor, modifyMarkdown, standardizeMarkdownFile } from './markdown-output';
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

export type ImporterStep = 'source' | 'options';

export interface ImporterHost {
	sourceEl: HTMLElement | null;
	optionsEl: HTMLElement | null;
	plugin: HostPlugin;
	importerId: string;
	sourceChanged?(): void;
	abortController: AbortController;
}

export abstract class FormatImporter {
	app: App;
	vault: Vault;
	host: ImporterHost;

	files: PickedFile[] = [];
	outputLocation: string = '';
	notAvailable: boolean = false;
	duplicateHandling: DuplicateHandling = DuplicateHandling.CreateCopy;

	// Controls which interruption buttons the importer supports.
	interruption: 'none' | 'stop' | 'pause' = 'none';

	/** Cached value for getOutputFolder. Do not use directly. */
	private outputFolder: TFolder | null = null;

	/** Markdown written by this run, for the post-import Obsidian link pass. */
	private markdownFiles = new Set<string>();

	/** SecretStorage id of the credential linked to this importer, if any. */
	private secretId: string | null = null;

	readonly ready: Promise<void>;

	private pending: Promise<unknown>[] = [];

	constructor(app: App, host: ImporterHost) {
		this.app = app;
		this.vault = app.vault;
		this.host = host;
		// init() may queue additional startup work through whenReady().
		this.ready = Promise.resolve(this.init())
			.then(() => Promise.all(this.pending))
			.then(() => undefined);

		this.ready.catch(e => console.error('Importer failed to initialise', e));
	}

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

	get sourceReady(): boolean {
		return this.files.length > 0;
	}

	protected sourceChanged(): void {
		this.host.sourceChanged?.();
	}

	protected stepEl(step: ImporterStep): HTMLElement | null {
		return step === 'source' ? this.host.sourceEl : this.host.optionsEl;
	}

	protected addSetting(step: ImporterStep = 'options'): Setting | null {
		const contentEl = this.stepEl(step);
		return contentEl ? new Setting(contentEl) : null;
	}

	protected draw<T>(build: (contentEl: HTMLElement) => T, step: ImporterStep = 'options'): T | undefined {
		const contentEl = this.stepEl(step);
		return contentEl ? build(contentEl) : undefined;
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
		let setting = this.addSetting('source');

		if (!setting) {
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
					this.sourceChanged();
					await this.saveSecretId(this.secretId);
				});

			this.loadSecretId()
				.then(secretId => {
					this.secretId = secretId;
					component.setValue(secretId ?? '');
					this.sourceChanged();
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
		const fileLocationSetting = this.addSetting('source');
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
							title: 'Folders to import',
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
			this.sourceChanged();

			if (this.files.length === 0) {
				fileLocationSetting.setDesc(`Nothing to import there. Pick ${extensions.map(e => '.' + e).join(', ')} files, or a folder holding some.`);
				return;
			}

			let pathText = this.files.map(f => f.name).join(', ');
			if (pathText.length > MAX_PATH_DESCRIPTION_LENGTH) {
				pathText = pathText.substring(0, MAX_PATH_DESCRIPTION_LENGTH) + '...';
			}

			fileLocationSetting.setDesc(createFragment(frag => {
				if (this.files.length > 1) {
					frag.createSpan({ text: `${plural(this.files.length, 'file')} will be imported: ` });
					frag.createEl('br');
				}

				frag.createSpan({ cls: 'u-pop', text: pathText });
			}));
		};
	}

	protected addDuplicateHandlingSetting(options: {
		idProperty?: string;
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

	private saveOutputLocation = debounce((location: string) => {
		void (async () => {
			try {
				let data = await this.host.plugin.loadData();
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
		// The vault method only reads parent from this stand-in.
		let sourceFile: { parent: TFolder } | null = null;

		// If sourcePath is provided, use its parent folder for attachment placement
		// This is important for respecting user's "Same folder as current file" setting
		if (sourcePath) {
			const { parent } = parseFilePath(sourcePath);
			if (parent) {
				const existing = this.vault.getAbstractFileByPath(normalizePath(parent));
				const parentFolder = existing instanceof TFolder ? existing : await this.createFolders(parent);
				sourceFile = { parent: parentFolder };
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

	/**
	 * Apply settings that need the whole import to exist, notably shortest and
	 * relative links. Called by both interactive and scripted import entrypoints.
	 */
	async finalizeMarkdownOutput(ctx?: ImportContext): Promise<void> {
		const previousStatus = ctx?.statusMessage ?? '';
		try {
			if (this.markdownFiles.size > 0) ctx?.status('Waiting for imported Markdown…');
			await this.waitForExternalMarkdownWrites();

			const total = this.markdownFiles.size;
			let current = 0;
			for (const path of this.markdownFiles) {
				ctx?.status(`Standardizing Markdown (${++current}/${total})`);
				const file = this.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) {
					const error = new Error('The imported file did not appear in the vault.');
					if (ctx) ctx.reportFailed(path, error);
					else console.error(`Failed to standardize Markdown links in: ${path}`, error);
					continue;
				}
				try {
					await standardizeMarkdownFile(this.app, file);
				}
				catch (error) {
					if (ctx) ctx.reportFailed(file.path, error);
					else console.error(`Failed to standardize Markdown links in: ${file.path}`, error);
				}
			}
		}
		catch (error) {
			if (ctx) ctx.reportFailed('Markdown finalization', error);
			else console.error('Failed to finalize imported Markdown', error);
		}
		finally {
			this.markdownFiles.clear();
			if (ctx) ctx.status(previousStatus);
		}
	}

	/** Direct filesystem writers arrive in Vault through its watcher. */
	private async waitForExternalMarkdownWrites(): Promise<void> {
		const missing = new Set([...this.markdownFiles]
			.filter(path => !(this.vault.getAbstractFileByPath(path) instanceof TFile)));
		if (missing.size === 0) return;

		await new Promise<void>(resolve => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				this.vault.offref(ref);
				window.clearTimeout(timeout);
				resolve();
			};
			const ref = this.vault.on('create', file => {
				missing.delete(file.path);
				if (missing.size === 0) finish();
			});
			const timeout = window.setTimeout(finish, 2_000);

			// Close the race between the first check and registering the listener.
			for (const path of missing) {
				if (this.vault.getAbstractFileByPath(path) instanceof TFile) missing.delete(path);
			}
			if (missing.size === 0) finish();
		});
	}

	/** Register Markdown written outside createFile (for example by Yarle). */
	trackMarkdownFile(file: TFile | string): void {
		const path = typeof file === 'string' ? normalizePath(file) : file.path;
		if (path.toLowerCase().endsWith('.md')) this.markdownFiles.add(path);
	}

	async createMarkdown(path: string, content: string, options?: DataWriteOptions): Promise<TFile> {
		const file = await createMarkdown(this.vault, path, content, options);
		this.trackMarkdownFile(file);
		return file;
	}

	async modifyMarkdown(file: TFile, content: string, options?: DataWriteOptions): Promise<void> {
		await modifyMarkdown(this.vault, file, content, options);
		this.trackMarkdownFile(file);
	}

	// Utility functions for vault

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

	async createFile(folder: TFolder, fileName: string, content: string, options?: DataWriteOptions): Promise<TFile> {
		const path = getUniqueFilePath(this.vault, folder.path, fileName);

		if (path.toLowerCase().endsWith('.md')) {
			content = formatMarkdown(content, markdownOutputFor(this.vault));
		}

		const file = await this.vault.create(path, content, options);
		this.trackMarkdownFile(file);
		return file;
	}

	protected sourceIdIn(content: string, idProperty: string): string | null {
		const parsed = parseFrontMatterBlock(content);
		const id: unknown = parsed?.frontMatter[idProperty];

		return typeof id === 'string' ? id : null;
	}

	protected async sourceIdOf(file: TFile, idProperty: string): Promise<string | null> {
		try {
			return this.sourceIdIn(await this.vault.read(file), idProperty);
		}
		catch (error) {
			console.error(`Failed to read frontmatter from: ${file.path}`, error);
			return null;
		}
	}

	protected async noteImportedFrom(path: string, idProperty: string, sourceId: string): Promise<TFile | null> {
		const file = this.vault.getAbstractFileByPathInsensitive(normalizePath(path));
		if (!(file instanceof TFile)) return null;

		return await this.sourceIdOf(file, idProperty) === sourceId ? file : null;
	}

	async createBinaryFile(folder: TFolder, fileName: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
		const path = getUniqueFilePath(this.vault, folder.path, fileName);

		return await this.vault.createBinary(path, data, options);
	}

	async saveAsMarkdownFile(folder: TFolder, title: string, content: string, options?: DataWriteOptions): Promise<TFile> {
		const sanitizedName = sanitizeFileName(title).replace(/\.md$/i, '');

		return await this.createFile(folder, `${sanitizedName}.md`, content, options);
	}
}
