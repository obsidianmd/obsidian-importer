import { App, DataWriteOptions, debounce, normalizePath, Platform, SecretComponent, Setting, SettingGroup, TFile, TFolder, Vault } from 'obsidian';
import { getAllFiles, NodePickedFile, NodePickedFolder, parseFilePath, PickedFile, PickedFolder, WebPickedFile, webPickedTree } from './filesystem';
import { HostPlugin } from './plugin-data';
import { AuthCallback, helpUrl } from './constants';
import { FolderSuggest } from './folder-suggest';
import { MarkdownFileSuggest } from './markdown-file-suggest';
import { ImportContext } from './import-context';
import { formatImportReport, importReportName } from './import-report';
import { createMarkdown, formattedMarkdown, MarkdownFormatting, MarkdownLinkResolver, modifyMarkdown, standardizedMarkdown, standardizeMarkdownFile } from './markdown-output';
import { i18n } from './i18n';
import { NoteTemplateVariables, renderNoteTemplate } from './note-template';
import { availableFileName, getUniqueFilePath, parseFrontMatterBlock, sanitizeFileName, sanitizeFilePath, serializeFrontMatter } from './util';

const MAX_FILES_LISTED = 5;

export enum DuplicateHandling {
	CreateCopy = 'create-copy',
	Skip = 'skip',
	Update = 'update',
}

function duplicateHandlingLabel(mode: DuplicateHandling): string {
	switch (mode) {
		case DuplicateHandling.CreateCopy:
			return i18n.output.optionCreateCopy();
		case DuplicateHandling.Skip:
			return i18n.output.optionSkip();
		case DuplicateHandling.Update:
			return i18n.output.optionUpdate();
	}
}

/**
 * What a file already occupying an attachment's name turned out to be:
 * this attachment as the source still has it, this attachment as it used to
 * be, or an attachment belonging to something else entirely.
 */
export type AttachmentVerdict = 'same' | 'stale' | 'another';

export type AttachmentLocationMode = 'vault' | 'folder' | 'note' | 'subfolder';

export interface AttachmentLocation {
	mode: AttachmentLocationMode;
	/** Folder path or subfolder name, depending on mode. */
	path: string;
}

const ATTACHMENT_MODES: AttachmentLocationMode[] = ['vault', 'folder', 'note', 'subfolder'];

function attachmentModeLabel(mode: AttachmentLocationMode): string {
	switch (mode) {
		case 'vault':
			return i18n.output.optionAttachmentsVault();
		case 'folder':
			return i18n.output.optionAttachmentsFolder();
		case 'note':
			return i18n.output.optionAttachmentsNote();
		case 'subfolder':
			return i18n.output.optionAttachmentsSubfolder();
	}
}

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
	/** Importer-specific values made available to a selected Markdown template. */
	templateVariables?: NoteTemplateVariables;
}

/**
 * What became of an imported note. The three that wrote nothing are kept
 * apart because a note left alone by a source that has not moved on can still
 * have its unresolved links repaired, while one the user has edited must not
 * be touched at all.
 */
export type NoteOutcome = 'created' | 'updated' | 'skipped' | 'unchanged' | 'preserved';

export interface NoteWritten {
	file: TFile;
	written: boolean;
	outcome: NoteOutcome;
}

/** Where a note is going and what is already there, decided before its markdown exists. */
export interface PlannedNote {
	title: string;
	/** Where this import would place the note, before anything already there. */
	desiredPath: string;
	/** Where it will be written: an earlier import's note, or a free name. */
	targetPath: string;
	/** The note an earlier import wrote, when this one matches it. */
	file: TFile | null;
	sourceId?: string;
}

/**
 * What to do with a resolved note. `compare-content` is the answer when the
 * source offers no modification time: the caller has to produce the markdown
 * before anything can be decided.
 */
export type NoteDisposition =
	| 'create' | 'copy' | 'skip' | 'unchanged' | 'preserve' | 'update' | 'compare-content';

/** Whether the note in the vault stays as it is. Which of the three it is still matters: only `preserve` may not be written to at all. */
export function leavesTheNoteAlone(disposition: NoteDisposition): boolean {
	return disposition === 'skip' || disposition === 'unchanged' || disposition === 'preserve';
}

const OUTCOME_OF: Record<'skip' | 'unchanged' | 'preserve', NoteOutcome> = {
	skip: 'skipped',
	unchanged: 'unchanged',
	preserve: 'preserved',
};

/**
 * An import writes the source's time onto the file, so an equal time is a note
 * nothing has touched since, and a later one is a note the user has edited.
 */
function comparedToSource(file: TFile, sourceMtime: number): 'unchanged' | 'preserve' | 'update' {
	if (file.stat.mtime === sourceMtime) return 'unchanged';
	if (file.stat.mtime > sourceMtime) return 'preserve';

	return 'update';
}

export type ImporterStep = 'source' | 'output' | 'options';

