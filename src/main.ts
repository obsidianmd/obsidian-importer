import { App, IconName, Modal, Notice, Platform, Plugin, prepareFuzzySearch, renderMatches, SearchComponent, SearchResult, Setting, setIcon } from 'obsidian';
import { FormatImporter, ImporterHost } from './format-importer';
import { NodePickedFile } from './filesystem';
import { AuthCallback, helpUrl } from './constants';
import { ImportContext } from './import-context';
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
import { RoamJSONImporter } from './formats/roam-json';
import { TextbundleImporter } from './formats/textbundle';
import { TomboyImporter } from './formats/tomboy';
import { extractErrorMessage, plural, truncateText } from './util';

declare global {
	interface Window {
		electron: any;
		require: NodeJS.Require;
	}
}

interface ImporterDefinition {
	name: string;
	optionText: string;
	helpPermalink?: string;
	importer: new (app: App, host: ImporterHost) => FormatImporter;
}


function describeReason(reason: unknown): string {
	if (typeof reason === 'string') return reason;

	const message = extractErrorMessage(reason);
	if (message !== undefined) return message;

	try {
		return JSON.stringify(reason) ?? String(reason);
	}
	catch {
		return String(reason);
	}
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
	if (!trimmed) return 'Paused';

	return `Paused - ${trimmed.replace(/\.+$/, '')}`;
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

	private logEntries: { prefix: string, name: string, reason?: unknown }[] = [];

	private statusHidden: boolean = false;

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
				el.createDiv({ cls: 'importer-stat-name', text: 'imported' });
			});
			el.createDiv('importer-stat mod-attachments', el => {
				this.attachmentCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.attachments.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: 'attachments' });
			});
			el.createDiv('importer-stat mod-remaining', el => {
				this.remainingCountEl = el.createDiv({ cls: 'importer-stat-count', text: '0' });
				el.createDiv({ cls: 'importer-stat-name', text: 'remaining' });
			});
			el.createDiv('importer-stat mod-skipped', el => {
				this.skippedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.skipped.length.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: 'skipped' });
			});
			el.createDiv('importer-stat mod-failed', el => {
				this.failedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.failed.length.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: 'failed' });
			});
		});

		this.importLogEl = container.createDiv('importer-log');
		this.importLogEl.hide();

		if (this.isPaused()) this.onPaused(true);
		else if (this.statusMessage) this.onStatus(this.statusMessage);
		if (this.progressTotal > 0) this.onProgress(this.progressCurrent, this.progressTotal);
		for (const entry of this.logEntries) {
			this.drawLogEntry(entry);
		}
		if (this.statusHidden) this.onHideStatus();
	}

	protected onStatus(message: string): void {
		this.statusEl.setText(this.isPaused() ? pausedText(message) : statusText(message));
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

	protected onSkipped(name: string, reason?: unknown): void {
		this.skippedCountEl.setText(this.skipped.length.toString());
		this.log('Skipped: ', name, reason);
	}

	protected onFailed(name: string, reason?: unknown): void {
		this.failedCountEl.setText(this.failed.length.toString());
		this.log('Failed: ', name, reason);
	}

	protected onProgress(current: number, total: number): void {
		this.remainingCountEl.setText((total - current).toString());
		this.importedCountEl.setText(current.toString());
		this.progressBarInnerEl.style.width = (100 * current / total).toFixed(1) + '%';
	}

	protected onHideStatus(): void {
		this.statusHidden = true;
		this.progressBarEl.hide();
		this.statusEl.hide();
	}

	private log(prefix: string, name: string, reason?: unknown): void {
		const entry = { prefix, name, reason };
		this.logEntries.push(entry);
		this.drawLogEntry(entry);
	}

	private drawLogEntry({ prefix, name, reason }: { prefix: string, name: string, reason?: unknown }): void {
		const { importLogEl } = this;

		importLogEl.createDiv('list-item', el => {
			el.createSpan({ cls: 'importer-error', text: prefix });
			el.createSpan({ text: `"${truncateText(name, this.maxFileNameLength)}"` + (reason ? ` because ${truncateText(describeReason(reason), this.maxFileNameLength)}` : '') });
		});

		importLogEl.scrollTop = importLogEl.scrollHeight;
		importLogEl.show();
	}
}

export default class ImporterPlugin extends Plugin {
	importers: Record<string, ImporterDefinition>;

	authCallback: AuthCallback | undefined;

	private handledAuthState: string | undefined;

	private modal: ImporterModal | null = null;

