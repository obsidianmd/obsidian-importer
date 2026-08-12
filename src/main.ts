import { App, getLanguage, IconName, Modal, Notice, Platform, Plugin, prepareFuzzySearch, renderMatches, SearchComponent, SearchResult, Setting, setIcon, TFile } from 'obsidian';
import { FormatImporter, ImporterHost } from './format-importer';
import { dataTransferHasFiles, droppedItems, expandDropped, NodePickedFile, PickedFile, PickedFolder } from './filesystem';
import { ImporterFileTypes, importersForFiles } from './importer-match';
import { AuthCallback, helpUrl } from './constants';
import { ImportContext, ImportLogEntry } from './import-context';
import { DEFAULT_DATA, ImporterData } from './plugin-data';
import { AirtableAPIImporter } from './formats/airtable-api';
import { AppleNotesImporter } from './formats/apple-notes';
import { AppleJournalImporter } from './formats/apple-journal';
import { Bear2bkImporter } from './formats/bear-bear2bk';
import { CSVImporter } from './formats/csv';
import { EvernoteEnexImporter } from './formats/evernote-enex';
import { HtmlImporter } from './formats/html';
import { KeepImporter } from './formats/keep-json';
import { NotionImporter } from './formats/notion';
import { NotionAPIImporter } from './formats/notion-api';
import { OneNoteImporter } from './formats/onenote';
import { OneNoteFileImporter } from './formats/onenote-file';
import { RoamJSONImporter } from './formats/roam-json';
import { TextbundleImporter } from './formats/textbundle';
import { TomboyImporter } from './formats/tomboy';
import { i18n, setLanguage } from './i18n';
import { describeReason } from './util';

declare global {
	interface Window {
		electron: {
			remote: {
				dialog: {
					showOpenDialogSync(options: Record<string, unknown>): string[] | undefined;
				};
			};
			/** Absent before Electron 32, where a File still carried its own path. */
			webUtils?: {
				getPathForFile(file: File): string;
			};
		};
		require: NodeJS.Require;
	}
}

/** An importer class, and the file types it declares for a dropped file to be matched against. */
type ImporterClass = (new (app: App, host: ImporterHost) => FormatImporter) & { extensions: readonly string[] };

interface ImporterDefinition {
	helpPermalink?: string;
	importer: ImporterClass;
}

const IMPORTER_GROUPS: Record<string, string[]> = {
	'onenote': ['onenote-file', 'onenote'],
	'notion': ['notion-api', 'notion'],
};

function groupHelpPermalink(plugin: ImporterPlugin, group: string): string | undefined {
	for (const member of IMPORTER_GROUPS[group]) {
		const permalink = plugin.importers[member]?.helpPermalink;
		if (permalink) return permalink;
	}

	return undefined;
}

function groupOf(id: string): string | undefined {
	for (const [group, members] of Object.entries(IMPORTER_GROUPS)) {
		if (members.includes(id)) return group;
	}

	return undefined;
}

function groupName(group: string): string {
	return i18n.group(`${group}.name`);
}

/** The format's own name, and the longer line it is listed under. */
function importerName(id: string): string {
	return i18n.importer(`${id}.name`);
}

function importerOptionText(id: string): string {
	return i18n.importer(`${id}.option-text`);
}


function outcomeText(ctx: ImportContext): string {
	return ctx.failed.length > 0 ? i18n.progress.msgErrors() : i18n.progress.msgComplete();
}

function statusText(message: string): string {
	const trimmed = message.trim();
	if (!trimmed) return '';

	return trimmed.endsWith('.') ? trimmed : `${trimmed}...`;
}

const FALLBACK_ICONS: Record<string, IconName> = {
	'csv': 'table',
	'html': 'code-2',
	'textbundle': 'package',
	'tomboy': 'sticky-note',
};

function pausedText(message: string): string {
	const trimmed = message.trim();
	if (!trimmed) return i18n.progress.labelPaused();

	return i18n.progress.labelPausedWith({ status: trimmed.replace(/\.+$/, '') });
}

export class ImportProgressUI extends ImportContext {
	el: HTMLElement;
	progressBarEl: HTMLElement;
	progressBarInnerEl: HTMLElement;
	importedCountEl: HTMLElement;
	attachmentCountEl: HTMLElement;
	remainingCountEl: HTMLElement;
	skippedCountEl: HTMLElement;
	failedCountEl: HTMLElement;
	statusEl: HTMLElement;
	importLogEl: HTMLElement;

	private finished: boolean = false;
	private scrollQueued: boolean = false;

	constructor(el: HTMLElement) {
		super();
		this.el = el;
		this.createProgressUI(el);
	}

