import { App, DataWriteOptions, debounce, normalizePath, Platform, SecretComponent, Setting, TFile, TFolder, Vault } from 'obsidian';
import { getAllFiles, NodePickedFile, NodePickedFolder, parseFilePath, PickedFile, WebPickedFile } from './filesystem';
import { HostPlugin } from './plugin-data';
import { AuthCallback } from './constants';
import { FolderSuggest } from './folder-suggest';
import { ImportContext } from './import-context';
import { createMarkdown, formatMarkdown, markdownOutputFor, modifyMarkdown, standardizedMarkdown, standardizeMarkdownFile } from './markdown-output';
import { getUniqueFilePath, parseFrontMatterBlock, plural, sanitizeFileName, sanitizeFilePath } from './util';

const MAX_PATH_DESCRIPTION_LENGTH = 300;

export enum DuplicateHandling {
	CreateCopy = 'create-copy',
	Skip = 'skip',
	Update = 'update',
}

const DUPLICATE_HANDLING_LABELS: Record<DuplicateHandling, string> = {
	[DuplicateHandling.CreateCopy]: 'Create a copy',
	[DuplicateHandling.Skip]: 'Skip',
	[DuplicateHandling.Update]: 'Update',
};

/**
 * Where attachments land, mirroring Obsidian's "Default location for new
 * attachments". The import starts from whatever the vault is set to, so the
 * choice is visible, and changing it here does not touch the app setting.
 */
export type AttachmentLocationMode = 'vault' | 'folder' | 'note' | 'subfolder';

export interface AttachmentLocation {
	mode: AttachmentLocationMode;
	/** A folder for 'folder', a subfolder name for 'subfolder'; unused otherwise. */
	path: string;
}

const ATTACHMENT_MODE_LABELS: Record<AttachmentLocationMode, string> = {
	vault: 'Vault folder',
	folder: 'In the folder specified below',
	note: 'Same folder as the note',
	subfolder: 'In subfolder under the note',
};

/** Read the vault's attachment setting as a location this step can show. */
export function vaultAttachmentLocation(vault: Vault): AttachmentLocation {
	const configured = vault.getConfig('attachmentFolderPath');
	const value = typeof configured === 'string' ? configured.trim() : '';

	if (value === '' || value === '/') return { mode: 'vault', path: '' };
	if (value === '.' || value === './') return { mode: 'note', path: '' };
	if (value.startsWith('./')) return { mode: 'subfolder', path: value.slice(2) };

	return { mode: 'folder', path: normalizePath(value) };
}

/** What writeNote needs beyond the note itself. */
export interface NoteImport extends DataWriteOptions {
	/** The source's own id for this note, where it has one. */
	sourceId?: string;
}

export type ImporterStep = 'source' | 'output' | 'options';

export interface ImporterHost {
	sourceEl: HTMLElement | null;
	outputEl: HTMLElement | null;
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

	/**
	 * Folder the output step offers first. Set it in init(); do not give it a
	 * field initialiser in a subclass, which would run after init().
	 */
	defaultOutputFolder: string = 'Import';

	attachmentLocation: AttachmentLocation;
	duplicateHandling: DuplicateHandling = DuplicateHandling.CreateCopy;

	/** Duplicate modes this importer can honour. */
	duplicateModes: DuplicateHandling[] = [
		DuplicateHandling.CreateCopy,
		DuplicateHandling.Skip,
		DuplicateHandling.Update,
	];

	/**
	 * Frontmatter property this importer records the source's own id under, if
	 * the source has one. It is what lets a later import recognise a note that
	 * has since been renamed, and tell apart two notes the source allowed to
	 * share a title. Importers that set it must write it on every import,
	 * whatever duplicate mode is in force — an import that omits it locks the
	 * vault out of ever matching those notes again.
	 */
	idProperty: string | null = null;

	// Controls which interruption buttons the importer supports.
	interruption: 'none' | 'stop' | 'pause' = 'none';

	/** Cached value for getOutputFolder. Do not use directly. */
	private outputFolder: TFolder | null = null;

	/** Set once the output step has been built, so it is not built twice. */
	private outputStepDrawn: boolean = false;

	/** Markdown written by this run, for the post-import Obsidian link pass. */
	private markdownFiles = new Set<string>();

	/** Notes this run has written, so a second one cannot land on the first. */
	protected claimedPaths = new Set<string>();

	/** Source id to the note carrying it, built once per import. */
	private importedById: Map<string, TFile> | null = null;

	/** SecretStorage id of the credential linked to this importer, if any. */
	private secretId: string | null = null;

