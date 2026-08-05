import { App, normalizePath, Platform, SecretComponent, Setting, TFile, TFolder, Vault } from 'obsidian';
import { getAllFiles, NodePickedFile, NodePickedFolder, path, parseFilePath, PickedFile, WebPickedFile } from './filesystem';
import ImporterPlugin, { ImportContext, AuthCallback } from './main';
import { sanitizeFileName } from './util';

const MAX_PATH_DESCRIPTION_LENGTH = 300;

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
	plugin: ImporterPlugin;
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

	/** Cached value for getOutputFolder. Do not use directly. */
	private outputFolder: TFolder | null = null;

	/** SecretStorage id of the credential linked to this importer, if any. */
	private secretId: string | null = null;

	/**
	 * Settles when init() has finished and everything it started has arrived -
	 * the linked credential, a session restored from a stored token.
	 *
	 * The dialog does not wait for this: it draws what it has and fills the
	 * rest in as it lands. An import driven without one has nothing to redraw,
	 * so it waits, or it would run before it knew who it was.
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
		const initialised = this.init();
		if (initialised instanceof Promise) {
			initialised.catch(e => console.error('Importer failed to initialise', e));
		}

		// init() is what fills `pending`, so this is built from it afterwards
		this.ready = Promise.resolve(initialised)
			.then(() => Promise.all(this.pending))
			.then(() => undefined)
			.catch(e => console.error('Importer failed to initialise', e));
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

	addOutputLocationSetting(defaultExportFolderName: string) {
		this.outputLocation = defaultExportFolderName;
		this.addSetting()
			?.setName('Output folder')
			.setDesc('Choose a folder in the vault to put the imported files. Leave empty to output to vault root.')
			.addText(text => text
				.setValue(defaultExportFolderName)
				.onChange(value => {
					this.outputLocation = value;
					this.outputFolder = null;
				}));
	}

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

	async pause(durationSeconds: number, reason: string, ctx: ImportContext | undefined): Promise<void> {
		const promise = new Promise(resolve => window.setTimeout(resolve, durationSeconds * 1_000));

		if (ctx) {
			const previousStatusMessage = ctx.statusMessage;
			ctx.status(`⏸️ Pausing import for ${durationSeconds} seconds (${reason})`);
			await promise;
			ctx.status(previousStatusMessage);
		}
		else {
			await promise;
		}
	}

	abstract import(ctx: ImportContext): Promise<void>;

	// Utility functions for vault

	/** Remove any characters that would be illegal on any platform. */
	sanitizeFilePath(path: string): string {
		return path.replace(/[:|?<>*\\]/g, '');
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

	async saveAsMarkdownFile(folder: TFolder, title: string, content: string): Promise<TFile> {
		let sanitizedName = sanitizeFileName(title);
		// @ts-ignore
		return await this.app.fileManager.createNewMarkdownFile(folder, sanitizedName, content);
	}
}
