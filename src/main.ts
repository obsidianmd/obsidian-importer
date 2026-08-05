import { App, Modal, Notice, ObsidianProtocolData, Platform, Plugin, Setting } from 'obsidian';
import { FormatImporter, ImporterHost } from './format-importer';
import { NodePickedFile } from './filesystem';
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
import { extractErrorMessage, truncateText } from './util';

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
 * URI to use as the callback for OAuth applications.
 */
export const AUTH_REDIRECT_URI: string = 'obsidian://importer-auth/';

/**
 * List of accepted attachment extensions
 */
export const ATTACHMENT_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mpg', 'm4a', 'webm', 'wav', 'ogv', '3gp', 'mov', 'mp4', 'mkv', 'pdf'];

/**
 * AuthCallback is a function which will be called when the importer-auth
 * protocal is opened by an OAuth callback.
 */
export type AuthCallback = (data: ObsidianProtocolData) => void;

// Temporary compatibility for in progress PRs
export type ProgressReporter = ImportContext;

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
 * What an import reports as it runs: what it wrote, what it skipped, and how
 * far along it is.
 *
 * This holds the counts and nothing else. Showing them is ImportProgressUI's,
 * which is what the dialog uses - an import driven from a script or a test
 * reports into this and draws nothing.
 */
export class ImportContext {
	notes = 0;
	attachments = 0;
	skipped: string[] = [];
	failed: string[] = [];
	maxFileNameLength: number = 100;
	statusMessage: string = '';

	cancelled: boolean = false;

	/**
	 * Sets the current user visible in-progress task. The purpose is to tell the user that something is happening,
	 * and makes it easy to tell if something got stuck.
	 *
	 * Try to keep the message short, since longer ones will get truncated based on font and space availability.
	 * @param message
	 */
	status(message: string) {
		this.statusMessage = message;
		this.onStatus(message);
	}

	/**
	 * Report that a note has been successfully imported.
	 * @param name
	 */
	reportNoteSuccess(name: string) {
		this.notes++;
		this.onNoteSuccess(name);
	}

	/**
	 * Report that an attachment has been successfully imported.
	 * @param name
	 */
	reportAttachmentSuccess(name: string) {
		this.attachments++;
		this.onAttachmentSuccess(name);
	}

	/**
	 * Report that something has been skipped and ignored.
	 * If the skipping action is on purpose and expected for the import, then prefer not to report it
	 * (for example, some tools export to a Note.json and a Note.html, and we only use one of them).
	 * @param name
	 * @param reason
	 */
	reportSkipped(name: string, reason?: unknown) {
		this.skipped.push(name);
		this.onSkipped(name, reason);
	}

	/**
	 * Report that something has failed to import.
	 * @param name
	 * @param reason
	 */
	reportFailed(name: string, reason?: unknown) {
		this.failed.push(name);
		console.error('Import failed', name, reason);
		this.onFailed(name, reason);
	}

	/**
	 * Report the current progress. This will update the progress bar as well as changing
	 * the "imported" and "remaining" numbers on the UI.
	 * @param current
	 * @param total
	 */
	reportProgress(current: number, total: number) {
		if (total <= 0) return;
		this.onProgress(current, total);
	}

	cancel() {
		this.cancelled = true;
		this.hideStatus();
	}

	hideStatus() {
		this.onHideStatus();
	}

	/**
	 * Check if the user has cancelled this run.
	 */
	isCancelled() {
		return this.cancelled;
	}

	/* Where a subclass draws what the import is doing. Nothing here does. */
	protected onStatus(message: string): void {}
	protected onNoteSuccess(name: string): void {}
	protected onAttachmentSuccess(name: string): void {}
	protected onSkipped(name: string, reason?: unknown): void {}
	protected onFailed(name: string, reason?: unknown): void {}
	protected onProgress(current: number, total: number): void {}
	protected onHideStatus(): void {}
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

	constructor(el: HTMLElement) {
		super();
		this.el = el;
		this.createProgressUI(el);
	}

	/**
	 * Creates the import progress UI.
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
	}

	protected onStatus(message: string): void {
		this.statusEl.setText(message.trim() + '...');
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
		this.progressBarEl.hide();
		this.statusEl.hide();
	}

	private log(prefix: string, name: string, reason?: unknown): void {
		const { importLogEl } = this;

		importLogEl.createDiv('list-item', el => {
			el.createSpan({ cls: 'importer-error', text: prefix });
			el.createSpan({ text: `"${truncateText(name, this.maxFileNameLength)}"` + (reason ? ` because ${truncateText(describeReason(reason), this.maxFileNameLength)}` : '') });
		});

		importLogEl.scrollTop = importLogEl.scrollHeight;
		importLogEl.show();
	}
}

export interface ImporterData {
	importers: {
		onenote?: {
			previouslyImportedIDs: string[];
		};
	};
	/**
	 * Importer id -> the SecretStorage id holding that importer's credential.
	 *
	 * Only the id is kept here. The credential itself lives in Obsidian's
	 * keychain, so it is never written to the plugin's data file.
	 */
	secrets: Record<string, string>;
}

const DEFAULT_DATA: ImporterData = {
	importers: {
		onenote: {
			previouslyImportedIDs: [],
		},
	},
	secrets: {},
};

export default class ImporterPlugin extends Plugin {
	importers: Record<string, ImporterDefinition>;

	authCallback: AuthCallback | undefined;

	async onload() {
		this.importers = {
			'airtable-api': {
				name: 'Airtable (API)',
				optionText: 'Airtable (API)',
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
			new ImporterModal(this.app, this).open();
		});

		this.addCommand({
			id: 'open-modal',
			name: 'Import notes',
			callback: () => {
				new ImporterModal(this.app, this).open();
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

	constructor(app: App, plugin: ImporterPlugin) {
		super(app);
		this.plugin = plugin;
		this.titleEl.setText('Import data into Obsidian');
		this.modalEl.addClass('mod-importer');
		this.abortController = new AbortController();

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
					el.addEventListener('click', () => void (async () => {
						if (this.current) {
							this.current.cancel();
						}

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

						// Show progress UI
						contentEl.empty();
						let progressEl = contentEl.createDiv();
						ctx.createProgressUI(progressEl);

						let buttonsEl = contentEl.createDiv('modal-button-container');
						let cancelButtonEl = buttonsEl.createEl('button', { cls: 'mod-danger', text: 'Stop' }, el => {
							el.addEventListener('click', () => {
								ctx.cancel();
								cancelButtonEl.detach();
							});
						});
						try {
							await importer.import(ctx);
						}
						finally {
							if (this.current === ctx) {
								this.current = null;
							}
							buttonsEl.empty();
							buttonsEl.createEl('button', { text: 'Import more' }, el => {
								el.addEventListener('click', () => this.updateContent());
							});
							buttonsEl.createEl('button', { cls: 'mod-cta', text: 'Done' }, el => {
								el.addEventListener('click', () => this.close());
							});
							ctx.hideStatus();
						}
					})().catch(e => console.error('Import failed', e)));
				});
			});
		}
	}

	onClose() {
		const { contentEl, current } = this;
		contentEl.empty();
		this.abortController.abort('import was canceled by user');

		if (current) {
			current.cancel();
		}
	}
}
