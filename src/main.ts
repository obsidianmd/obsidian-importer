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


/**
 * A skip or failure reason as readable text.
 *
 * Callers pass strings, Errors and plain API error objects alike, and String()
 * turns the last of those into "[object Object]".
 */
function describeReason(reason: unknown): string {
	if (typeof reason === 'string') return reason;

	const message = extractErrorMessage(reason);
	if (message !== undefined) return message;

	try {
		return JSON.stringify(reason) ?? String(reason);
	}
	catch {
		// Circular or otherwise unserialisable
		return String(reason);
	}
}

/**
 * A status message as it is shown, which is with an ellipsis: the messages are
 * written as the thing being done rather than as a sentence. One that already
 * ends in a stop keeps the one it has rather than collecting a second.
 */
function statusText(message: string): string {
	const trimmed = message.trim();
	if (!trimmed) return '';

	return trimmed.endsWith('.') ? trimmed : `${trimmed}...`;
}

/**
 * A glyph for a format the help site has no mark for.
 *
 * The rest are drawn by .importer-app-icon.mod-<id> in styles.css, which is the
 * help site's own artwork. These four are file formats rather than apps with a
 * logo, so Lucide says more about them than a mark would.
 */
const FALLBACK_ICONS: Record<string, IconName> = {
	'csv': 'table',
	'html': 'code-2',
	'textbundle': 'package',
	'tomboy': 'sticky-note',
};

/** The same message while the import is held: "Paused - Reading files". */
function pausedText(message: string): string {
	const trimmed = message.trim();
	if (!trimmed) return 'Paused';

	return `Paused - ${trimmed.replace(/\.+$/, '')}`;
}

/** An import reporting into the dialog. */
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

	/**
	 * What the log has said so far, so that drawing the UI again says it again.
	 * The counts survive a redraw in the context itself; the reason a note was
	 * skipped is only ever here.
	 */
	private logEntries: { prefix: string, name: string, reason?: unknown }[] = [];

	/** Whether the status line and progress bar have been hidden for good. */
	private statusHidden: boolean = false;

	constructor(el: HTMLElement) {
		super();
		this.el = el;
		this.createProgressUI(el);
	}

	/**
	 * Creates the import progress UI.
	 *
	 * Draws what the import has done so far rather than an empty screen: it is
	 * called again for the progress screen once the importer has been set up,
	 * and anything reported in between belongs on the screen it lands on.
	 *
	 * @param container The container element to create the UI in
	 */
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

		// Where the import has got to, for a screen drawn after it started
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

	/** Shown on the status line, which is what has stopped changing. */
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

	/**
	 * The auth request last handed to a callback, by the state it carried, so
	 * that the same one arriving twice is recognised rather than reported. Only
	 * the last matters: the repeat follows the first within moments.
	 */
	private handledAuthState: string | undefined;

	/**
	 * The dialog, while one is open. An import keeps running with the dialog
	 * hidden, so opening the importer again has to bring that one back rather
	 * than start a second dialog beside it.
	 */
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

				// The page that redirects back can be reached twice, the second
				// time with an error, because the code it was given has already
				// been used. That is the sign-in just handled arriving again
				// rather than a stale one, and there is nothing to restart.
				if (data['state'] && data['state'] === this.handledAuthState) return;

				new Notice('Unexpected auth event. Please restart the auth process.');
			});

		// For development, un-comment this and tweak it to your importer:

		/*
		// Create and open the importer on boot
		let modal = new ImporterModal(this.app, this);
		modal.open();
		// Select my importer, skipping the format picker
		modal.selectFormat('html');
		if (modal.importer instanceof HtmlImporter) {
			// Automatically pick file
			modal.importer.files = [new NodePickedFile('path/to/test/file.html')];
		}
		*/
	}

	/**
	 * Show the import dialog, which may be one already running behind a notice.
	 */
	openImporter(): ImporterModal {
		if (this.modal) {
			this.modal.show();
			return this.modal;
		}

		const modal = this.modal = new ImporterModal(this.app, this);
		modal.open();
		return modal;
	}

	/** Called by the dialog as it closes, so the next open starts a fresh one. */
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

	/**
	 * Run an import without the dialog, from a script or a test.
	 *
	 * The dialog is what usually gathers this: which format, which files, where
	 * they go, and the settings in between. Here the caller says so directly -
	 * `configure` receives the importer with its defaults in place, and
	 * whatever it sets is what the import runs with.
	 *
	 * Desktop only: the files are read from paths.
	 */
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
			optionsEl: null,
			plugin: this,
			importerId,
			abortController: new AbortController(),
		};

		const importer = new definition.importer(this.app, host);

		// Whatever init() started - a credential, a restored session - has to
		// have arrived before the import reads it
		await importer.ready;

		if (importer.notAvailable) {
			throw new Error(`The ${definition.name} importer is not available here.`);
		}

		// The dialog gathers this from a second screen, which a script has no
		// way to answer, so an importer that needs one cannot run headless yet
		if (importer.showTemplateConfiguration !== FormatImporter.prototype.showTemplateConfiguration) {
			throw new Error(`The ${definition.name} importer is configured on a second screen, which an import without the dialog cannot show yet.`);
		}

		importer.files = filepaths.map(filepath => new NodePickedFile(filepath));
		importer.outputLocation = outputLocation;
		configure?.(importer);

		const ctx = new ImportContext();
		await importer.import(ctx);
		return ctx;
	}
}