export interface ImporterHost {
	sourceEl: HTMLElement | null;
	outputEl: HTMLElement | null;
	optionsEl: HTMLElement | null;
	plugin: HostPlugin;
	importerId: string;
	helpPermalink?: string;
	sourceChanged?(): void;
	abortController: AbortController;
}

export abstract class FormatImporter {
	static extensions: readonly string[] = [];

	app: App;
	vault: Vault;
	host: ImporterHost;

	files: PickedFile[] = [];

	chosen: (PickedFile | PickedFolder)[] = [];

	outputLocation: string = '';
	/** Vault-relative path of the optional Markdown template for this importer. */
	templatePath: string = '';
	notAvailable: boolean = false;

	/** Set in init(), not in a subclass field initializer. */
	defaultOutputFolder: string = 'Import';

	attachmentLocation: AttachmentLocation;
	duplicateHandling: DuplicateHandling = DuplicateHandling.Update;

	duplicateModes: DuplicateHandling[] = [
		DuplicateHandling.CreateCopy,
		DuplicateHandling.Skip,
		DuplicateHandling.Update,
	];

	/** What this importer's source cannot tell it, shown under the setting. */
	duplicateCaveat: string | null = null;

	/** Frontmatter property used to identify imported notes. */
	idProperty: string | null = null;
	/** Set in init() when an importer names its ID something more specific. */
	idLabel: string = i18n.output.labelSourceId();

	saveSourceId: boolean = true;

	// Controls which interruption buttons the importer supports.
	interruption: 'none' | 'stop' | 'pause' = 'none';

	/** Preserve picked folders instead of flattening them to accepted files. */
	protected keepsFolders: boolean = false;

	/** Cached value for getOutputFolder. Do not use directly. */
	private outputFolder: TFolder | null = null;
	private loadedTemplate: { path: string, content: string } | null = null;

	private outputStepDrawn: boolean = false;

	/** Markdown written by this run, for the post-import Obsidian link pass. */
	private markdownFiles = new Set<string>();

	/** Paths claimed by this run, normalized for case-insensitive vault lookup. */
	private claimed = new Set<string>();

	protected claimPath(path: string): void {
		this.claimed.add(normalizePath(path).toLowerCase());
	}

	/**
	 * Give a name back, for a file that was never written after all: a download
	 * that does not arrive would otherwise leave the next file of that name
	 * numbered around a gap.
	 */
	protected releasePath(path: string): void {
		this.claimed.delete(normalizePath(path).toLowerCase());
	}

	protected hasClaimed(path: string): boolean {
		return this.claimed.has(normalizePath(path).toLowerCase());
	}

	private importedById: Map<string, TFile> | null = null;

	private sourceFolder: string | null = null;
	private lastSourceFolder: string | null = null;

	private acceptedExtensions: readonly string[] | undefined;
	private acceptsMultiple: boolean | undefined;
	private showPickedFiles: (() => void) | undefined;

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
	get configures(): boolean {
		return this.showTemplateConfiguration !== FormatImporter.prototype.showTemplateConfiguration;
	}