	createProgressUI(container: HTMLElement) {
		container.empty();

		this.el = container;
		this.statusEl = container.createDiv('importer-status');

		this.progressBarEl = container.createDiv('importer-progress-bar', el => {
			this.progressBarInnerEl = el.createDiv('importer-progress-bar-inner');
		});

		container.createDiv('importer-stats-container', el => {
			el.createDiv('importer-stat mod-imported', el => {
				this.importedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.notes.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: i18n.progress.statImported() });
			});
			el.createDiv('importer-stat mod-attachments', el => {
				this.attachmentCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.attachments.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: i18n.progress.statAttachments() });
			});
			el.createDiv('importer-stat mod-remaining', el => {
				this.remainingCountEl = el.createDiv({ cls: 'importer-stat-count', text: '0' });
				el.createDiv({ cls: 'importer-stat-name', text: i18n.progress.statRemaining() });
			});
			el.createDiv('importer-stat mod-skipped', el => {
				this.skippedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.skipped.length.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: i18n.progress.statSkipped() });
			});
			el.createDiv('importer-stat mod-failed', el => {
				this.failedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.failed.length.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: i18n.progress.statFailed() });
			});
		});

		this.importLogEl = container.createDiv('importer-log');
		this.importLogEl.hide();

		if (this.isPaused()) this.onPaused(true);
		else this.onStatus(this.statusMessage);
		if (this.progressTotal > 0) this.onProgress(this.progressCurrent, this.progressTotal);
		if (this.log.length > 0) {
			const drawn = createFragment();
			for (const entry of this.log) this.drawLogEntry(entry, drawn);
			this.importLogEl.append(drawn);
			this.importLogEl.show();
			this.scrollLogToEnd();
		}
		if (this.finished) this.onFinish();
	}

	protected onStatus(message: string): void {
		const text = this.isPaused() ? pausedText(message) : statusText(message);
		this.statusEl.setText(text);
		this.statusEl.toggle(text.length > 0);
	}

	protected onPaused(paused: boolean): void {
		this.el.toggleClass('is-paused', paused);
		this.onStatus(this.statusMessage);
	}

	protected onNoteSuccess(): void {
		this.importedCountEl.setText(this.notes.toString());
	}

	protected onAttachmentSuccess(): void {
		this.attachmentCountEl.setText(this.attachments.toString());
	}

	protected onLogged(entry: ImportLogEntry): void {
		if (entry.outcome !== 'message') {
			const countEl = entry.outcome === 'failed' ? this.failedCountEl : this.skippedCountEl;
			countEl.setText((entry.outcome === 'failed' ? this.failed : this.skipped).length.toString());
		}

		this.drawLogEntry(entry);
		this.importLogEl.show();
		this.scrollLogToEnd();
	}

	// Progress includes skipped and failed items; onNoteSuccess updates imported count.
	protected onProgress(current: number, total: number): void {
		this.remainingCountEl.setText((total - current).toString());
		this.progressBarInnerEl.style.width = (100 * current / total).toFixed(1) + '%';
	}

	// Preserve final progress, but hide a bar that never had a total.
	protected onFinish(): void {
		this.finished = true;
		if (this.progressTotal <= 0) this.progressBarEl.hide();
	}

	// Batch scroll measurements to avoid a forced layout per log entry.
	private scrollLogToEnd(): void {
		if (this.scrollQueued) return;

		this.scrollQueued = true;
		window.requestAnimationFrame(() => {
			this.scrollQueued = false;
			this.importLogEl.scrollTop = this.importLogEl.scrollHeight;
		});
	}

	private drawLogEntry({ outcome, name, reason }: ImportLogEntry, into: Node = this.importLogEl): void {
		if (outcome === 'message') {
			into.createDiv('list-item', el => el.createSpan({ text: name }));
			return;
		}

		into.createDiv('list-item', el => {
			el.createSpan({
				cls: 'importer-error',
				text: outcome === 'failed' ? i18n.progress.labelFailed() : i18n.progress.labelSkipped(),
			});
			el.createSpan({
				text: reason
					? i18n.progress.labelEntryWithReason({ name, reason: describeReason(reason) })
					: i18n.progress.labelEntry({ name }),
			});
		});
	}
}

export default class ImporterPlugin extends Plugin {
	importers: Record<string, ImporterDefinition>;

	authCallback: AuthCallback | undefined;

	private handledAuthState: string | undefined;

	private modal: ImporterModal | null = null;

