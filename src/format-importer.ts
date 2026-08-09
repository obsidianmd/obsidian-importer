import { App, DataWriteOptions, debounce, normalizePath, Platform, SecretComponent, Setting, TFile, TFolder, Vault } from 'obsidian';
import { getAllFiles, NodePickedFile, NodePickedFolder, parseFilePath, PickedFile, WebPickedFile } from './filesystem';
import { HostPlugin } from './plugin-data';
import { AuthCallback } from './constants';
import { FolderSuggest } from './folder-suggest';
import { ImportContext } from './import-context';
import { createMarkdown, formatMarkdown, markdownOutputFor, modifyMarkdown, standardizedMarkdown, standardizeMarkdownFile } from './markdown-output';
import { getUniqueFilePath, parseFrontMatterBlock, plural, sanitizeFileName, sanitizeFilePath, serializeFrontMatter } from './util';

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

export type AttachmentLocationMode = 'vault' | 'folder' | 'note' | 'subfolder';

export interface AttachmentLocation {
	mode: AttachmentLocationMode;
	/** Folder path or subfolder name, depending on mode. */
	path: string;
}

const ATTACHMENT_MODE_LABELS: Record<AttachmentLocationMode, string> = {
	vault: 'Vault folder',
	folder: 'In the folder specified below',
	note: 'Same folder as the note',
	subfolder: 'In subfolder under the note',
};

export function attachmentLocationAsSetting({ mode, path }: AttachmentLocation): string {
	switch (mode) {
		case 'vault':
			return '/';
		case 'folder':
			return path || '/';
		case 'note':
			return './';
		case 'subfolder':
			return path ? `./${path}` : './';
	}
}

export function vaultAttachmentLocation(vault: Vault): AttachmentLocation {
	const configured = vault.getConfig('attachmentFolderPath');
	const value = typeof configured === 'string' ? configured.trim() : '';

	if (value === '' || value === '/') return { mode: 'vault', path: '' };
	if (value === '.' || value === './') return { mode: 'note', path: '' };
	if (value.startsWith('./')) return { mode: 'subfolder', path: value.slice(2) };

	return { mode: 'folder', path: normalizePath(value) };
}

export interface NoteImport extends DataWriteOptions {
	sourceId?: string;
}

export interface NoteWritten {
	file: TFile;
	written: boolean;
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

	/** Set in init(), not in a subclass field initializer. */
	defaultOutputFolder: string = 'Import';

	attachmentLocation: AttachmentLocation;
	/** Resolved against duplicateModes once the importer has set them up. */
	duplicateHandling: DuplicateHandling = DuplicateHandling.Update;

	duplicateModes: DuplicateHandling[] = [
		DuplicateHandling.CreateCopy,
		DuplicateHandling.Skip,
		DuplicateHandling.Update,
	];

	/** Frontmatter property used to identify imported notes. */
	idProperty: string | null = null;
	idLabel: string = 'source ID';

	saveSourceId: boolean = true;

	// Controls which interruption buttons the importer supports.
	interruption: 'none' | 'stop' | 'pause' = 'none';

	/** Cached value for getOutputFolder. Do not use directly. */
	private outputFolder: TFolder | null = null;

	private outputStepDrawn: boolean = false;

	/** Markdown written by this run, for the post-import Obsidian link pass. */
	private markdownFiles = new Set<string>();

	/** Paths claimed by this run, normalized for case-insensitive vault lookup. */
	private claimed = new Set<string>();

	protected claimPath(path: string): void {
		this.claimed.add(normalizePath(path).toLowerCase());
	}

	protected hasClaimed(path: string): boolean {
		return this.claimed.has(normalizePath(path).toLowerCase());
	}

	private importedById: Map<string, TFile> | null = null;

	private sourceFolder: string | null = null;
	private lastSourceFolder: string | null = null;

	/** SecretStorage id of the credential linked to this importer, if any. */
	private secretId: string | null = null;

	readonly ready: Promise<void>;