	async showTemplateConfiguration(ctx: ImportContext, container: HTMLElement, buttonsEl: HTMLElement): Promise<boolean | null> {
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

	protected addInstructions(setting: Setting | null): Setting | null {
		const { helpPermalink } = this.host;
		if (!setting || !helpPermalink) return setting;

		return setting.addButton(button => button
			.setButtonText(i18n.common.buttonInstructions())
			.onClick(() => window.open(helpUrl(helpPermalink))));
	}

	protected addExportSetting(desc: string | DocumentFragment): Setting | null {
		return this.addSetting('source')
			?.setName(i18n.common.nameExport())
			.setDesc(desc) ?? null;
	}

	private groups = new WeakMap<HTMLElement, SettingGroup>();

	protected settingsIn(contentEl: HTMLElement): HTMLElement {
		const group = this.groups.get(contentEl);
		// Direct children end the current group.
		if (group && contentEl.lastElementChild === group.groupEl) return group.listEl;

		return this.startGroupIn(contentEl).listEl;
	}

	private endGroupIn(contentEl: HTMLElement): void {
		this.groups.delete(contentEl);
	}

	private startGroupIn(contentEl: HTMLElement, heading?: string): SettingGroup {
		const group = new SettingGroup(contentEl);
		if (heading) group.setHeading(heading);
		this.groups.set(contentEl, group);
		return group;
	}

	protected startGroup(step: ImporterStep = 'options', heading?: string): SettingGroup | null {
		const contentEl = this.stepEl(step);
		return contentEl ? this.startGroupIn(contentEl, heading) : null;
	}

	protected addSetting(step: ImporterStep = 'options'): Setting | null {
		const contentEl = this.stepEl(step);
		return contentEl ? new Setting(this.settingsIn(contentEl)) : null;
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
	addSecretSetting(name: string, description?: string | DocumentFragment, external?: { text: string, url: string }): Setting | null {
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

		let externalEl: HTMLElement | null = null;

		if (external) {
			setting.addButton(button => {
				externalEl = button.buttonEl;
				button
					.setButtonText(external.text)
					.onClick(() => window.open(external.url));
			});
		}

		const showLinking = (linked: boolean) => {
			externalEl?.toggle(!linked);

			for (const button of Array.from(setting.controlEl.querySelectorAll('button'))) {
				if (button !== externalEl) button.toggleClass('mod-cta', !linked);
			}
		};

		setting.addComponent(el => {
			let component = new SecretComponent(this.app, el)
				.onChange(async secretId => {
					this.secretId = secretId || null;
					showLinking(!!this.secretId);
					this.secretChanged();
					this.sourceChanged();
					await this.saveSecretId(this.secretId);
				});

			this.loadSecretId()
				.then(secretId => {
					this.secretId = secretId;
					component.setValue(secretId ?? '');
					showLinking(!!secretId);
					this.secretChanged();
					this.sourceChanged();
				})
				.catch(e => console.error('Could not read the linked secret', e));

			return component;
		});

		return setting;
	}

	/** Called after the linked secret changes or is restored. */
	protected secretChanged(): void {
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
		// Headless importers still need their accepted file types.
		this.acceptedExtensions = extensions;
		this.acceptsMultiple = allowMultiple;

		const contentEl = this.stepEl('source');
		if (!contentEl) return;

		const { listEl } = this.startGroupIn(contentEl).addClass('mod-list');
		this.endGroupIn(contentEl);

		const win = contentEl.doc.defaultView;
		const canChooseFolders = Platform.isDesktopApp
			|| (!!win && 'webkitdirectory' in win.HTMLInputElement.prototype);

		const chooseFiles = async () => {
			if (Platform.isDesktopApp) {
				const properties = ['openFile', 'dontAddToRecent'];
				if (allowMultiple) properties.push('multiSelections');

				const filePaths = this.chooseFrom({
					title: i18n.source.dialogPickFiles(), properties,
					filters: [{ name, extensions }],
				}, defaultPath);

				if (filePaths.length > 0) {
					void addChosen(filePaths.map((filepath: string) => new NodePickedFile(filepath)));
				}

				return;
			}

			chooseFromWeb(false);
		};

		// iOS ignores clicks on detached file inputs.
		const chooseFromWeb = (folder: boolean) => {
			const inputEl = contentEl.doc.body.createEl('input', { cls: 'importer-file-input' });
			inputEl.type = 'file';
			inputEl.multiple = allowMultiple;

			if (folder) inputEl.webkitdirectory = true;
			else inputEl.accept = extensions.map(e => '.' + e.toLowerCase()).join(',');

			inputEl.addEventListener('change', () => {
				const files = Array.from(inputEl.files ?? []);
				inputEl.detach();

				if (files.length === 0) return;

				if (folder) void addFolders(webPickedTree(files));
				else {
					void addChosen(files.map(file => new WebPickedFile(file))
						.filter(file => extensions.contains(file.extension)));
				}
			});

			inputEl.addEventListener('cancel', () => inputEl.detach());

			inputEl.click();
		};

		const chooseFolders = async () => {
			if (!Platform.isDesktopApp) {
				chooseFromWeb(true);
				return;
			}

			const filePaths = this.chooseFrom({
				title: i18n.source.dialogPickFolders(),
				properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
			}, defaultPath);

			if (filePaths.length === 0) return;

			await addFolders(filePaths.map((filepath: string) => new NodePickedFolder(filepath)));
		};

		const addFolders = async (folders: (PickedFile | PickedFolder)[]) => {
			drawState(i18n.source.msgReadingFolders());

			await addChosen(this.keepsFolders ? folders : await this.filesInside(folders));
		};

		const setChosen = async (chosen: (PickedFile | PickedFolder)[]) => {
			this.chosen = chosen;

			if (await this.readChosen()) updateFiles();
		};

		const addChosen = (arriving: (PickedFile | PickedFolder)[]) => setChosen(this.joining(this.chosen, arriving));
		const removeChosen = (item: PickedFile | PickedFolder) =>
			void setChosen(this.chosen.filter(other => other !== item));

		const drawState = (text: string) => {
			listEl.empty();
			new Setting(listEl).setClass('mod-empty-state').setName(text);
			drawPickers();
		};

		const drawPickers = () => {
			const files = new Setting(listEl)
				.setClass('mod-add-item')
				.setName(allowMultiple ? i18n.source.buttonChooseFiles() : i18n.source.buttonChooseFile());

			files.setIcon('lucide-plus');
			files.setAction(() => void chooseFiles());

			if (!allowMultiple || !canChooseFolders) return;

			const folders = new Setting(listEl)
				.setClass('mod-add-item')
				.setName(i18n.source.buttonChooseFolders());

			folders.setIcon('lucide-plus');
			folders.setAction(() => void chooseFolders());
		};

		const updateFiles = () => {
			if (this.files.length === 0) {
				this.chosen = [];
				this.sourceChanged();
				drawState(i18n.source.msgNothingToImport({
					extensions: extensions.map(e => '.' + e).join(', '),
				}));
				return;
			}

			this.sourceChanged();

			listEl.empty();

			for (const item of this.chosen.slice(0, MAX_FILES_LISTED)) {
				new Setting(listEl)
					.setName(item.name)
					.setIcon(item.type === 'folder' ? 'lucide-folder' : 'lucide-file')
					.addExtraButton(button => button
						.setIcon('lucide-x')
						.setTooltip(i18n.source.buttonRemoveFile())
						.onClick(() => removeChosen(item)));
			}

			const rest = this.chosen.length - MAX_FILES_LISTED;
			if (rest > 0) {
				new Setting(listEl)
					.setClass('mod-empty-state')
					.setName(i18n.source.msgMoreFiles({ count: rest }));
			}

			drawPickers();
		};

		drawState(description || (Platform.isMobile ? i18n.source.descChoose() : i18n.source.desc()));
		this.showPickedFiles = updateFiles;
	}

	acceptableFiles(files: PickedFile[]): PickedFile[] {
		const extensions = this.acceptedExtensions;
		if (!extensions) return [];

		const accepted = files.filter(file => extensions.includes(file.extension));
		return this.acceptsMultiple ? accepted : accepted.slice(0, 1);
	}

	protected async filesInside(items: (PickedFile | PickedFolder)[]): Promise<PickedFile[]> {
		const extensions = this.acceptedExtensions;
		if (!extensions) return [];

		return await getAllFiles(items, file => extensions.includes(file.extension));
	}

	private async readChosen(): Promise<boolean> {
		const chosen = this.chosen;
		const files = chosen.every(item => item.type === 'file')
			? chosen
			: await this.filesInside(chosen);

		// Ignore a folder read superseded by another selection.
		if (chosen !== this.chosen) return false;

		this.files = files;
		return true;
	}

	takeDropped(dropped: (PickedFile | PickedFolder)[], files: PickedFile[]): void {
		if (!this.keepsFolders) {
			this.takeFiles(files);
			return;
		}

		const accepted = this.acceptableFiles(files);
		if (accepted.length === 0) return;

		const kept = dropped.filter(item => item.type === 'folder' || accepted.includes(item));
		this.takeChosen(kept, accepted);
	}

	wouldTake(_dropped: (PickedFile | PickedFolder)[], files: PickedFile[]): number {
		return this.acceptableFiles(files).length;
	}

	takesWholeDrop(dropped: (PickedFile | PickedFolder)[], files: PickedFile[]): boolean {
		const taken = this.wouldTake(dropped, files);
		return taken > 0 && taken === files.length;
	}

	takeFiles(files: PickedFile[]): number {
		const accepted = this.acceptableFiles(files);
		if (accepted.length === 0) return 0;

		this.takeChosen(accepted, accepted);

		return accepted.length;
	}

	private joining<T extends PickedFile | PickedFolder>(existing: T[], arriving: T[]): T[] {
		if (!this.acceptsMultiple) return arriving.slice(0, 1);

		const seen = new Set(existing.map(item => item.toString()));
		return [...existing, ...arriving.filter(item => !seen.has(item.toString()))];
	}

	private takeChosen(chosen: (PickedFile | PickedFolder)[], files: PickedFile[]): void {
		this.files = this.joining(this.files, files);
		this.chosen = this.joining(this.chosen, chosen);

		if (this.showPickedFiles) this.showPickedFiles();
		else this.sourceChanged();
	}

	drawOutputStep(): void {
		const contentEl = this.stepEl('output');
		if (!contentEl || this.outputStepDrawn) return;
		this.outputStepDrawn = true;

		this.drawOutputSettings(contentEl);
	}

	protected drawOutputSettings(contentEl: HTMLElement): void {
		this.addOutputFolderSetting(contentEl);
		this.addTemplateSetting(contentEl);
		this.addAttachmentLocationSetting(contentEl);

		this.startGroupIn(contentEl);
		this.addDuplicateHandlingSetting(contentEl);
		this.addSaveSourceIdSetting(contentEl);
	}

	private addTemplateSetting(contentEl: HTMLElement): void {
		new Setting(this.settingsIn(contentEl))
			.setName(i18n.output.nameTemplate())
			.setDesc(i18n.output.descTemplate())
			.addText(text => {
				text
					.setPlaceholder(i18n.output.placeholderTemplate())
					.setValue(this.templatePath)
					.onChange(value => {
						this.templatePath = value.trim();
						this.loadedTemplate = null;
						this.saveOutputSettings();
					});
				new MarkdownFileSuggest(this.app, text.inputEl);
			});
	}

	private addSaveSourceIdSetting(contentEl: HTMLElement): void {
		if (!this.idProperty) return;

		new Setting(this.settingsIn(contentEl))
			.setName(i18n.output.nameSaveSourceId({ label: this.idLabel }))
			.setDesc(i18n.output.descSaveSourceId({ label: this.idLabel }))
			.addToggle(toggle => {
				toggle
					.setValue(this.saveSourceId)
					.onChange(value => {
						this.saveSourceId = value;
						this.saveOutputSettings();
					});
			});
	}

	protected addOutputFolderSetting(contentEl: HTMLElement): void {
		new Setting(this.settingsIn(contentEl))
			.setName(i18n.output.nameFolder())
			.setDesc(i18n.output.descFolder())
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
		const setting = new Setting(this.settingsIn(contentEl))
			.setName(i18n.output.nameAttachments())
			.setDesc(i18n.output.descAttachments());

		const pathSetting = new Setting(this.settingsIn(contentEl));

		const drawPathSetting = () => {
			const { mode } = this.attachmentLocation;
			pathSetting.settingEl.toggle(mode === 'folder' || mode === 'subfolder');
			pathSetting
				.setName(mode === 'subfolder' ? i18n.output.nameSubfolder() : i18n.output.nameAttachmentFolder())
				.setDesc(mode === 'subfolder' ? i18n.output.descSubfolder() : i18n.output.descAttachmentFolder());
		};

		setting.addDropdown(dropdown => {
			for (const mode of ATTACHMENT_MODES) {
				dropdown.addOption(mode, attachmentModeLabel(mode));
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

	protected addDuplicateHandlingSetting(contentEl: HTMLElement): void {
		const modes = this.duplicateModes;
		if (modes.length < 2) return;

		new Setting(this.settingsIn(contentEl))
			.setName(i18n.output.nameDuplicates())
			.setDesc(this.describeDuplicateHandling())
			.addDropdown(dropdown => {
				for (const mode of modes) dropdown.addOption(mode, duplicateHandlingLabel(mode));

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
			frag.appendText(i18n.output.descDuplicates({
				update: duplicateHandlingLabel(DuplicateHandling.Update),
			}));

			if (this.duplicateCaveat) {
				frag.createEl('br');
				frag.appendText(this.duplicateCaveat);
			}
		});
	}

	private async loadOutputSettings(): Promise<void> {
		this.outputLocation = this.defaultOutputFolder;
		this.templatePath = '';
		this.loadedTemplate = null;
		// init() may remove the field default from duplicateModes.
		if (!this.duplicateModes.includes(this.duplicateHandling)) {
			this.duplicateHandling = [DuplicateHandling.Update, DuplicateHandling.Skip]
				.find(mode => this.duplicateModes.includes(mode)) ?? this.duplicateModes[0];
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
			if (saved.template !== undefined) this.templatePath = saved.template;
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
						template: this.templatePath,
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

		// Match the folder the way createFolder will: it throws for a name that
		// differs from an existing one only in case, so an exact lookup alone
		// would try to create a folder that is already there.
		let folder = vault.getAbstractFileByPath(folderPath)
			?? vault.getAbstractFileByPathInsensitive(folderPath);

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

	/** How an attachment is named in its folder, and how collisions are numbered. */
	private async attachmentNaming(filename: string, sourcePath?: string): Promise<(nth: number) => string> {
		const folder = await this.createFolders(await this.attachmentFolderPath(sourcePath));

		return this.namingIn(folder.path === '/' ? '' : folder.path, filename);
	}

	/** Build attachment names in an importer-selected folder. */
	protected namingIn(parent: string, filename: string): (nth: number) => string {
		const { basename, extension } = parseFilePath(filename);
		const name = sanitizeFileName(basename, parent);
		const fullExt = extension ? '.' + extension : '';

		return nth => normalizePath(
			parent ? `${parent}/${name}${nth ? ` ${nth}` : ''}${fullExt}`
				: `${name}${nth ? ` ${nth}` : ''}${fullExt}`);
	}

	/**
	 * Where this attachment belongs, and the copy already there if it is this
	 * one. A name is not an identity — two sources can offer the same one — so
	 * the importer is asked what a file occupying the name actually is. A name
	 * it does not recognise is passed over rather than taken, which is what
	 * keeps one page's attachment out of another page's note.
	 */
	protected async placeAttachment(
		filename: string,
		sourcePath: string | undefined,
		recognise: (existing: TFile) => AttachmentVerdict | Promise<AttachmentVerdict>,
	): Promise<{ path: string, reuse: TFile | null }> {
		const at = await this.attachmentNaming(filename, sourcePath);
		return await this.placeAttachmentAt(at, recognise);
	}

	/** Place an attachment using importer-selected candidate paths. */
	protected async placeAttachmentAt(
		at: (nth: number) => string,
		recognise: (existing: TFile) => AttachmentVerdict | Promise<AttachmentVerdict>,
	): Promise<{ path: string, reuse: TFile | null }> {
		const reusing = this.duplicateHandling !== DuplicateHandling.CreateCopy;

		for (let nth = 0; ; nth++) {
			const candidate = at(nth);
			if (this.hasClaimed(candidate)) continue;

			const existing = this.vault.getAbstractFileByPath(candidate)
				?? this.vault.getAbstractFileByPathInsensitive(candidate);
			if (existing === null) {
				this.claimPath(candidate);
				return { path: candidate, reuse: null };
			}
			if (!(existing instanceof TFile)) continue;

			if (!reusing) continue;

			const verdict = await recognise(existing);
			if (verdict === 'another') continue;

			this.claimPath(existing.path);

			// Skip leaves what is there even when the source has moved on.
			const stale = verdict === 'stale' && this.duplicateHandling !== DuplicateHandling.Skip;
			return { path: existing.path, reuse: stale ? null : existing };
		}
	}

	protected async writeAttachment(path: string, data: ArrayBuffer | string, options?: DataWriteOptions): Promise<TFile> {
		const existing = this.vault.getAbstractFileByPath(path);

		if (existing instanceof TFile) {
			if (typeof data === 'string') await this.vault.modify(existing, data, options);
			else await this.vault.modifyBinary(existing, data, options);
			return existing;
		}

		return typeof data === 'string'
			? this.vault.create(path, data, options)
			: this.vault.createBinary(path, data, options);
	}

	/**
	 * A name nothing else in this run is going to want. Notes are planned before
	 * they are written, so a name free in the vault may still be one a note is
	 * holding, and that note's own write would then fail.
	 */
	async getAvailablePathForAttachment(filename: string, claimedPaths: string[], sourcePath?: string): Promise<string> {
		const at = await this.attachmentNaming(filename, sourcePath);

		for (let nth = 0; ; nth++) {
			const candidate = at(nth);
			if (claimedPaths.includes(candidate) || this.hasClaimed(candidate)) continue;
			if (!this.vault.getAbstractFileByPath(candidate)) return candidate;
		}
	}

	async backOff(durationSeconds: number, reason: string, ctx: ImportContext | undefined): Promise<void> {
		const promise = new Promise(resolve => window.setTimeout(resolve, durationSeconds * 1_000));

		if (ctx) {
			const previousStatusMessage = ctx.statusMessage;
			ctx.status(i18n.progress.statusWaiting({
				duration: i18n.nouns.secondWithCount({ count: durationSeconds }),
				reason,
			}));
			await promise;
			ctx.status(previousStatusMessage);
		}
		else {
			await promise;
		}
	}

	abstract import(ctx: ImportContext): Promise<void>;

	/** Use the vault's Markdown formatting unless an importer opts out. */
	protected get markdownFormatting(): MarkdownFormatting | undefined {
		return undefined;
	}

	/** Repair links to source paths that an importer had to rename. */
	protected get markdownLinkResolver(): MarkdownLinkResolver | undefined {
		return undefined;
	}

	/**
	 * Apply settings that need the whole import to exist, notably shortest and
	 * relative links. Called by both interactive and scripted import entrypoints.
	 */
	async finalizeMarkdownOutput(ctx?: ImportContext): Promise<void> {
		const previousStatus = ctx?.statusMessage ?? '';
		try {
			const total = this.markdownFiles.size;
			let current = 0;
			for (const path of this.markdownFiles) {
				ctx?.status(i18n.progress.statusStandardizing({ current: ++current, total }));
				const file = this.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) {
					const error = new Error(i18n.reason.fileNotInVault());
					if (ctx) ctx.reportFailed(path, error);
					else console.error(`Failed to standardize Markdown links in: ${path}`, error);
					continue;
				}
				try {
					await standardizeMarkdownFile(this.app, file, this.markdownFormatting, this.markdownLinkResolver);
				}
				catch (error) {
					if (ctx) ctx.reportFailed(file.path, error);
					else console.error(`Failed to standardize Markdown links in: ${file.path}`, error);
				}
			}
		}
		catch (error) {
			if (ctx) ctx.reportFailed(i18n.progress.labelFinalization(), error);
			else console.error('Failed to finalize imported Markdown', error);
		}
		finally {
			this.markdownFiles.clear();
			if (ctx) ctx.status(previousStatus);
		}
	}

	async writeImportReport(ctx: ImportContext, importerName: string): Promise<TFile | null> {
		if (ctx.log.length === 0) return null;

		const folder = await this.getOutputFolder();
		if (!folder) return null;

		const when = new Date();

		const content = formatImportReport({
			importer: importerName,
			when,
			notes: ctx.notes,
			attachments: ctx.attachments,
			cancelled: ctx.isCancelled(),
			log: ctx.log,
		});

		return await this.saveAsMarkdownFile(folder, importReportName(importerName, when), content);
	}

	/** Register Markdown written outside createFile. */
	trackMarkdownFile(file: TFile): void {
		if (file.path.toLowerCase().endsWith('.md')) this.markdownFiles.add(file.path);
	}

	protected withSourceId(content: string, sourceId: string | undefined): string {
		const { idProperty } = this;
		if (!idProperty || !sourceId || !this.saveSourceId) return content;

		const parsed = parseFrontMatterBlock(content);
		if (!parsed) return serializeFrontMatter({ [idProperty]: sourceId }) + content;

		return serializeFrontMatter({ [idProperty]: sourceId, ...parsed.frontMatter }) + parsed.body;
	}

	/**
	 * Where this note is going, and the earlier import it matches.
	 *
	 * Answering before the markdown exists lets an importer resolve attachment
	 * paths and links against the note's real location, and lets one that knows
	 * the source's modification time skip converting a note it will leave alone.
	 *
	 * The path is claimed here, new note or matched one alike, so that planning
	 * every note before writing any does not hand the same name to two of them.
	 */
	planNote(folder: TFolder | string, title: string, sourceId?: string): PlannedNote {
		const folderPath = typeof folder === 'string' ? normalizePath(folder) : folder.path;
		const parent = folderPath === '/' ? '' : folderPath;
		const name = `${sanitizeFileName(title, parent).replace(/\.md$/i, '')}.md`;
		const desiredPath = normalizePath(parent ? `${parent}/${name}` : name);

		const file = this.duplicateHandling === DuplicateHandling.CreateCopy
			? null
			: this.previouslyImported(desiredPath, sourceId);

		const targetPath = file ? file.path : this.freeFilePath(parent, name);
		this.claimPath(targetPath);

		return { title, desiredPath, targetPath, file, sourceId };
	}

	protected freeFilePath(parent: string, name: string): string {
		const unique = getUniqueFilePath(this.vault, parent, name);
		if (!this.hasClaimed(unique)) return unique;

		const at = (candidate: string) => normalizePath(parent ? `${parent}/${candidate}` : candidate);
		const free = availableFileName(name, candidate =>
			this.hasClaimed(at(candidate)) || this.vault.getAbstractFileByPathInsensitive(at(candidate)) !== null);

		return at(free);
	}

	protected mirroredFolderPath(parent: string, sourceName: string, chosen: boolean): string {
		const name = sanitizeFileName(sourceName, parent);
		let at = chosen && this.duplicateHandling === DuplicateHandling.CreateCopy
			? this.freeFilePath(parent, name)
			: normalizePath(parent ? `${parent}/${name}` : name);
		const existing = this.vault.getAbstractFileByPathInsensitive(at);

		if (existing instanceof TFolder) at = existing.path;
		else if (existing) at = this.freeFilePath(parent, name);

		return at;
	}

	/**
	 * What to do with a resolved note, before its markdown is generated. Reports
	 * the reason for every answer that settles the matter here, so an importer
	 * can act on it and move on.
	 */
	protected preflightNote(ctx: ImportContext, resolved: PlannedNote, sourceMtime?: number): NoteDisposition {
		const { file, title, targetPath, desiredPath } = resolved;

		if (!file) {
			return this.duplicateHandling === DuplicateHandling.CreateCopy && targetPath !== desiredPath
				? 'copy'
				: 'create';
		}

		if (this.duplicateHandling === DuplicateHandling.Skip) {
			ctx.reportSkipped(title, i18n.reason.alreadyInVault());
			return 'skip';
		}

		if (sourceMtime === undefined) return 'compare-content';

		const disposition = comparedToSource(file, sourceMtime);
		if (disposition !== 'update') this.reportUnwritten(ctx, title, disposition);

		return disposition;
	}

	/**
	 * Create, update or leave a planned note, and say which. Pass the
	 * `disposition` an earlier `preflightNote` returned to act on the answer it
	 * already reported; without one the decision is made here.
	 */
	async writePlannedNote(
		ctx: ImportContext,
		planned: PlannedNote,
		content: string,
		options: NoteImport & { disposition?: NoteDisposition } = {},
	): Promise<NoteWritten> {
		const { sourceId = planned.sourceId, disposition, templateVariables, ...writeOptions } = options;
		const { file, title, targetPath } = planned;
		content = await this.applyNoteTemplate(planned.title, planned.targetPath, content, templateVariables, sourceId);
		content = this.withSourceId(content, sourceId);

		let decided = disposition ?? this.preflightNote(ctx, planned, writeOptions.mtime);

		if (decided === 'compare-content') {
			decided = !file ? 'create'
				: await this.unchangedContent(ctx, file, title, content) ? 'unchanged'
					: 'update';
		}

		switch (decided) {
			case 'skip':
			case 'unchanged':
			case 'preserve':
				// All three answers matched a note, so there is a file here.
				return { file: file!, written: false, outcome: OUTCOME_OF[decided] };

			case 'update':
				await this.modifyMarkdown(file!, content, writeOptions);
				this.claimPath(file!.path);
				return { file: file!, written: true, outcome: 'updated' };

			default:
				return {
					file: await this.createMarkdown(targetPath, content, writeOptions),
					written: true,
					outcome: 'created',
				};
		}
	}

	protected async applyNoteTemplate(
		title: string,
		targetPath: string,
		content: string,
		provided: NoteTemplateVariables | undefined,
		sourceId: string | undefined,
	): Promise<string> {
		const template = await this.readTemplate();
		if (template === null) return content;

		const parsed = parseFrontMatterBlock(content);
		const timestamp = new Date().toISOString();
		const { parent, basename } = parseFilePath(targetPath);
		const properties = parsed?.frontMatter ?? {};
		const source = { ...properties, ...provided };
		const variables: NoteTemplateVariables = {
			// Source values are convenient at the top level. Common variables are
			// applied afterwards so a property named "content" cannot hide the
			// imported Markdown; collisions remain available below {{source}}.
			...source,
			title,
			noteName: basename,
			path: targetPath,
			folder: parent,
			content,
			body: parsed?.body ?? content,
			properties,
			source,
			date: timestamp,
			time: timestamp,
			importer: this.host.importerId,
			sourceId: sourceId ?? '',
		};

		return await renderNoteTemplate(template, variables);
	}

	private async readTemplate(): Promise<string | null> {
		const configured = this.templatePath.trim();
		if (!configured) return null;
		const path = normalizePath(configured);
		if (this.loadedTemplate?.path === path) return this.loadedTemplate.content;

		const file = this.vault.getAbstractFileByPath(path)
			?? this.vault.getAbstractFileByPathInsensitive(path);
		if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') {
			throw new Error(i18n.output.msgTemplateNotFound({ path: this.templatePath }));
		}

		const template = await this.vault.cachedRead(file);
		this.loadedTemplate = { path: file.path, content: template };
		return template;
	}

	/** Write, update, or match an imported note according to the duplicate mode. */
	async writeNote(ctx: ImportContext, folder: TFolder, title: string, content: string, options: NoteImport = {}): Promise<NoteWritten> {
		const { sourceId, ...writeOptions } = options;
		const resolved = this.planNote(folder, title, sourceId);

		return await this.writePlannedNote(ctx, resolved, content, { ...writeOptions, sourceId });
	}

	private reportUnwritten(ctx: ImportContext, title: string, disposition: 'unchanged' | 'preserve'): void {
		ctx.reportSkipped(title, disposition === 'unchanged'
			? i18n.reason.unchangedSinceImport()
			: i18n.reason.editedSinceImport());
	}

	/** Find a previous import by source ID, falling back to its expected path. */
	protected previouslyImported(fullPath: string, sourceId?: string): TFile | null {
		const { idProperty } = this;

		if (idProperty && sourceId) {
			const known = this.importedById?.get(sourceId);
			// A note this run has already taken belongs to whatever took it.
			if (known && !this.hasClaimed(known.path) && this.vault.getAbstractFileByPath(known.path) === known) {
				return known;
			}
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

	/**
	 * What a source with no modification time is left with. It cannot tell an
	 * edit the user made from a change in the source: both read as different.
	 */
	private async unchangedContent(ctx: ImportContext, file: TFile, title: string, content: string): Promise<boolean> {
		try {
			const current = await this.vault.read(file);
			if (current !== await standardizedMarkdown(
				this.app, file.path, content, this.markdownFormatting, this.markdownLinkResolver,
			)) return false;
		}
		catch (error) {
			console.error(`Could not read the note already at: ${file.path}`, error);
			return false;
		}

		this.reportUnwritten(ctx, title, 'unchanged');
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
		const file = await createMarkdown(this.vault, path, content, options, this.markdownFormatting);
		this.trackMarkdownFile(file);
		return file;
	}

	async modifyMarkdown(file: TFile, content: string, options?: DataWriteOptions): Promise<void> {
		await modifyMarkdown(this.vault, file, content, options, this.markdownFormatting);
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
			throw new Error(i18n.reason.folderNotCreated({ path }));
		}

		return folder;
	}

	async createFile(folder: TFolder, fileName: string, content: string, options?: DataWriteOptions): Promise<TFile> {
		const path = getUniqueFilePath(this.vault, folder.path, fileName);

		if (path.toLowerCase().endsWith('.md')) content = formattedMarkdown(this.vault, content, this.markdownFormatting);

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
		const sanitizedName = sanitizeFileName(title, folder.path === '/' ? '' : folder.path).replace(/\.md$/i, '');

		return await this.createFile(folder, `${sanitizedName}.md`, content, options);
	}
}