	async onload() {
		setLanguage(getLanguage());

		// The name and the picker line for each of these live in the string
		// table, under the same id.
		this.importers = {
			'airtable-api': {
				importer: AirtableAPIImporter,
				helpPermalink: 'import/airtable',
			},
			'apple-notes': {
				importer: AppleNotesImporter,
				helpPermalink: 'import/apple-notes'
			},
			'apple-journal': {
				importer: AppleJournalImporter,
			},
			'bear': {
				importer: Bear2bkImporter,
				helpPermalink: 'import/bear',
			},
			'csv': {
				importer: CSVImporter,
				helpPermalink: 'import/csv',
			},
			'evernote': {
				importer: EvernoteEnexImporter,
				helpPermalink: 'import/evernote',
			},
			'keep': {
				importer: KeepImporter,
				helpPermalink: 'import/google-keep',
			},
			'html': {
				importer: HtmlImporter,
				helpPermalink: 'import/html',
			},
			'onenote': {
				importer: OneNoteImporter,
				helpPermalink: 'import/onenote',
			},
			'onenote-file': {
				importer: OneNoteFileImporter,
				helpPermalink: 'import/onenote',
			},
			'notion-api': {
				importer: NotionAPIImporter,
				helpPermalink: 'import/notion',
			},
			'notion': {
				importer: NotionImporter,
				helpPermalink: 'import/notion',
			},
			'roam-json': {
				importer: RoamJSONImporter,
				helpPermalink: 'import/roam',
			},
			'textbundle': {
				importer: TextbundleImporter,
				helpPermalink: 'import/textbundle',
			},
			'tomboy': {
				importer: TomboyImporter,
			},
		};

		this.addRibbonIcon('lucide-import', i18n.command.importNotes(), () => {
			this.openImporter();
		});

		this.addCommand({
			id: 'open-modal',
			name: i18n.command.importNotes(),
			callback: () => {
				this.openImporter();
			},
		});

		this.registerObsidianProtocolHandler('importer-auth',
			(data) => {
				if (this.authCallback) {
					this.handledAuthState = data['state'];
					this.authCallback(data);
					this.authCallback = undefined;
					return;
				}

				// Browsers may open the same callback URI twice.
				if (data['state'] && data['state'] === this.handledAuthState) return;

				new Notice(i18n.modal.msgUnexpectedAuth());
			});
	}

	openImporter(): ImporterModal {
		if (this.modal) {
			this.modal.show();
			return this.modal;
		}

		const modal = this.modal = new ImporterModal(this.app, this);
		modal.open();
		return modal;
	}

	forgetImporter(modal: ImporterModal): void {
		if (this.modal === modal) {
			this.modal = null;
		}
	}

	onunload() {

	}

	async loadData(): Promise<ImporterData> {
		return Object.assign({}, DEFAULT_DATA, await super.loadData());
	}

	async saveData(data: ImporterData): Promise<void> {
		await super.saveData(data);
	}

	/**
	 * Register a function to be called when the `obsidian://importer-auth/` open
	 * event is received by Obsidian.
	 *
	 * Note: The callback will be cleared after being called. It must be
	 * reregistered if a subsequent auth event is expected.
	 */
	public registerAuthCallback(callback: AuthCallback): void {
		this.authCallback = callback;
	}

	public async runImport(
		importerId: string,
		filepaths: string[],
		outputLocation: string,
		configure?: (importer: FormatImporter) => void
	): Promise<ImportContext> {
		if (!Platform.isDesktopApp) {
			throw new Error('An import driven by a script reads files from disk, which needs the desktop app.');
		}

		const definition = this.importers[importerId];
		if (!definition) {
			throw new Error(`No importer called "${importerId}". One of: ${Object.keys(this.importers).join(', ')}`);
		}

		const host: ImporterHost = {
			sourceEl: null,
			outputEl: null,
			optionsEl: null,
			plugin: this,
			importerId,
			abortController: new AbortController(),
		};

		const importer = new definition.importer(this.app, host);

		await importer.ready;

		if (importer.notAvailable) {
			throw new Error(`The ${importerName(importerId)} importer is not available here.`);
		}

		if (importer.showTemplateConfiguration !== FormatImporter.prototype.showTemplateConfiguration) {
			throw new Error(`The ${importerName(importerId)} importer is configured on a second screen, which an import without the dialog cannot show yet.`);
		}

		importer.files = filepaths.map(filepath => new NodePickedFile(filepath));
		importer.outputLocation = outputLocation;
		configure?.(importer);

		const ctx = new ImportContext();
		try {
			importer.indexImportedNotes();
			await importer.import(ctx);
		}
		finally {
			await importer.finalizeMarkdownOutput(ctx);
		}
		return ctx;
	}
}

export class ImporterModal extends Modal implements ImporterHost {
	plugin: ImporterPlugin;
	importer: FormatImporter;
	selectedId: string;
	abortController: AbortController;

	sourceEl: HTMLElement | null = null;
	outputEl: HTMLElement | null = null;
	optionsEl: HTMLElement | null = null;

	private nextButtonEl: HTMLButtonElement | null = null;

	/** Whether the screen is a list of formats, which is what decides where a drop goes. */
	private pickingFormat: boolean = false;

	private dropOverlayEl: HTMLElement | null = null;
	private dropWin: Window | null = null;

	get importerId(): string {
		return this.selectedId;
	}

	current: ImportContext | null = null;

	private hidden: boolean = false;
	private hiddenNotice: Notice | null = null;
	private hiddenInterval: number | null = null;