	private pending: Promise<unknown>[] = [];

	constructor(app: App, host: ImporterHost) {
		this.app = app;
		this.vault = app.vault;
		this.host = host;
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

	/** Prefer this importer's last folder, then its default, then the global last folder. */
	protected pickerOpensAt(defaultPath?: string): string | undefined {
		return this.sourceFolder ?? defaultPath ?? this.lastSourceFolder ?? undefined;
	}

	protected chooseFrom(options: Record<string, unknown>, defaultPath?: string): string[] {
		const picked: string[] | undefined = window.electron.remote.dialog.showOpenDialogSync({
			...options,
			defaultPath: this.pickerOpensAt(defaultPath),
		});

		if (!picked || picked.length === 0) return [];

		this.rememberSourceFolder(picked[0]);
		return picked;
	}

	protected rememberSourceFolder(filepath: string): void {
		const { parent } = parseFilePath(filepath);
		if (!parent) return;

		this.sourceFolder = parent;
		this.lastSourceFolder = parent;
		this.saveSourceFolder(parent);
	}

	private saveSourceFolder = debounce((folder: string) => {
		void (async () => {
			if (!this.host.plugin) return;
			try {
				const data = await this.host.plugin.loadData();
				data.sourceFolders = { ...data.sourceFolders, [this.host.importerId]: folder };
				data.lastSourceFolder = folder;
				await this.host.plugin.saveData(data);
			}
			catch (e) {
				console.error('Could not remember the folder that was picked', e);
			}
		})();
	}, 1000, true);

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
						const filePaths = this.chooseFrom({
							title: 'Pick files to import', properties,
							filters: [{ name, extensions }],
						}, defaultPath);

						if (filePaths.length > 0) {
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
						const filePaths = this.chooseFrom({
							title: 'Folders to import',
							properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
						}, defaultPath);

						if (filePaths.length > 0) {
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

	drawOutputStep(): void {
		const contentEl = this.stepEl('output');
		if (!contentEl || this.outputStepDrawn) return;
		this.outputStepDrawn = true;

		this.addOutputFolderSetting(contentEl);
		this.addAttachmentLocationSetting(contentEl);
		this.addDuplicateHandlingSetting(contentEl);
		this.addSaveSourceIdSetting(contentEl);
	}

	private addSaveSourceIdSetting(contentEl: HTMLElement): void {
		if (!this.idProperty) return;

		new Setting(contentEl)
			.setName(`Save ${this.idLabel}`)
			.setDesc(`Add the ${this.idLabel} to note properties so future imports can recognize moved or renamed notes.`)
			.addToggle(toggle => {
				toggle
					.setValue(this.saveSourceId)
					.onChange(value => {
						this.saveSourceId = value;
						this.saveOutputSettings();
					});
			});
	}

	private addOutputFolderSetting(contentEl: HTMLElement): void {
		new Setting(contentEl)
			.setName('Output folder')
			.setDesc('Where imported notes will be saved. Leave blank to use the top level of the vault.')
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
			.setName('Attachment location')
			.setDesc('Where imported images and files will be saved.');

		const pathSetting = new Setting(contentEl);

		const drawPathSetting = () => {
			const { mode } = this.attachmentLocation;
			pathSetting.settingEl.toggle(mode === 'folder' || mode === 'subfolder');
			pathSetting
				.setName(mode === 'subfolder' ? 'Subfolder name' : 'Attachment folder')
				.setDesc(mode === 'subfolder'
					? 'Folder to use inside each imported note\'s folder.'
					: 'Folder path from the top level of the vault.');
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
			.setName('Existing notes')
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
			frag.appendText(`Choose what to do when an imported note matches one in your vault. `
				+ `"${DUPLICATE_HANDLING_LABELS[DuplicateHandling.Update]}" skips unchanged notes and preserves newer local edits when modification dates are available.`);
		});
	}

	/**
	 * Not every importer offers Update, and a default it does not offer is not
	 * one it can use. Skip is the nearest thing where it is missing: both leave
	 * a note that is already there alone rather than writing a second copy.
	 */
	private defaultDuplicateHandling(): DuplicateHandling {
		for (const preferred of [DuplicateHandling.Update, DuplicateHandling.Skip]) {
			if (this.duplicateModes.includes(preferred)) return preferred;
		}

		return this.duplicateModes[0];
	}

	private async loadOutputSettings(): Promise<void> {
		this.outputLocation = this.defaultOutputFolder;
		// duplicateModes are set in init(), so the field default cannot know
		// whether this importer offers it. Only correct it if it does not,
		// leaving a mode the caller chose deliberately alone.
		if (!this.duplicateModes.includes(this.duplicateHandling)) {
			this.duplicateHandling = this.defaultDuplicateHandling();
		}

		if (!this.host.plugin) return;

		try {
			const data = await this.host.plugin.loadData();

			// Migrate the legacy output folder.
			const legacyFolder = data.outputLocations?.[this.host.importerId];
			if (legacyFolder !== undefined) this.outputLocation = legacyFolder;

			this.sourceFolder = data.sourceFolders?.[this.host.importerId] ?? null;
			this.lastSourceFolder = data.lastSourceFolder || null;

			const saved = data.outputSettings?.[this.host.importerId];
			if (!saved) return;

			if (saved.folder !== undefined) this.outputLocation = saved.folder;
			if (saved.attachments) this.attachmentLocation = { ...saved.attachments };
			if (saved.duplicates && this.duplicateModes.includes(saved.duplicates)) {
				this.duplicateHandling = saved.duplicates;
			}
			if (saved.saveSourceId !== undefined) this.saveSourceId = saved.saveSourceId;
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
						saveSourceId: this.saveSourceId,
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

	private async attachmentFolderPath(sourcePath?: string): Promise<string> {
		const { mode, path: configured } = this.attachmentLocation;

		if (mode === 'vault') return '/';
		if (mode === 'folder') return configured ? normalizePath(configured) : '/';

		// Fall back to the output folder when no note path is available.
		let noteFolder = sourcePath ? parseFilePath(sourcePath).parent : '';
		if (!noteFolder) noteFolder = (await this.getOutputFolder())?.path ?? '/';

		if (mode === 'note' || !configured) return normalizePath(noteFolder);

		return normalizePath(`${noteFolder}/${configured}`);
	}

	/**
	 * Where an attachment belongs, and whether one already in the vault is that
	 * same attachment rather than a different one that reached the name first.
	 *
	 * Attachments carry no id, so the only handle is the name in the folder
	 * they belong to. That is enough to recognise one across imports and not
	 * enough within a single run, where a second attachment of the same name is
	 * a different file that needs its own path.
	 */
	protected async placeAttachment(
		filename: string,
		sourcePath?: string,
		sourceMtime?: number,
	): Promise<{ path: string, reuse: TFile | null }> {
		const unclaimedPath = async () => {
			const path = await this.getAvailablePathForAttachment(filename, [], sourcePath);
			this.claimPath(path);
			return { path, reuse: null };
		};

		if (this.duplicateHandling === DuplicateHandling.CreateCopy) return unclaimedPath();

		const folderPath = await this.attachmentFolderPath(sourcePath);
		const parent = folderPath === '/' ? '' : folderPath;
		const { basename, extension } = parseFilePath(filename);
		const name = `${sanitizeFileName(basename)}${extension ? `.${extension}` : ''}`;
		const candidate = normalizePath(parent ? `${parent}/${name}` : name);

		// Written by this run, so it is a different attachment of one name.
		if (this.hasClaimed(candidate)) return unclaimedPath();

		const existing = this.vault.getAbstractFileByPath(candidate);
		if (!(existing instanceof TFile)) return unclaimedPath();

		this.claimPath(candidate);

		if (this.duplicateHandling === DuplicateHandling.Skip) return { path: candidate, reuse: existing };

		// Update leaves alone what the source has not touched since.
		if (sourceMtime !== undefined && sourceMtime <= existing.stat.mtime) {
			return { path: candidate, reuse: existing };
		}

		return { path: candidate, reuse: null };
	}

	/** Write an attachment, replacing whatever placeAttachment pointed at. */
	protected async writeAttachment(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
		const existing = this.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.vault.modifyBinary(existing, data, options);
			return existing;
		}

		return this.vault.createBinary(path, data, options);
	}

	async getAvailablePathForAttachment(filename: string, claimedPaths: string[], sourcePath?: string): Promise<string> {
		const folderPath = await this.attachmentFolderPath(sourcePath);
		const folder = await this.createFolders(folderPath);
		const parent = folder.path === '/' ? '' : folder.path;

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

	/** Register Markdown written outside createFile. */
	trackMarkdownFile(file: TFile | string): void {
		const path = typeof file === 'string' ? normalizePath(file) : file.path;
		if (path.toLowerCase().endsWith('.md')) this.markdownFiles.add(path);
	}

	protected withSourceId(content: string, sourceId: string | undefined): string {
		const { idProperty } = this;
		if (!idProperty || !sourceId || !this.saveSourceId) return content;

		const parsed = parseFrontMatterBlock(content);
		if (!parsed) return serializeFrontMatter({ [idProperty]: sourceId }) + content;

		return serializeFrontMatter({ [idProperty]: sourceId, ...parsed.frontMatter }) + parsed.body;
	}

	/** Write, update, or match an imported note according to the duplicate mode. */
	async writeNote(ctx: ImportContext, folder: TFolder, title: string, content: string, options: NoteImport = {}): Promise<NoteWritten> {
		const { sourceId, ...writeOptions } = options;
		content = this.withSourceId(content, sourceId);
		const name = `${sanitizeFileName(title).replace(/\.md$/i, '')}.md`;
		const parent = folder.path === '/' ? '' : folder.path;
		const fullPath = normalizePath(parent ? `${parent}/${name}` : name);

		const existing = this.duplicateHandling === DuplicateHandling.CreateCopy
			? null
			: this.previouslyImported(fullPath, sourceId);

		if (!existing) {
			const file = await this.createFile(folder, name, content, writeOptions);
			this.claimPath(file.path);
			return { file, written: true };
		}

		if (this.duplicateHandling === DuplicateHandling.Skip) {
			ctx.reportSkipped(title, 'it is already in the vault');
			return { file: existing, written: false };
		}

		if (await this.unchangedSinceImport(ctx, existing, title, content, writeOptions.mtime)) {
			return { file: existing, written: false };
		}

		await this.modifyMarkdown(existing, content, writeOptions);
		this.claimPath(existing.path);
		return { file: existing, written: true };
	}

	/** Find a previous import by source ID, falling back to its expected path. */
	protected previouslyImported(fullPath: string, sourceId?: string): TFile | null {
		const { idProperty } = this;

		if (idProperty && sourceId) {
			const known = this.importedById?.get(sourceId);
			if (known && this.vault.getAbstractFileByPath(known.path) === known) return known;
		}

		// A second source note with this path needs its own file.
		if (this.hasClaimed(fullPath)) return null;

		const file = this.vault.getAbstractFileByPath(fullPath)
			?? this.vault.getAbstractFileByPathInsensitive(fullPath);
		if (!(file instanceof TFile)) return null;

		if (idProperty && sourceId) {
			const recorded = this.recordedId(file, idProperty);
			// Notes imported before IDs were recorded still match by path.
			if (recorded && recorded !== sourceId) return null;
		}

		return file;
	}

	private recordedId(file: TFile, idProperty: string): string | null {
		const id: unknown = this.app.metadataCache?.getFileCache(file)?.frontmatter?.[idProperty];
		return typeof id === 'string' && id ? id : null;
	}

	/** Leave notes unchanged or edited since the source update alone. */
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

	indexImportedNotes(): void {
		const { idProperty } = this;
		this.claimed.clear();
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