	readonly ready: Promise<void>;

	private pending: Promise<unknown>[] = [];

	constructor(app: App, host: ImporterHost) {
		this.app = app;
		this.vault = app.vault;
		this.host = host;
		// Start from the vault's own setting, so the output step opens showing
		// where attachments would have gone anyway.
		this.attachmentLocation = vaultAttachmentLocation(app.vault);
		// init() may queue additional startup work through whenReady().
		this.ready = Promise.resolve(this.init())
			.then(() => Promise.all(this.pending))
			.then(() => this.loadOutputSettings())
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
		switch (step) {
			case 'source':
				return this.host.sourceEl;
			case 'output':
				return this.host.outputEl;
			case 'options':
				return this.host.optionsEl;
		}
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

	/**
	 * The output step: where notes go, where attachments go, and what to do
	 * about notes that are already in the vault. The same for every importer,
	 * so the base class draws it rather than each importer adding its own.
	 *
	 * Called by the host once this.ready has resolved, so the settings the last
	 * import used are already in hand.
	 */
	drawOutputStep(): void {
		const contentEl = this.stepEl('output');
		if (!contentEl || this.outputStepDrawn) return;
		this.outputStepDrawn = true;

		this.addOutputFolderSetting(contentEl);
		this.addAttachmentLocationSetting(contentEl);
		this.addDuplicateHandlingSetting(contentEl);
	}

	private addOutputFolderSetting(contentEl: HTMLElement): void {
		new Setting(contentEl)
			.setName('Output folder')
			.setDesc('Choose a folder in the vault to put the imported files. Leave empty to output to vault root.')
			.addText(text => {
				text
					.setValue(this.outputLocation)
					.onChange(value => {
						this.outputLocation = value;
						this.outputFolder = null;
						this.saveOutputSettings();
					});
				new FolderSuggest(this.app, text.inputEl);
			});
	}

	private addAttachmentLocationSetting(contentEl: HTMLElement): void {
		const setting = new Setting(contentEl)
			.setName('Attachments')
			.setDesc('Where to put images and other files this import brings with it.');

		// The folder only means something for two of the modes, so it appears
		// under the dropdown the way Obsidian's own attachment setting does.
		const pathSetting = new Setting(contentEl)
			.setClass('importer-sub-setting');

		const drawPathSetting = () => {
			const { mode } = this.attachmentLocation;
			pathSetting.settingEl.toggle(mode === 'folder' || mode === 'subfolder');
			pathSetting.setName(mode === 'subfolder' ? 'Subfolder name' : 'Attachment folder');
		};

		setting.addDropdown(dropdown => {
			for (const mode of Object.keys(ATTACHMENT_MODE_LABELS) as AttachmentLocationMode[]) {
				dropdown.addOption(mode, ATTACHMENT_MODE_LABELS[mode]);
			}

			dropdown
				.setValue(this.attachmentLocation.mode)
				.onChange(value => {
					this.attachmentLocation = { ...this.attachmentLocation, mode: value as AttachmentLocationMode };
					drawPathSetting();
					this.saveOutputSettings();
				});
		});

		pathSetting.addText(text => {
			text
				.setValue(this.attachmentLocation.path)
				.onChange(value => {
					this.attachmentLocation = { ...this.attachmentLocation, path: value };
					this.saveOutputSettings();
				});
			new FolderSuggest(this.app, text.inputEl);
		});

		drawPathSetting();
	}

	private addDuplicateHandlingSetting(contentEl: HTMLElement): void {
		const modes = this.duplicateModes;
		if (modes.length < 2) return;

		new Setting(contentEl)
			.setName('Notes already in the vault')
			.setDesc(this.describeDuplicateHandling())
			.addDropdown(dropdown => {
				for (const mode of modes) dropdown.addOption(mode, DUPLICATE_HANDLING_LABELS[mode]);

				dropdown
					.setValue(this.duplicateHandling)
					.onChange(value => {
						this.duplicateHandling = value as DuplicateHandling;
						this.saveOutputSettings();
					});
			});
	}

	private describeDuplicateHandling(): DocumentFragment {
		return createFragment(frag => {
			frag.appendText('What to do when a note from this import is already in the vault.');
			frag.createEl('br');
			frag.appendText(`"${DUPLICATE_HANDLING_LABELS[DuplicateHandling.Update]}" leaves a note alone when it has not changed, `
				+ 'or when it has been edited in Obsidian since the last import.');
		});
	}

	private async loadOutputSettings(): Promise<void> {
		this.outputLocation = this.defaultOutputFolder;

		// A scripted import has no plugin to remember anything for.
		if (!this.host.plugin) return;

		try {
			const data = await this.host.plugin.loadData();

			// Folders remembered before the output step existed.
			const legacyFolder = data.outputLocations?.[this.host.importerId];
			if (legacyFolder !== undefined) this.outputLocation = legacyFolder;

			const saved = data.outputSettings?.[this.host.importerId];
			if (!saved) return;

			if (saved.folder !== undefined) this.outputLocation = saved.folder;
			if (saved.attachments) this.attachmentLocation = { ...saved.attachments };
			if (saved.duplicates && this.duplicateModes.includes(saved.duplicates)) {
				this.duplicateHandling = saved.duplicates;
			}
			this.outputFolder = null;
		}
		catch (e) {
			console.error('Could not read the output settings', e);
		}
	}

	private saveOutputSettings = debounce(() => {
		void (async () => {
			try {
				const data = await this.host.plugin.loadData();
				data.outputSettings = {
					...data.outputSettings,
					[this.host.importerId]: {
						folder: this.outputLocation,
						attachments: { ...this.attachmentLocation },
						duplicates: this.duplicateHandling,
					},
				};
				await this.host.plugin.saveData(data);
			}
			catch (e) {
				console.error('Could not remember the output settings', e);
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
	 * The folder this import puts attachments in, from the location picked on
	 * the output step. The vault's own setting is only the starting point: it
	 * was read into attachmentLocation when the importer was constructed, and
	 * the user may have changed it since.
	 */
	private async attachmentFolderPath(sourcePath?: string): Promise<string> {
		const { mode, path: configured } = this.attachmentLocation;

		if (mode === 'vault') return '/';
		if (mode === 'folder') return configured ? normalizePath(configured) : '/';

		// Both note-relative modes need a note to be relative to. An importer
		// that saves an attachment before it knows the note measures from the
		// output folder instead.
		let noteFolder = sourcePath ? parseFilePath(sourcePath).parent : '';
		if (!noteFolder) noteFolder = (await this.getOutputFolder())?.path ?? '/';

		if (mode === 'note' || !configured) return normalizePath(noteFolder);

		return normalizePath(`${noteFolder}/${configured}`);
	}

	/**
	 * Resolves a unique path for the attachment file being saved.
	 * Ensures that the parent directory exists and dedupes the
	 * filename if the destination filename already exists.
	 *
	 * This stands in for `fileManager.getAvailablePathForAttachment` with three
	 * adjustments Importer needs:
	 *   - Put attachments where the output step says, not where the vault setting does.
	 *   - Use the provided `sourcePath` even if the file doesn't exist yet.
	 *   - Avoid duplicating a list of provided filenames that do not yet exist, but will in the future.
	 *
	 * @param filename Name of the attachment being saved
	 * @param claimedPaths List of filepaths that may not exist yet but will in the future.
	 * @param sourcePath Optional path of the note being imported, for the note-relative modes
	 * @returns Full path for where the attachment should be saved
	 */
	async getAvailablePathForAttachment(filename: string, claimedPaths: string[], sourcePath?: string): Promise<string> {
		const folderPath = await this.attachmentFolderPath(sourcePath);
		const folder = await this.createFolders(folderPath);
		const parent = folder.path === '/' ? '' : folder.path;

		// A parent in the name is dropped, the way the vault method drops it.
		const { basename, extension } = parseFilePath(filename);
		const name = sanitizeFileName(basename);
		const fullExt = extension ? '.' + extension : '';

		const at = (candidate: string) => normalizePath(parent ? `${parent}/${candidate}` : candidate);
		const taken = (candidate: string) =>
			claimedPaths.includes(candidate) || !!this.vault.getAbstractFileByPath(candidate);

		let outputPath = at(`${name}${fullExt}`);
		for (let i = 1; taken(outputPath); i++) {
			outputPath = at(`${name} ${i}${fullExt}`);
		}

		return outputPath;
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

	/**
	 * Write an imported note, doing what the output step said to do about a
	 * note that is already there. Returns null when the note was left alone,
	 * which the importer should treat as a note it did not import.
	 */
	async writeNote(ctx: ImportContext, folder: TFolder, title: string, content: string, options: NoteImport = {}): Promise<TFile | null> {
		const { sourceId, ...writeOptions } = options;
		const name = `${sanitizeFileName(title).replace(/\.md$/i, '')}.md`;
		const parent = folder.path === '/' ? '' : folder.path;
		const fullPath = normalizePath(parent ? `${parent}/${name}` : name);

		const existing = this.duplicateHandling === DuplicateHandling.CreateCopy
			? null
			: this.previouslyImported(fullPath, sourceId);

		if (!existing) {
			// createFile picks another name if this one is taken, so a note this
			// import is not allowed to touch is never written over.
			const file = await this.createFile(folder, name, content, writeOptions);
			this.claimedPaths.add(file.path);
			return file;
		}

		if (this.duplicateHandling === DuplicateHandling.Skip) {
			ctx.reportSkipped(title, 'it is already in the vault');
			return null;
		}

		const unchanged = await this.unchangedSinceImport(ctx, existing, title, content, writeOptions.mtime);
		if (unchanged) return null;

		await this.modifyMarkdown(existing, content, writeOptions);
		this.claimedPaths.add(existing.path);
		return existing;
	}

	/**
	 * The note an earlier import wrote for this one, if it is still there.
	 *
	 * The source id answers this where there is one, so a note that has been
	 * renamed on either side is still recognised. A note carrying no id may
	 * predate the id being recorded, so it is matched by path; a note carrying
	 * a different id belongs to a different source note and is left alone.
	 */
	protected previouslyImported(fullPath: string, sourceId?: string): TFile | null {
		const { idProperty } = this;

		if (idProperty && sourceId) {
			const known = this.importedById?.get(sourceId);
			// The index is built once, and the note may have gone since.
			if (known && this.vault.getAbstractFileByPath(known.path) === known) return known;
		}

		// A second note of the same name in this run has to become a copy.
		if (this.claimedPaths.has(fullPath)) return null;

		const file = this.vault.getAbstractFileByPath(fullPath)
			?? this.vault.getAbstractFileByPathInsensitive(fullPath);
		if (!(file instanceof TFile)) return null;

		if (idProperty && sourceId) {
			const recorded = this.recordedId(file, idProperty);
			// A note carrying no id may predate the id being recorded, so it is
			// still ours; one carrying a different id is a different note.
			if (recorded && recorded !== sourceId) return null;
		}

		return file;
	}

	private recordedId(file: TFile, idProperty: string): string | null {
		const id: unknown = this.app.metadataCache?.getFileCache(file)?.frontmatter?.[idProperty];
		return typeof id === 'string' && id ? id : null;
	}

	/**
	 * Whether the note is one this import should leave alone: unchanged since
	 * it was last imported, or changed in Obsidian since.
	 *
	 * Where the source tells us when it last changed, the previous import
	 * stamped that time on the file it wrote — and the Markdown pass afterwards
	 * preserves it — so the file's own time is what the source said last time.
	 * Where it does not, all we can do is compare the text, which cannot tell
	 * an edit in Obsidian from a change at the source.
	 */
	private async unchangedSinceImport(ctx: ImportContext, file: TFile, title: string, content: string, sourceMtime?: number): Promise<boolean> {
		if (sourceMtime !== undefined) {
			if (file.stat.mtime === sourceMtime) {
				ctx.reportSkipped(title, 'it has not changed since the last import');
				return true;
			}

			if (file.stat.mtime > sourceMtime) {
				ctx.reportSkipped(title, 'it has been edited in Obsidian since the last import');
				return true;
			}

			return false;
		}

		try {
			const current = await this.vault.read(file);
			if (current !== await standardizedMarkdown(this.app, file.path, content)) return false;
		}
		catch (error) {
			console.error(`Could not read the note already at: ${file.path}`, error);
			return false;
		}

		ctx.reportSkipped(title, 'it has not changed since the last import');
		return true;
	}

	/**
	 * Index the vault by source id, so a note that has been renamed or moved
	 * since it was imported is still found. The frontmatter is already parsed
	 * and in memory, so this costs no reads.
	 */
	indexImportedNotes(): void {
		const { idProperty } = this;
		this.claimedPaths.clear();
		this.importedById = new Map();

		if (!idProperty || this.duplicateHandling === DuplicateHandling.CreateCopy) return;

		for (const file of this.vault.getMarkdownFiles()) {
			const id = this.recordedId(file, idProperty);
			if (id && !this.importedById.has(id)) this.importedById.set(id, file);
		}
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

	async createBinaryFile(folder: TFolder, fileName: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
		const path = getUniqueFilePath(this.vault, folder.path, fileName);

		return await this.vault.createBinary(path, data, options);
	}

	async saveAsMarkdownFile(folder: TFolder, title: string, content: string, options?: DataWriteOptions): Promise<TFile> {
		const sanitizedName = sanitizeFileName(title).replace(/\.md$/i, '');

		return await this.createFile(folder, `${sanitizedName}.md`, content, options);
	}
}