/** The dialog is one importer host; see ImporterHost. */
export class ImporterModal extends Modal implements ImporterHost {
	plugin: ImporterPlugin;
	importer: FormatImporter;
	selectedId: string;
	abortController: AbortController;

	/**
	 * The two setup screens, drawn when the importer is built and shown one at
	 * a time. Off screen until then, and again once the import starts.
	 */
	sourceEl: HTMLElement | null = null;
	optionsEl: HTMLElement | null = null;

	/** Next, while the source step is the one showing. See sourceChanged. */
	private nextButtonEl: HTMLButtonElement | null = null;

	/** Which importer the dialog is showing, which is the one being hosted. */
	get importerId(): string {
		return this.selectedId;
	}

	current: ImportContext | null = null;

	/** Off screen but still open, with an import still running in it. */
	private hidden: boolean = false;
	/** The notice standing in for the dialog while hidden, so it can be taken back. */
	private hiddenNotice: Notice | null = null;
	/** Ticks the notice's progress bar while the dialog is hidden. */
	private hiddenInterval: number | null = null;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app);
		this.plugin = plugin;
		this.modalEl.addClass('mod-importer');
		this.abortController = new AbortController();
		this.catchBackgroundClick();

		this.showFormatPicker();
	}

	/**
	 * The first screen: which app the notes are coming from.
	 *
	 * There is no component for a filtered list - SuggestModal is one, but it is
	 * a modal of its own, and this is a step in this one - so it is built the way
	 * the app builds the same screen in its settings: a SearchComponent in a
	 * .setting-group-search above .setting-items of rows. Hotkeys and the
	 * keychain are those three elements, so the app styles this list too.
	 */
	showFormatPicker() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('is-picking-format');
		this.titleEl.setText('Import data into Obsidian');

		const groupEl = contentEl.createDiv('setting-group mod-list');
		const searchEl = groupEl.createDiv('setting-group-search');
		const itemsEl = groupEl.createDiv('setting-items');

		/** The rows as drawn, in order, for the arrow keys to walk. */
		let rows: HTMLElement[] = [];

		/** Focus by position in the list, where anything above it is the filter. */
		const focusRow = (index: number) => {
			if (index < 0 || rows.length === 0) search.inputEl.focus();
			else rows[Math.min(index, rows.length - 1)].focus();
		};

		const draw = (query: string) => {
			itemsEl.empty();
			rows = [];

			for (const [id, match] of this.searchFormats(query)) {
				const definition = this.plugin.importers[id];

				// Just the name: what to do before importing is on the step that
				// asks for the files, which is where there is something to do
				const setting = new Setting(itemsEl)
					// The app's own "row that leads somewhere" - see mobile settings
					.setClass('mod-navigable')
					.setName(createFragment(frag => {
						// The part of the name that was typed, marked as the app marks it
						if (match) renderMatches(frag, definition.optionText, match.matches);
						else frag.appendText(definition.optionText);
					}));

				// The app it comes from, in the slot the app's own settings rows
				// keep an icon in - which is before the name, so it is prepended
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

					// Escape still belongs to the dialog; these keys do not
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
			// Enter takes the best match, the way it does in a suggester
			if (evt.key !== 'ArrowDown' && evt.key !== 'Enter') return;
			evt.preventDefault();

			if (evt.key === 'Enter') rows[0]?.click();
			else focusRow(0);
		});

		draw('');
		search.inputEl.focus();
	}

	/**
	 * The formats a query matches, best first, each with what it matched on.
	 *
	 * Matched against the option text, which is what the row shows and so what
	 * the highlight can be drawn against, and against the name as well - "HTML
	 * files" is a name and "HTML (.html)" is the option text.
	 */
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

			// A match on either puts the row in the list; only one on the text
			// being drawn can be marked up in it
			const best = Math.max(match?.score ?? -Infinity, byName?.score ?? -Infinity);
			if (best === -Infinity) continue;

			results.push({ id, match, score: best });
		}

		results.sort((a, b) => b.score - a.score);
		return results.map(({ id, match }) => [id, match]);
	}

	/** Leave the picker for the chosen format's first setup step. */
	selectFormat(id: string) {
		if (!Object.prototype.hasOwnProperty.call(this.plugin.importers, id)) return;

		// Coming back to the format the dialog is already set up for keeps that
		// setup: the files chosen, the account signed in to, the tree loaded
		// from it. A sign-in the user stepped away from while waiting for the
		// browser lands on the importer that started it, which is this one.
		if (id === this.selectedId && this.importer) {
			this.showFirstStep();
			return;
		}

		this.selectedId = id;
		this.setUpImporter();
	}

	/**
	 * Build the chosen importer and show the first step it asks for.
	 *
	 * Its two screens are drawn once, here, and moved in and out of the dialog
	 * as the user steps back and forth: building it again would forget the files
	 * that were picked, the account that was signed in to, and the tree that was
	 * loaded from it.
	 */
	private setUpImporter() {
		const definition = this.plugin.importers[this.selectedId];

		// Held off screen until the step that shows them
		this.sourceEl = createDiv();
		this.optionsEl = createDiv();

		this.importer = new definition.importer(this.app, this);

		this.showFirstStep();
	}

	/** The step a format opens on, which is not always the source one. */
	private showFirstStep() {
		if (this.hasSourceStep()) this.showSourceStep();
		else this.showOptionsStep();
	}

	/**
	 * Whether this importer asks where the notes come from. Every one of them
	 * does - files to pick, an account to sign in to, a folder to be let into -
	 * except one that cannot run here at all, whose only screen is the options
	 * one, because that is where it says so.
	 */
	private hasSourceStep(): boolean {
		return !this.importer.notAvailable;
	}

	/** The second screen: the files to import, or the account they come from. */
	showSourceStep() {
		this.drawStep(this.sourceEl, () => this.showFormatPicker(), el => {
			this.nextButtonEl = el.createEl('button', { cls: 'mod-cta', text: 'Continue' }, el => {
				el.addEventListener('click', () => this.showOptionsStep());
			});

			// Nothing to go on to until the question on this screen is answered
			this.sourceChanged();
		});
	}

	/**
	 * See ImporterHost: what the source step was waiting for may have arrived.
	 * Asked again rather than told what changed, since only the answer matters.
	 */
	sourceChanged(): void {
		if (this.nextButtonEl) this.nextButtonEl.disabled = !this.importer.sourceReady;
	}

	/** The third screen: how to import it, and the button that starts. */
	showOptionsStep() {
		const { importer } = this;
		const hasSource = this.hasSourceStep();

		this.drawStep(this.optionsEl, () => hasSource ? this.showSourceStep() : this.showFormatPicker(), el => {
			// Hide the import button if it's not available. The actual message to
			// display is handled by the importer, since it depends on what is
			// being imported - but the way back is still needed either way.
			if (!hasSource) return;

			el.createEl('button', { cls: 'mod-cta', text: 'Import' }, el => {
				// A listener cannot be awaited, so the run is kicked off here and
				// anything that escapes its own try/finally is logged rather than
				// surfacing as an unhandled rejection.
				el.addEventListener('click', () => void this.startImport(importer)
					.catch(e => console.error('Import failed', e)));
			});
		});
	}

	/**
	 * A setup screen: what the importer drew for that step, under the format it
	 * is for, over the buttons that leave it.
	 *
	 * The ways off this screen that are not onward - back, and out to the help
	 * page - are on the left; buildButtons adds the one that goes on, which the
	 * button row pushes to the right.
	 */
	private drawStep(stepEl: HTMLElement | null, onBack: () => void, buildButtons: (buttonsEl: HTMLElement) => void) {
		const { contentEl, modalEl } = this;
		const definition = this.plugin.importers[this.selectedId];

		contentEl.empty();
		this.nextButtonEl = null;
		modalEl.removeClass('is-picking-format');
		this.titleEl.setText(`Import from ${definition.name}`);

		// Put back, with everything the importer has done to it since
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

	/** Run the import the setup screen has been filled in for. */
	private async startImport(importer: FormatImporter) {
		if (this.current) {
			this.current.cancel();
		}

		const { contentEl } = this;

		// Clear content
		contentEl.empty();
		let configEl = contentEl.createDiv();
		let ctx = this.current = new ImportProgressUI(configEl);

		// Check if importer needs template configuration
		const templateResult = await importer.showTemplateConfiguration(ctx, configEl);

		if (templateResult === false) {
			// User cancelled or preparation failed. Back to the screen Import was
			// pressed on, with what was filled in on it still there.
			this.current = null;
			this.showOptionsStep();
			return;
		}

		this.showProgress(ctx, importer.interruption);
		try {
			await importer.import(ctx);
		}
		finally {
			if (this.current === ctx) {
				this.current = null;
			}
			ctx.hideStatus();

			const reported = ctx.notes + ctx.attachments + ctx.skipped.length + ctx.failed.length; // did anything happen?
			if (importer.interruption !== 'none' && ctx.checkpoints === 0 && reported > 0) {
				// Not constructor.name, which the release build mangles
				const name = this.plugin.importers[this.selectedId]?.name ?? this.selectedId;
				console.warn(
					`The ${name} importer offers ${importer.interruption} but never awaited ` +
					`ctx.shouldStop(), so neither button could have done anything`
				);
			}

			// Nobody is looking at the dialog, so the result has to come to them
			if (this.hidden) {
				this.finishHiddenNotice(ctx);
			}

			this.showFinished(ctx);
		}
	}

	/**
	 * The screen an import runs on: how far it has got, and Stop.
	 *
	 * Drawn from the context rather than added to as the import goes, so that
	 * the screen can be drawn whenever there is somewhere to draw it.
	 */
	private showProgress(ctx: ImportProgressUI, interruption: FormatImporter['interruption']) {
		const { contentEl } = this;
		contentEl.empty();
		ctx.createProgressUI(contentEl.createDiv());

		// Stop has already been pressed: nothing left to stop
		if (ctx.isCancelled()) return;

		// A button this import would not honour is worse than no button
		if (interruption === 'none') return;

		let buttonsEl = contentEl.createDiv('modal-button-container');

		let pauseButtonEl: HTMLElement | null = null;
		if (interruption === 'pause') {
			// Labelled Resume when the screen is drawn onto a paused import
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

	/** The screen an import leaves behind: what it did, and where to go next. */
	private showFinished(ctx: ImportProgressUI) {
		const { contentEl } = this;
		contentEl.empty();
		ctx.createProgressUI(contentEl.createDiv());

		let buttonsEl = contentEl.createDiv('modal-button-container');
		// A fresh importer: the last one has run, and its files are imported
		buttonsEl.createEl('button', { text: 'Import more' }, el => {
			el.addEventListener('click', () => this.setUpImporter());
		});
		buttonsEl.createEl('button', { cls: 'mod-cta', text: 'Done' }, el => {
			el.addEventListener('click', () => this.close());
		});
	}

	/**
	 * Take the dialog off screen, leaving the import running.
	 *
	 * Closing cancels the import, so the ways a dialog gets dismissed by
	 * accident - a click on the background, a stray Escape - hide it instead
	 * while there is something to lose. Stop is the button that cancels.
	 */
	hide() {
		if (this.hidden) return;
		this.hidden = true;
		this.containerEl.hide();

		// The modal is still open as far as Obsidian is concerned, so its scope
		// is still on the keymap and would swallow Escape everywhere else.
		this.app.keymap.popScope(this.scope);

		this.showHiddenNotice();
	}

	/** Put a hidden dialog back on screen, where the import left it. */
	show() {
		if (!this.hidden) return;
		this.hidden = false;
		this.containerEl.show();
		this.app.keymap.pushScope(this.scope);

		this.clearHiddenNotice();
	}

	/**
	 * A notice standing in for the hidden dialog.
	 *
	 * Shaped like the one the app shows while it indexes a vault: what is
	 * happening, a quieter line under it, and a progress bar that keeps moving,
	 * so it reads as work in hand rather than as a message to dismiss.
	 *
	 * Clicking it brings the dialog back. A notice is dismissed by a click
	 * anyway, so that is the same gesture rather than a second one.
	 */
	private showHiddenNotice() {
		this.clearHiddenNotice();

		// Left empty until there is a count to put in it, which is also where an
		// importer that reports no progress leaves it
		const remainingEl = createSpan({ cls: 'u-small' });

		// Started empty rather than valueless. The app styles .notice progress
		// on [value], so a bar with no value at all skips that rule and is
		// drawn by the browser as an indeterminate one - a flat grey block that
		// reads as broken. An importer yet to report progress gets an empty bar
		// instead, and one that never reports keeps it.
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

			// Before there is anything to count - fetching, planning - say what
			// the importer says it is doing, which is what the dialog shows too
			if (ctx.progressTotal <= 0) {
				remainingEl.setText(ctx.isPaused() ? pausedText(ctx.statusMessage) : statusText(ctx.statusMessage));
				return;
			}

			progressEl.max = ctx.progressTotal;
			progressEl.value = ctx.progressCurrent;

			// A count that has stopped moving says why: nothing else here does
			remainingEl.setText(ctx.isPaused()
				? `Paused - ${ctx.progressTotal - ctx.progressCurrent} remaining`
				: `${ctx.progressTotal - ctx.progressCurrent} remaining...`);
		};

		// Drawn before the notice goes up as well as on the timer, so it does
		// not spend its first tick looking like it has not started
		drawProgress();

		this.hiddenInterval = window.setInterval(() => {
			if (!notice.containerEl.offsetParent) {
				this.clearHiddenInterval();
				return;
			}

			drawProgress();
		}, 300);
	}

	/** Turn the notice into what it has to say once the import has finished. */
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

	/**
	 * Catch a click on the background before the dialog closes on it.
	 *
	 * Modal offers onClickOutside, but only wires it up off macOS: there the
	 * background click goes straight to close(), to leave room for a check
	 * that the pointer did not move. So neither hook is reliable, and this
	 * listens on the container in the capture phase instead, which runs before
	 * either of them on every platform.
	 */
	private catchBackgroundClick() {
		this.containerEl.addEventListener('click', evt => {
			if (!this.current) return;
			// A click that landed in the dialog is not a click outside it
			if (evt.target instanceof Node && this.modalEl.contains(evt.target)) return;

			evt.preventDefault();
			evt.stopPropagation();
			this.hide();
		}, { capture: true });
	}

	/**
	 * Not declared on Modal in obsidian.d.ts, so as far as the compiler is
	 * concerned this adds a method rather than overrides one. It does override
	 * at runtime: Modal's constructor registers this.onEscapeKey against its
	 * scope, which resolves through the prototype.
	 */
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