	async onload() {
		this.importers = {
			'airtable-api': {
				name: 'Airtable',
				optionText: 'Airtable',
				importer: AirtableAPIImporter,
				helpPermalink: 'import/airtable',
			},
			'apple-notes': {
				name: 'Apple Notes',
				optionText: 'Apple Notes',
				importer: AppleNotesImporter,
				helpPermalink: 'import/apple-notes'
			},
			'apple-journal': {
				name: 'Apple Journal',
				optionText: 'Apple Journal (HTML export)',
				importer: AppleJournalImporter,
			},
			'bear': {
				name: 'Bear',
				optionText: 'Bear (.bear2bk)',
				importer: Bear2bkImporter,
				helpPermalink: 'import/bear',
			},
			'csv': {
				name: 'CSV',
				optionText: 'CSV (.csv)',
				importer: CSVImporter,
				helpPermalink: 'import/csv',
			},
			'evernote': {
				name: 'Evernote',
				optionText: 'Evernote (.enex)',
				importer: EvernoteEnexImporter,
				helpPermalink: 'import/evernote',
			},
			'keep': {
				name: 'Google Keep',
				optionText: 'Google Keep (.zip/.json)',
				importer: KeepImporter,
				helpPermalink: 'import/google-keep',
			},
			'html': {
				name: 'HTML files',
				optionText: 'HTML (.html)',
				importer: HtmlImporter,
				helpPermalink: 'import/html',
			},
			'onenote': {
				name: 'Microsoft OneNote',
				optionText: 'Microsoft OneNote',
				importer: OneNoteImporter,
				helpPermalink: 'import/onenote',
			},
			'notion-api': {
				name: 'Notion (API)',
				optionText: 'Notion (API)',
				importer: NotionAPIImporter,
				helpPermalink: 'import/notion',
			},
			'notion': {
				name: 'Notion',
				optionText: 'Notion (.zip)',
				importer: NotionImporter,
				helpPermalink: 'import/notion',
			},
			'roam-json': {
				name: 'Roam Research',
				optionText: 'Roam Research (.json)',
				importer: RoamJSONImporter,
				helpPermalink: 'import/roam',
			},
			'textbundle': {
				name: 'Textbundle files',
				optionText: 'Textbundle (.textbundle, .textpack)',
				importer: TextbundleImporter,
				helpPermalink: 'import/textbundle',
			},
			'tomboy': {
				name: 'Tomboy/Gnote',
				optionText: 'Tomboy/Gnote (.note)',
				importer: TomboyImporter,
			},
		};

		this.addRibbonIcon('lucide-import', 'Import notes', () => {
			this.openImporter();
		});

		this.addCommand({
			id: 'open-modal',
			name: 'Import notes',
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

				new Notice('Unexpected auth event. Please restart the auth process.');
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
			throw new Error(`The ${definition.name} importer is not available here.`);
		}

		if (importer.showTemplateConfiguration !== FormatImporter.prototype.showTemplateConfiguration) {
			throw new Error(`The ${definition.name} importer is configured on a second screen, which an import without the dialog cannot show yet.`);
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

	get importerId(): string {
		return this.selectedId;
	}

	current: ImportContext | null = null;

	private hidden: boolean = false;
	private hiddenNotice: Notice | null = null;
	private hiddenInterval: number | null = null;

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
		modalEl.addClass('is-picking-format');
		this.titleEl.setText('Import data into Obsidian');

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
				const definition = this.plugin.importers[id];

				const setting = new Setting(itemsEl)
					.setClass('mod-navigable')
					.setName(createFragment(frag => {
						if (match) renderMatches(frag, definition.optionText, match.matches);
						else frag.appendText(definition.optionText);
					}));

				const iconEl = createDiv(`setting-item-icon importer-app-icon mod-${id}`);
				if (FALLBACK_ICONS[id]) setIcon(iconEl, FALLBACK_ICONS[id]);
				setting.settingEl.prepend(iconEl);

				setIcon(setting.controlEl.createSpan('importer-format-chevron'), 'lucide-chevron-right');

				const { settingEl } = setting;
				const index = rows.length;
				settingEl.tabIndex = 0;
				settingEl.addEventListener('click', () => this.selectFormat(id));
				settingEl.addEventListener('keydown', evt => {
					switch (evt.key) {
						case 'Enter':
						case ' ':
							this.selectFormat(id);
							break;
						case 'ArrowDown':
							focusRow(index + 1);
							break;
						case 'ArrowUp':
							focusRow(index - 1);
							break;
						default:
							return;
					}

					evt.preventDefault();
				});

				rows.push(settingEl);
			}

			if (rows.length === 0) {
				new Setting(itemsEl).setClass('mod-empty-state').setName('No formats found.');
			}
		};

		const search = new SearchComponent(searchEl)
			.setPlaceholder('Filter...')
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

	private searchFormats(query: string): [string, SearchResult | null][] {
		const importers = this.plugin.importers;
		const ids = Object.keys(importers);

		if (!query) return ids.map(id => [id, null]);

		const search = prepareFuzzySearch(query);
		const results: { id: string, match: SearchResult | null, score: number }[] = [];

		for (const id of ids) {
			const definition = importers[id];
			const match = search(definition.optionText);
			const byName = search(definition.name);

			const best = Math.max(match?.score ?? -Infinity, byName?.score ?? -Infinity);
			if (best === -Infinity) continue;

			results.push({ id, match, score: best });
		}

		results.sort((a, b) => b.score - a.score);
		return results.map(({ id, match }) => [id, match]);
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
			this.drawStep(this.optionsEl, () => this.showFormatPicker(), () => {});
			return;
		}

		this.showSourceStep();
	}

