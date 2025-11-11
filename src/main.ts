import { App, Modal, Notice, Plugin, Setting } from 'obsidian';
import { FormatImporter } from './format-importer';
import { AppleNotesImporter } from './formats/apple-notes';
import { Bear2bkImporter } from './formats/bear-bear2bk';
import { CSVImporter } from './formats/csv';
import { EvernoteEnexImporter } from './formats/evernote-enex';
import { HtmlImporter } from './formats/html';
import { KeepImporter } from './formats/keep-json';
import { NotionImporter } from './formats/notion';
import { OneNoteImporter } from './formats/onenote';
import { RoamJSONImporter } from './formats/roam-json';
import { TextbundleImporter } from './formats/textbundle';
import { TomboyImporter } from './formats/tomboy';
import { truncateText } from './util';

declare global {
	interface Window {
		electron: any;
		require: NodeRequire;
	}
}

interface ImporterDefinition {
	name: string;
	optionText: string;
	helpPermalink?: string;
	formatDescription?: string;
	importer: new (app: App, modal: Modal) => FormatImporter;
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
export type AuthCallback = (data: any) => void;

// Temporary compatibility for in progress PRs
export type ProgressReporter = ImportContext;

export class ImportContext {
	notes = 0;
	attachments = 0;
	skipped: string[] = [];
	failed: string[] = [];
	maxFileNameLength: number = 100;
	statusMessage: string = '';

	cancelled: boolean = false;

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

	/**
	 * Sets the current user visible in-progress task. The purpose is to tell the user that something is happening,
	 * and makes it easy to tell if something got stuck.
	 *
	 * Try to keep the message short, since longer ones will get truncated based on font and space availability.
	 * @param message
	 */
	status(message: string) {
		this.statusMessage = message;
		this.statusEl.setText(message.trim() + '...');
	}

	/**
	 * Report that a note has been successfully imported.
	 * @param name
	 */
	reportNoteSuccess(name: string) {
		this.notes++;
		this.importedCountEl.setText(this.notes.toString());
	}

	/**
	 * Report that an attachment has been successfully imported.
	 * @param name
	 */
	reportAttachmentSuccess(name: string) {
		this.attachments++;
		this.attachmentCountEl.setText(this.attachments.toString());
	}

	/**
	 * Report that something has been skipped and ignored.
	 * If the skipping action is on purpose and expected for the import, then prefer not to report it
	 * (for example, some tools export to a Note.json and a Note.html, and we only use one of them).
	 * @param name
	 * @param reason
	 */
	reportSkipped(name: string, reason?: any) {
		let { importLogEl } = this;
		this.skipped.push(name);
		this.skippedCountEl.setText(this.skipped.length.toString());

		console.log('Import skipped', name, reason);

		this.importLogEl.createDiv('list-item', el => {
			el.createSpan({ cls: 'importer-error', text: 'Skipped: ' });
			el.createSpan({ text: `"${truncateText(name, this.maxFileNameLength)}"` + (reason ? ` because ${truncateText(String(reason), this.maxFileNameLength)}` : '') });
		});
		importLogEl.scrollTop = importLogEl.scrollHeight;
		importLogEl.show();
	}

	/**
	 * Report that something has failed to import.
	 * @param name
	 * @param reason
	 */
	reportFailed(name: string, reason?: any) {
		let { importLogEl } = this;

		this.failed.push(name);
		this.failedCountEl.setText(this.failed.length.toString());

		console.log('Import failed', name, reason);

		this.importLogEl.createDiv('list-item', el => {
			el.createSpan({ cls: 'importer-error', text: 'Failed: ' });
			el.createSpan({ text: `"${truncateText(name, this.maxFileNameLength)}"` + (reason ? ` because ${truncateText(String(reason), this.maxFileNameLength)}` : '') });
		});
		importLogEl.scrollTop = importLogEl.scrollHeight;
		importLogEl.show();
	}

	/**
	 * Report the current progress. This will update the progress bar as well as changing
	 * the "imported" and "remaining" numbers on the UI.
	 * @param current
	 * @param total
	 */
	reportProgress(current: number, total: number) {
		if (total <= 0) return;
		console.log('Current progress:', (100 * current / total).toFixed(1) + '%');
		this.remainingCountEl.setText((total - current).toString());
		this.importedCountEl.setText(current.toString());
		this.progressBarInnerEl.style.width = (100 * current / total).toFixed(1) + '%';
	}

	cancel() {
		this.cancelled = true;
		this.progressBarEl.hide();
		this.statusEl.hide();
	}

	hideStatus() {
		this.progressBarEl.hide();
		this.statusEl.hide();
	}

	/**
	 * Check if the user has cancelled this run.
	 */
	isCancelled() {
		return this.cancelled;
	}
}

export interface ImporterData {
	importers: {
		onenote?: {
			previouslyImportedIDs: string[];
		};
	};
}

const DEFAULT_DATA: ImporterData = {
	importers: {
		onenote: {
			previouslyImportedIDs: [],
		},
	},
};

export default class ImporterPlugin extends Plugin {
	importers: Record<string, ImporterDefinition>;

	authCallback: AuthCallback | undefined;

	async onload() {
		this.importers = {
			'apple-notes': {
				name: 'Apple Notes',
				optionText: 'Apple Notes',
				importer: AppleNotesImporter,
				helpPermalink: 'import/apple-notes'
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

		this.addRibbonIcon('lucide-import', 'Open Importer', () => {
			new ImporterModal(this.app, this).open();
		});

		this.addCommand({
			id: 'open-modal',
			name: 'Open importer',
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
}

export class ImporterModal extends Modal {
	plugin: ImporterPlugin;
	importer: FormatImporter;
	selectedId: string;
	abortController: AbortController;

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
					if (importers.hasOwnProperty(id)) {
						dropdown.addOption(id, importers[id].optionText);
					}
				}
				dropdown.onChange((value) => {
					if (importers.hasOwnProperty(value)) {
						this.selectedId = value;
						this.updateContent();
					}
				});
				dropdown.setValue(this.selectedId);
			});

		if (selectedId && importers.hasOwnProperty(selectedId)) {
			let importer = this.importer = new selectedImporter.importer(this.app, this);

			//Hide the import buttons if it's not available.
			//The actual message to display is handled by the importer, since it depends on what is being imported.
			if (importer.notAvailable) return;

			contentEl.createDiv('modal-button-container', el => {
				el.createEl('button', { cls: 'mod-cta', text: 'Import' }, el => {
					el.addEventListener('click', async () => {
						if (this.current) {
							this.current.cancel();
						}

						// Clear content
						contentEl.empty();
						let configEl = contentEl.createDiv();
						let ctx = this.current = new ImportContext(configEl);

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
					});
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
