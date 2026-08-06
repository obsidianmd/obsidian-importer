import { App, Modal, Notice, Platform, Plugin, Setting } from 'obsidian';
import { FormatImporter, ImporterHost } from './format-importer';
import { NodePickedFile } from './filesystem';
import { AuthCallback } from './constants';
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
	formatDescription?: string;
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
		if (this.statusMessage) this.onStatus(this.statusMessage);
		if (this.progressTotal > 0) this.onProgress(this.progressCurrent, this.progressTotal);
		for (const entry of this.logEntries) {
			this.drawLogEntry(entry);
		}
		if (this.statusHidden) this.onHideStatus();
	}

	protected onStatus(message: string): void {
		this.statusEl.setText(statusText(message));
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
				formatDescription: 'Import your Journal app entries to Obsidian',
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
				formatDescription: 'Export your Notion workspace to HTML format.',
			},
			'roam-json': {
				name: 'Roam Research',
				optionText: 'Roam Research (.json)',
				importer: RoamJSONImporter,
				helpPermalink: 'import/roam',
				formatDescription: 'Export your Roam Research workspace to JSON format.',
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
					this.authCallback(data);
					this.authCallback = undefined;
					return;
				}

				new Notice('Unexpected auth event. Please restart the auth process.');
			});

		// For development, un-comment this and tweak it to your importer:

		/*
		// Create and open the importer on boot
		let modal = new ImporterModal(this.app, this);
		modal.open();
		// Select my importer
		modal.updateContent('html');
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
			contentEl: null,
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
		this.titleEl.setText('Import data into Obsidian');
		this.modalEl.addClass('mod-importer');
		this.abortController = new AbortController();
		this.catchBackgroundClick();

		let keys = Object.keys(plugin.importers);
		if (keys.length > 0) {
			this.selectedId = keys[0];
			this.updateContent();
		}
	}

	updateContent() {
		const { contentEl, selectedId } = this;
		let importers = this.plugin.importers;
		let selectedImporter = importers[selectedId];
		contentEl.empty();

		let descriptionFragment = new DocumentFragment();
		descriptionFragment.createSpan({ text: 'The format to be imported.' });
		if (selectedImporter.formatDescription) {
			descriptionFragment.createEl('br');
			descriptionFragment.createSpan({ text: selectedImporter.formatDescription });
		}
		if (selectedImporter.helpPermalink) {
			descriptionFragment.createEl('br');
			descriptionFragment.createEl('a', {
				text: `Learn more about importing from ${selectedImporter.name}.`,
				href: `https://help.obsidian.md/${selectedImporter.helpPermalink}`,
			});
		}

		new Setting(contentEl)
			.setName('File format')
			.setDesc(descriptionFragment)
			.addDropdown(dropdown => {
				for (let id in importers) {
					if (Object.prototype.hasOwnProperty.call(importers, id)) {
						dropdown.addOption(id, importers[id].optionText);
					}
				}
				dropdown.onChange((value) => {
					if (Object.prototype.hasOwnProperty.call(importers, value)) {
						this.selectedId = value;
						this.updateContent();
					}
				});
				dropdown.setValue(this.selectedId);
			});

		if (selectedId && Object.prototype.hasOwnProperty.call(importers, selectedId)) {
			let importer = this.importer = new selectedImporter.importer(this.app, this);

			//Hide the import buttons if it's not available.
			//The actual message to display is handled by the importer, since it depends on what is being imported.
			if (importer.notAvailable) return;

			contentEl.createDiv('modal-button-container', el => {
				el.createEl('button', { cls: 'mod-cta', text: 'Import' }, el => {
					// A listener cannot be awaited, so the run is kicked off here and
					// anything that escapes its own try/finally is logged rather than
					// surfacing as an unhandled rejection.
					el.addEventListener('click', () => void this.startImport(importer)
						.catch(e => console.error('Import failed', e)));
				});
			});
		}
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
			// User cancelled or preparation failed
			this.current = null;
			this.updateContent();
			return;
		}

		this.showProgress(ctx);
		try {
			await importer.import(ctx);
		}
		finally {
			if (this.current === ctx) {
				this.current = null;
			}
			ctx.hideStatus();

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
	private showProgress(ctx: ImportProgressUI) {
		const { contentEl } = this;
		contentEl.empty();
		ctx.createProgressUI(contentEl.createDiv());

		// Stop has already been pressed: nothing left to stop
		if (ctx.isCancelled()) return;

		let buttonsEl = contentEl.createDiv('modal-button-container');
		let cancelButtonEl = buttonsEl.createEl('button', { cls: 'mod-danger', text: 'Stop' }, el => {
			el.addEventListener('click', () => {
				ctx.cancel();
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
		buttonsEl.createEl('button', { text: 'Import more' }, el => {
			el.addEventListener('click', () => this.updateContent());
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
				remainingEl.setText(statusText(ctx.statusMessage));
				return;
			}

			progressEl.max = ctx.progressTotal;
			progressEl.value = ctx.progressCurrent;
			remainingEl.setText(`${ctx.progressTotal - ctx.progressCurrent} remaining...`);
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