	private hasOptionsStep(): boolean {
		return (this.optionsEl?.childElementCount ?? 0) > 0;
	}

	showSourceStep() {
		this.drawStep(this.sourceEl, () => this.showFormatPicker(), el => {
			this.nextButtonEl = el.createEl('button', { cls: 'mod-cta', text: 'Continue' }, el => {
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
				el.createEl('button', { cls: 'mod-cta', text: 'Continue' }, el => {
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
		buttonsEl.createEl('button', { cls: 'mod-cta', text: 'Import' }, el => {
			el.addEventListener('click', () => void this.startImport(importer)
				.catch(e => console.error('Import failed', e)));
		});
	}

	private drawStep(stepEl: HTMLElement | null, onBack: () => void, buildButtons: (buttonsEl: HTMLElement) => void) {
		const { contentEl, modalEl } = this;
		const definition = this.plugin.importers[this.selectedId];

		contentEl.empty();
		this.nextButtonEl = null;
		modalEl.removeClass('is-picking-format');
		this.titleEl.setText(`Import from ${definition.name}`);

		if (stepEl) contentEl.append(stepEl);

		contentEl.createDiv('modal-button-container importer-step-buttons', el => {
			el.createEl('button', { text: 'Back' }, el => {
				el.addEventListener('click', onBack);
			});

			if (definition.helpPermalink) {
				const permalink = definition.helpPermalink;
				el.createEl('button', { text: 'Help' }, el => {
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
		try {
			importer.indexImportedNotes();
			await importer.import(ctx);
		}
		finally {
			await importer.finalizeMarkdownOutput(ctx);
			if (this.current === ctx) {
				this.current = null;
			}
			ctx.hideStatus();

			const reported = ctx.notes + ctx.attachments + ctx.skipped.length + ctx.failed.length;
			if (importer.interruption !== 'none' && ctx.checkpoints === 0 && reported > 0) {
				const name = this.plugin.importers[this.selectedId]?.name ?? this.selectedId;
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
			let button = buttonsEl.createEl('button', { text: ctx.isPaused() ? 'Resume' : 'Pause' }, el => {
				el.addEventListener('click', () => {
					if (ctx.isPaused()) ctx.resume();
					else ctx.pause();

					button.setText(ctx.isPaused() ? 'Resume' : 'Pause');
				});
			});
			pauseButtonEl = button;
		}

		let cancelButtonEl = buttonsEl.createEl('button', { cls: 'mod-danger', text: 'Stop' }, el => {
			el.addEventListener('click', () => {
				ctx.cancel();
				pauseButtonEl?.detach();
				cancelButtonEl.detach();
			});
		});
	}

	private showFinished(ctx: ImportProgressUI) {
		const { contentEl } = this;
		contentEl.empty();
		ctx.createProgressUI(contentEl.createDiv());

		let buttonsEl = contentEl.createDiv('modal-button-container');
		buttonsEl.createEl('button', { text: 'Import more' }, el => {
			el.addEventListener('click', () => this.setUpImporter());
		});
		buttonsEl.createEl('button', { cls: 'mod-cta', text: 'Done' }, el => {
			el.addEventListener('click', () => this.close());
		});
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
			frag.createSpan({ text: 'Importing' });
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

			remainingEl.setText(ctx.isPaused()
				? `Paused - ${ctx.progressTotal - ctx.progressCurrent} remaining`
				: `${ctx.progressTotal - ctx.progressCurrent} remaining...`);
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

		notice.setMessage(createFragment(frag => {
			frag.createSpan({ text: 'Import complete.' });
			frag.createEl('br');
			frag.createSpan({ cls: 'u-small', text: `${plural(ctx.notes, 'note')} imported. Click to show.` });
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

		this.clearHiddenNotice();
		this.hidden = false;
		this.plugin.forgetImporter(this);

		if (current) {
			current.cancel();
		}
	}
}