	private reportFile: TFile | null = null;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app);
		this.plugin = plugin;
		this.modalEl.addClass('mod-importer');
		this.abortController = new AbortController();
		this.catchBackgroundClick();

		this.showFormatPicker();
	}

	showFormatPicker() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		this.pickingFormat = true;
		modalEl.addClass('is-picking-format');
		this.titleEl.setText(i18n.modal.titlePickFormat());

		const groupEl = contentEl.createDiv('setting-group mod-list');
		const searchEl = groupEl.createDiv('setting-group-search');
		const itemsEl = groupEl.createDiv('setting-items');

		let rows: HTMLElement[] = [];

		const focusRow = (index: number) => {
			if (index < 0 || rows.length === 0) search.inputEl.focus();
			else rows[Math.min(index, rows.length - 1)].focus();
		};

		const draw = (query: string) => {
			itemsEl.empty();
			rows = [];

			for (const [id, match] of this.searchFormats(query)) {
				const optionText = this.rowText(id);

				this.addFormatRow(itemsEl, rows, id, () => this.chooseRow(id), focusRow)
					.setName(createFragment(frag => {
						if (match) renderMatches(frag, optionText, match.matches);
						else frag.appendText(optionText);
					}));
			}

			if (rows.length === 0) {
				new Setting(itemsEl).setClass('mod-empty-state').setName(i18n.modal.msgNoFormats());
			}
		};

		const search = new SearchComponent(searchEl)
			.setPlaceholder(i18n.modal.searchPlaceholder())
			.onChange(value => draw(value));

		search.inputEl.addEventListener('keydown', evt => {
			if (evt.key !== 'ArrowDown' && evt.key !== 'Enter') return;
			evt.preventDefault();

			if (evt.key === 'Enter') rows[0]?.click();
			else focusRow(0);
		});

		draw('');
		search.inputEl.focus();
	}

	/**
	 * One row of a list the arrow keys walk. `focus` is how the list answers a
	 * step off either end; the format picker sends the step above the first row
	 * back to its search box.
	 */
	private addNavigableRow(
		itemsEl: HTMLElement,
		rows: HTMLElement[],
		choose: () => void,
		focus: (index: number) => void = index => rows[Math.min(Math.max(index, 0), rows.length - 1)]?.focus(),
	): Setting {
		const setting = new Setting(itemsEl).setClass('mod-navigable');
		const { settingEl } = setting;
		const index = rows.length;

		settingEl.tabIndex = 0;
		settingEl.addEventListener('click', choose);
		settingEl.addEventListener('keydown', evt => {
			switch (evt.key) {
				case 'Enter':
				case ' ':
					choose();
					break;
				case 'ArrowDown':
					focus(index + 1);
					break;
				case 'ArrowUp':
					focus(index - 1);
					break;
				default:
					return;
			}

			evt.preventDefault();
		});

		rows.push(settingEl);
		return setting;
	}

	/** A navigable row for a format: the app's icon before its name, a chevron after. */
	private addFormatRow(
		itemsEl: HTMLElement,
		rows: HTMLElement[],
		id: string,
		choose: () => void,
		focus?: (index: number) => void,
	): Setting {
		const setting = this.addNavigableRow(itemsEl, rows, choose, focus);

		const iconEl = createDiv(`setting-item-icon importer-app-icon mod-${id}`);
		if (FALLBACK_ICONS[id]) setIcon(iconEl, FALLBACK_ICONS[id]);
		setting.settingEl.prepend(iconEl);

		setIcon(setting.controlEl.createSpan('importer-format-chevron'), 'lucide-chevron-right');

		return setting;
	}

	private pickableIds(): string[] {
		const offered: string[] = [];

		for (const id of Object.keys(this.plugin.importers)) {
			const group = groupOf(id);
			const entry = group ?? id;
			if (!offered.includes(entry)) offered.push(entry);
		}

		return offered;
	}

	private rowText(id: string): string {
		return id in IMPORTER_GROUPS ? groupName(id) : importerOptionText(id);
	}

	private searchFormats(query: string): [string, SearchResult | null][] {
		const ids = this.pickableIds();

		if (!query) return ids.map(id => [id, null]);

		const search = prepareFuzzySearch(query);
		const results: { id: string, match: SearchResult | null, score: number }[] = [];

		for (const id of ids) {
			const match = search(this.rowText(id));

			// Match group rows against each import method too.
			const searchable = id in IMPORTER_GROUPS
				? IMPORTER_GROUPS[id].flatMap(member => [importerName(member), importerOptionText(member)])
				: [importerName(id)];

			const best = Math.max(match?.score ?? -Infinity, ...searchable.map(text => search(text)?.score ?? -Infinity));
			if (best === -Infinity) continue;

			results.push({ id, match, score: best });
		}

		results.sort((a, b) => b.score - a.score);
		return results.map(({ id, match }) => [id, match]);
	}

	private chooseRow(id: string): void {
		if (id in IMPORTER_GROUPS) this.showMethodPicker(id);
		else this.selectFormat(id);
	}

	private showMethodPicker(group: string): void {
		const { contentEl, modalEl } = this;

		contentEl.empty();
		this.nextButtonEl = null;
		this.pickingFormat = true;
		modalEl.removeClass('is-picking-format');
		this.titleEl.setText(i18n.modal.titleChooseMethod());

		const itemsEl = contentEl.createDiv('setting-group mod-list').createDiv('setting-items');
		const rows: HTMLElement[] = [];

		for (const member of IMPORTER_GROUPS[group]) {
			if (!Object.prototype.hasOwnProperty.call(this.plugin.importers, member)) continue;

			const setting = this.addNavigableRow(itemsEl, rows, () => this.selectFormat(member))
				.setName(i18n.importer(`${member}.method-name`))
				.setDesc(i18n.importer(`${member}.method-desc`));

			setIcon(setting.controlEl.createSpan('importer-format-chevron'), 'lucide-chevron-right');
		}

		contentEl.createDiv('modal-button-container importer-step-buttons', el => {
			el.createEl('button', { text: i18n.modal.buttonBack() }, el => {
				el.addEventListener('click', () => this.showFormatPicker());
			});

			const permalink = groupHelpPermalink(this.plugin, group);
			if (permalink) {
				el.createEl('button', { text: i18n.modal.buttonHelp() }, el => {
					el.addEventListener('click', () => window.open(helpUrl(permalink)));
				});
			}
		});

		rows[0]?.focus();
	}

	selectFormat(id: string) {
		if (!Object.prototype.hasOwnProperty.call(this.plugin.importers, id)) return;

		if (id === this.selectedId && this.importer) {
			this.showFirstStep();
			return;
		}

		this.selectedId = id;
		this.setUpImporter();
	}

	private showPreviousScreen(): void {
		const group = groupOf(this.selectedId);
		if (group) this.showMethodPicker(group);
		else this.showFormatPicker();
	}

	private setUpImporter() {
		const definition = this.plugin.importers[this.selectedId];

		this.sourceEl = createDiv();
		this.outputEl = createDiv();
		this.optionsEl = createDiv();

		this.importer = new definition.importer(this.app, this);

		this.showFirstStep();
	}

	private showFirstStep() {
		if (this.importer.notAvailable) {
			this.drawStep(this.optionsEl, () => this.showPreviousScreen(), () => {});
			return;
		}

		this.showSourceStep();
	}

	private hasOptionsStep(): boolean {
		return (this.optionsEl?.childElementCount ?? 0) > 0;
	}

	showSourceStep() {
		this.drawStep(this.sourceEl, () => this.showPreviousScreen(), el => {
			this.nextButtonEl = el.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonContinue() }, el => {
				el.addEventListener('click', () => void this.showOutputStep());
			});

			this.sourceChanged();
		});
	}

	sourceChanged(): void {
		if (this.nextButtonEl) this.nextButtonEl.disabled = !this.importer.sourceReady;
	}

	async showOutputStep() {
		const { importer } = this;

		await importer.ready;
		importer.drawOutputStep();

		this.drawStep(this.outputEl, () => this.showSourceStep(), el => {
			if (this.hasOptionsStep()) {
				el.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonContinue() }, el => {
					el.addEventListener('click', () => this.showOptionsStep());
				});
				return;
			}

			this.addImportButton(el, importer);
		});
	}

	showOptionsStep() {
		const { importer } = this;

		this.drawStep(this.optionsEl, () => void this.showOutputStep(), el => {
			this.addImportButton(el, importer);
		});
	}

	private addImportButton(buttonsEl: HTMLElement, importer: FormatImporter) {
		buttonsEl.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonImport() }, el => {
			el.addEventListener('click', () => void this.startImport(importer)
				.catch(e => console.error('Import failed', e)));
		});
	}

	/**
	 * More than one format reads what was dropped, so the user says which. The
	 * methods of a group are listed apart here rather than behind the app they
	 * share: only one of them reads a file at all.
	 */
	private showFormatOffer(ids: string[], files: PickedFile[]) {
		const { contentEl, modalEl } = this;

		contentEl.empty();
		this.nextButtonEl = null;
		this.pickingFormat = true;
		modalEl.removeClass('is-picking-format');
		this.titleEl.setText(i18n.modal.titleChooseMethod());

		contentEl.createDiv('setting-item-description importer-drop-hint', el => {
			// One file can be named; a pile of them is a count.
			el.setText(files.length === 1
				? i18n.modal.msgChooseForFile({ name: files[0].name })
				: i18n.modal.msgChooseForFiles({ files: i18n.nouns.fileWithCount({ count: files.length }) }));
		});

		const itemsEl = contentEl.createDiv('setting-group mod-list').createDiv('setting-items');
		const rows: HTMLElement[] = [];

		for (const id of ids) {
			this.addFormatRow(itemsEl, rows, id, () => void this.handOver(id, files))
				.setName(importerOptionText(id));
		}

		contentEl.createDiv('modal-button-container importer-step-buttons', el => {
			el.createEl('button', { text: i18n.modal.buttonShowAllFormats() }, el => {
				el.addEventListener('click', () => this.showFormatPicker());
			});
		});

		rows[0]?.focus();
	}

	/** What each importer would take a dropped file to be. */
	private fileTypes(): ImporterFileTypes[] {
		return Object.entries(this.plugin.importers)
			.map(([id, definition]) => ({ id, extensions: definition.importer.extensions }));
	}

	/**
	 * Where files dropped on the window go: to the importer already on screen
	 * when it reads them, and otherwise to whichever importer does.
	 */
	private async takeDropped(dropped: (PickedFile | PickedFolder)[]): Promise<void> {
		const files = await expandDropped(dropped);

		if (files.length > 0 && !this.pickingFormat && this.importer && this.importer.takeFiles(files) > 0) {
			this.showSourceStep();
			return;
		}

		const ids = importersForFiles(this.fileTypes(), files.map(file => file.extension));

		if (ids.length === 0) {
			new Notice(i18n.modal.msgNoFormatForFiles());
			return;
		}

		if (ids.length === 1) {
			await this.handOver(ids[0], files);
			return;
		}

		this.showFormatOffer(ids, files);
	}

	private async handOver(id: string, files: PickedFile[]): Promise<void> {
		this.selectFormat(id);

		const { importer } = this;
		await importer.ready;

		// An importer that cannot run here has already said so on screen.
		if (importer.notAvailable) return;

		if (importer.takeFiles(files) === 0) {
			new Notice(i18n.modal.msgNoFormatForFiles());
			return;
		}

		// An importer whose picker is drawn once init() has finished has taken
		// the files, but the step showing them was drawn before that.
		this.showSourceStep();
	}

	private catchFileDrop(win: Window): void {
		this.dropWin = win;
		win.addEventListener('dragover', this.onDragOver, { capture: true });
		win.addEventListener('dragleave', this.onDragLeave, { capture: true });
		win.addEventListener('dragend', this.onDragLeave, { capture: true });
		win.addEventListener('drop', this.onDrop, { capture: true });
	}

	private forgetFileDrop(): void {
		const win = this.dropWin;
		if (!win) return;

		this.dropWin = null;
		win.removeEventListener('dragover', this.onDragOver, { capture: true });
		win.removeEventListener('dragleave', this.onDragLeave, { capture: true });
		win.removeEventListener('dragend', this.onDragLeave, { capture: true });
		win.removeEventListener('drop', this.onDrop, { capture: true });
	}

	/** A drop belongs to whatever is underneath while an import runs, or while the modal is out of the way. */
	private acceptsDrop(): boolean {
		return !this.hidden && !this.current;
	}

	private onDragOver = (evt: DragEvent) => {
		if (!this.acceptsDrop() || !evt.dataTransfer || !dataTransferHasFiles(evt.dataTransfer)) return;

		// preventDefault is what allows the drop; stopPropagation is what keeps
		// the note underneath from taking it.
		evt.preventDefault();
		evt.stopPropagation();
		evt.dataTransfer.dropEffect = 'copy';

		this.showDropOverlay();
	};

	private onDragLeave = (evt: DragEvent) => {
		// A leave with somewhere to go is a move between elements of the window.
		if (evt.type === 'dragleave' && evt.relatedTarget) return;

		this.hideDropOverlay();
	};

	private onDrop = (evt: DragEvent) => {
		if (!this.acceptsDrop() || !evt.dataTransfer || !dataTransferHasFiles(evt.dataTransfer)) return;

		evt.preventDefault();
		evt.stopPropagation();
		this.hideDropOverlay();

		// Read here: what a drop is carrying is gone by the time an await returns.
		const dropped = droppedItems(evt.dataTransfer);
		if (dropped.length === 0) return;

		void this.takeDropped(dropped).catch(e => console.error('Could not read what was dropped', e));
	};

	private showDropOverlay(): void {
		if (this.dropOverlayEl) return;

		this.dropOverlayEl = this.containerEl.createDiv('importer-drop-overlay', el => {
			el.createDiv({ cls: 'importer-drop-message', text: i18n.modal.msgDropToImport() });
		});
	}

	private hideDropOverlay(): void {
		this.dropOverlayEl?.detach();
		this.dropOverlayEl = null;
	}

	private drawStep(stepEl: HTMLElement | null, onBack: () => void, buildButtons: (buttonsEl: HTMLElement) => void) {
		const { contentEl, modalEl } = this;
		const definition = this.plugin.importers[this.selectedId];

		contentEl.empty();
		this.nextButtonEl = null;
		this.pickingFormat = false;
		modalEl.removeClass('is-picking-format');
		// Keep grouped importers under the app name.
		const group = groupOf(this.selectedId);
		this.titleEl.setText(i18n.modal.titleImportFrom({
			format: group ? groupName(group) : importerName(this.selectedId),
		}));

		if (stepEl) contentEl.append(stepEl);

		contentEl.createDiv('modal-button-container importer-step-buttons', el => {
			el.createEl('button', { text: i18n.modal.buttonBack() }, el => {
				el.addEventListener('click', onBack);
			});

			if (definition.helpPermalink) {
				const permalink = definition.helpPermalink;
				el.createEl('button', { text: i18n.modal.buttonHelp() }, el => {
					el.addEventListener('click', () => window.open(helpUrl(permalink)));
				});
			}

			buildButtons(el);
		});
	}

	private async startImport(importer: FormatImporter) {
		if (this.current) {
			this.current.cancel();
		}

		this.reportFile = null;

		const { contentEl } = this;

		contentEl.empty();
		let configEl = contentEl.createDiv();
		let ctx = this.current = new ImportProgressUI(configEl);

		const templateResult = await importer.showTemplateConfiguration(ctx, configEl);

		if (templateResult === false) {
			this.current = null;
			if (this.hasOptionsStep()) this.showOptionsStep();
			else void this.showOutputStep();
			return;
		}

		this.showProgress(ctx, importer.interruption);
		const name = importerName(this.selectedId);
		let threw = false;
		try {
			importer.indexImportedNotes();
			await importer.import(ctx);
		}
		catch (e) {
			// An importer is meant to report a bad note and carry on, but one that
			// throws instead would otherwise finish on a summary of all zeros, with
			// the reason only in the console.
			threw = true;
			ctx.reportFailed(name, e);
		}
		finally {
			await importer.finalizeMarkdownOutput(ctx);
			if (this.current === ctx) {
				this.current = null;
			}

			ctx.status(ctx.isCancelled() ? '' : outcomeText(ctx));
			ctx.finish();

			// An import that threw never got as far as its checkpoints, which is
			// no evidence that the importer neglects them.
			const reported = ctx.notes + ctx.attachments + ctx.skipped.length + ctx.failed.length;
			if (!threw && importer.interruption !== 'none' && ctx.checkpoints === 0 && reported > 0) {
				console.warn(
					`The ${name} importer offers ${importer.interruption} but never awaited ` +
					`ctx.shouldStop(), so neither button could have done anything`
				);
			}

			if (this.hidden) {
				this.finishHiddenNotice(ctx);
			}

			this.showFinished(ctx);
		}
	}

	private showProgress(ctx: ImportProgressUI, interruption: FormatImporter['interruption']) {
		const { contentEl } = this;
		contentEl.empty();
		ctx.createProgressUI(contentEl.createDiv());

		if (ctx.isCancelled()) return;

		if (interruption === 'none') return;

		let buttonsEl = contentEl.createDiv('modal-button-container');

		let pauseButtonEl: HTMLElement | null = null;
		if (interruption === 'pause') {
			const pauseText = () => ctx.isPaused() ? i18n.modal.buttonResume() : i18n.modal.buttonPause();
			let button = buttonsEl.createEl('button', { text: pauseText() }, el => {
				el.addEventListener('click', () => {
					if (ctx.isPaused()) ctx.resume();
					else ctx.pause();

					button.setText(pauseText());
				});
			});
			pauseButtonEl = button;
		}

		let cancelButtonEl = buttonsEl.createEl('button', { cls: 'mod-danger', text: i18n.modal.buttonStop() }, el => {
			el.addEventListener('click', () => {
				ctx.cancel();
				ctx.status(i18n.progress.statusStopping());
				pauseButtonEl?.detach();
				cancelButtonEl.detach();

				// Show disabled finish actions while cancellation completes.
				this.drawFinishButtons(buttonsEl, ctx, false);
			});
		});
	}

	private drawFinishButtons(buttonsEl: HTMLElement, ctx: ImportProgressUI, enabled: boolean): void {
		if (ctx.log.length > 0) {
			buttonsEl.createEl('button', { cls: 'importer-report-button', text: i18n.modal.buttonSaveReport() }, el => {
				el.disabled = !enabled;
				el.addEventListener('click', () => void this.saveReport(ctx, el));
			});
		}

		buttonsEl.createEl('button', { text: i18n.modal.buttonImportMore() }, el => {
			el.disabled = !enabled;
			el.addEventListener('click', () => this.setUpImporter());
		});
		buttonsEl.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonDone() }, el => {
			el.disabled = !enabled;
			el.addEventListener('click', () => this.close());
		});
	}

	private async saveReport(ctx: ImportProgressUI, buttonEl: HTMLButtonElement): Promise<void> {
		buttonEl.disabled = true;

		try {
			// Reuse a report already saved from this run.
			this.reportFile ??= await this.importer.writeImportReport(ctx, importerName(this.selectedId));

			if (!this.reportFile) {
				new Notice(i18n.modal.msgReportFailed());
				buttonEl.disabled = false;
				return;
			}

			const report = this.reportFile;
			this.close();
			await this.app.workspace.getLeaf(true).openFile(report);
		}
		catch (error) {
			console.error('Could not save the import report', error);
			new Notice(i18n.modal.msgReportFailed());
			buttonEl.disabled = false;
		}
	}

	private showFinished(ctx: ImportProgressUI) {
		const { contentEl } = this;
		contentEl.empty();
		ctx.createProgressUI(contentEl.createDiv());

		this.drawFinishButtons(contentEl.createDiv('modal-button-container'), ctx, true);
	}

	hide() {
		if (this.hidden) return;
		this.hidden = true;
		this.containerEl.hide();

		// The hidden modal must not keep intercepting Escape.
		this.app.keymap.popScope(this.scope);

		this.showHiddenNotice();
	}

	show() {
		if (!this.hidden) return;
		this.hidden = false;
		this.containerEl.show();
		this.app.keymap.pushScope(this.scope);

		this.clearHiddenNotice();
	}

	private showHiddenNotice() {
		this.clearHiddenNotice();

		const remainingEl = createSpan({ cls: 'u-small' });

		const progressEl = createEl('progress');
		progressEl.max = 1;
		progressEl.value = 0;
		const notice = this.hiddenNotice = new Notice(createFragment(frag => {
			frag.createSpan({ text: i18n.progress.labelImporting() });
			frag.createEl('br');
			frag.append(remainingEl);
			frag.append(progressEl);
		}), 0);

		notice.containerEl.addEventListener('click', () => this.show());

		const drawProgress = () => {
			const ctx = this.current;
			if (!ctx) return;

			if (ctx.progressTotal <= 0) {
				remainingEl.setText(ctx.isPaused() ? pausedText(ctx.statusMessage) : statusText(ctx.statusMessage));
				return;
			}

			progressEl.max = ctx.progressTotal;
			progressEl.value = ctx.progressCurrent;

			const remaining = { count: ctx.progressTotal - ctx.progressCurrent };
			remainingEl.setText(ctx.isPaused()
				? i18n.progress.labelPausedRemaining(remaining)
				: i18n.progress.labelRemaining(remaining));
		};

		drawProgress();

		this.hiddenInterval = window.setInterval(() => {
			if (!notice.containerEl.offsetParent) {
				this.clearHiddenInterval();
				return;
			}

			drawProgress();
		}, 300);
	}

	private finishHiddenNotice(ctx: ImportContext) {
		const notice = this.hiddenNotice;
		if (!notice) return;

		this.clearHiddenInterval();

		// The notice is all there is to go on while the modal is hidden, so it has
		// to say which of the three ways the import ended it took.
		const headline = ctx.isCancelled() ? i18n.progress.msgStopped() : outcomeText(ctx);

		const counts = i18n.progress.msgImportedCount({ count: ctx.notes })
			+ (ctx.failed.length > 0 ? `, ${i18n.nouns.failureWithCount({ count: ctx.failed.length })}` : '');

		notice.setMessage(createFragment(frag => {
			frag.createSpan({ text: headline });
			frag.createEl('br');
			frag.createSpan({ cls: 'u-small', text: i18n.progress.msgClickToShow({ counts }) });
		}));
	}

	private clearHiddenInterval() {
		if (this.hiddenInterval !== null) {
			window.clearInterval(this.hiddenInterval);
			this.hiddenInterval = null;
		}
	}

	private clearHiddenNotice() {
		this.clearHiddenInterval();
		this.hiddenNotice?.hide();
		this.hiddenNotice = null;
	}

	private catchBackgroundClick() {
		// Run before Modal's outside-click handler closes the import.
		this.containerEl.addEventListener('click', evt => {
			if (!this.current) return;
			if (evt.target instanceof Node && this.modalEl.contains(evt.target)) return;

			evt.preventDefault();
			evt.stopPropagation();
			this.hide();
		}, { capture: true });
	}

	onOpen() {
		// Anywhere in the window the modal opened on, not just over the modal.
		this.catchFileDrop(this.containerEl.win);
	}

	onEscapeKey(evt: KeyboardEvent) {
		if (evt.defaultPrevented) return;
		evt.preventDefault();
		if (this.current) this.hide();
		else this.close();
	}

	onClose() {
		const { contentEl, current } = this;
		contentEl.empty();
		this.abortController.abort('import was canceled by user');

		this.hideDropOverlay();
		this.forgetFileDrop();

		this.clearHiddenNotice();
		this.hidden = false;
		this.plugin.forgetImporter(this);

		if (current) {
			current.cancel();
		}
	}
}
