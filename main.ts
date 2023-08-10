import { App, Modal, Plugin, Setting } from 'obsidian';
import { FormatImporter } from './format-importer';
import { Bear2bkImporter } from './formats/bear-bear2bk';
import { EvernoteEnexImporter } from './formats/evernote-enex';
import { HtmlImporter } from './formats/html';
import { KeepImporter } from './formats/keep-json';
import { NotionImporter } from './formats/notion';

declare global {
	interface Window {
		electron: any;
		require: NodeRequire;
	}
}

interface ImporterDefinition {
	name: string;
	importer: new (app: App, modal: Modal) => FormatImporter;
}

export class ProgressReporter {
	notes = 0;
	attachments = 0;
	skipped: string[] = [];
	failed: string[] = [];
	maxFileNameLength: number = 100;

	el: HTMLElement;
	progressBarEl: HTMLElement;
	importedCountEl: HTMLElement;
	attachmentCountEl: HTMLElement;
	remainingCountEl: HTMLElement;
	skippedCountEl: HTMLElement;
	failedCountEl: HTMLElement;
	importLogEl: HTMLElement;

	constructor(el: HTMLElement) {
		this.el = el;

		el.empty();

		el.createDiv('importer-progress-bar', el => {
			this.progressBarEl = el.createDiv('importer-progress-bar-inner');
		});

		el.createDiv('import-stats-container', el => {
			el.createDiv('import-stat mod-imported', el => {
				this.importedCountEl = el.createDiv({ cls: 'import-stat-count', text: '0' });
				el.createDiv({ cls: 'import-stat-name', text: 'imported' });
			});
			el.createDiv('import-stat mod-attachments', el => {
				this.attachmentCountEl = el.createDiv({ cls: 'import-stat-count', text: '0' });
				el.createDiv({ cls: 'import-stat-name', text: 'attachments' });
			});
			el.createDiv('import-stat mod-remaining', el => {
				this.remainingCountEl = el.createDiv({ cls: 'import-stat-count', text: '0' });
				el.createDiv({ cls: 'import-stat-name', text: 'remaining' });
			});
			el.createDiv('import-stat mod-skipped', el => {
				this.skippedCountEl = el.createDiv({ cls: 'import-stat-count', text: '0' });
				el.createDiv({ cls: 'import-stat-name', text: 'skipped' });
			});
			el.createDiv('import-stat mod-failed', el => {
				this.failedCountEl = el.createDiv({ cls: 'import-stat-count', text: '0' });
				el.createDiv({ cls: 'import-stat-name', text: 'failed' });
			});
		});

		this.importLogEl = el.createDiv('import-log');
		this.importLogEl.hide();
	}

	reportNoteSuccess(name: string) {
		this.notes++;

		this.importedCountEl.setText(this.skipped.length.toString());
	}

	reportAttachmentSuccess(name: string) {
		this.attachments++;

		this.attachmentCountEl.setText(this.skipped.length.toString());
	}

	reportSkipped(name: string, reason?: any) {
		let { importLogEl } = this;
		this.skipped.push(name);

		console.log('Import skipped', name, reason);

		this.skippedCountEl.setText(this.skipped.length.toString());
		this.importLogEl.createDiv('list-item', el => {
			el.createSpan({ cls: 'import-error', text: 'Skipped: ' });
			el.createSpan({ text: `"${this.truncateText(name)}"` + (reason ? ` because ${this.truncateText(reason.toString())}` : '') });
		});
		importLogEl.scrollTop = importLogEl.scrollHeight;
		importLogEl.show();
	}

	reportFailed(name: string, reason?: any) {
		let { importLogEl } = this;

		this.failed.push(name);

		console.log('Import failed', name, reason);

		this.failedCountEl.setText(this.failed.length.toString());
		this.importLogEl.createDiv('list-item', el => {
			el.createSpan({ cls: 'import-error', text: 'Failed: ' });
			el.createSpan({ text: `"${this.truncateText(name)}"` + (reason ? ` because ${this.truncateText(reason.toString())}` : '') });
		});
		importLogEl.scrollTop = importLogEl.scrollHeight;
		importLogEl.show();
	}

	reportProgress(current: number, total: number) {
		console.log('Current progress:', (100 * current / total).toFixed(1) + '%');
		this.remainingCountEl.setText((total - current).toString());
		this.importedCountEl.setText(current.toString());
		this.progressBarEl.style.width = (100 * current / total).toFixed(1) + '%';
	}

	truncateText(text: string) {
		if (text.length < this.maxFileNameLength) {
			return text;
		}

		return text.substring(0, 100) + '...';
	}

}

export default class ImporterPlugin extends Plugin {
	importers: Record<string, ImporterDefinition>;

	async onload() {
		this.importers = {
			'bear': {
				name: 'Bear (.bear2bk)',
				importer: Bear2bkImporter,
			},
			'evernote': {
				name: 'Evernote (.enex)',
				importer: EvernoteEnexImporter,
			},
			'html': {
				name: 'HTML (.html)',
				importer: HtmlImporter,
			},
			'keep': {
				name: 'Google Keep (.zip/.json)',
				importer: KeepImporter,
			},
			'notion': {
				name: 'Notion (.zip)',
				importer: NotionImporter,
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
}

export class ImporterModal extends Modal {
	plugin: ImporterPlugin;
	importer: FormatImporter;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app);
		this.plugin = plugin;
		this.titleEl.setText('Import data into Obsidian');

		let keys = Object.keys(plugin.importers);
		if (keys.length > 0) {
			this.updateContent(keys[0]);
		}
	}

	updateContent(selectedId: string) {
		const { contentEl, plugin: { importers } } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName('File format')
			.setDesc('The format to be imported.')
			.addDropdown(dropdown => {
				for (let id in importers) {
					if (importers.hasOwnProperty(id)) {
						dropdown.addOption(id, importers[id].name);
					}
				}
				dropdown.onChange((value) => {
					if (importers.hasOwnProperty(value)) {
						this.updateContent(value);
					}
				});
				dropdown.setValue(selectedId);
			});

		if (selectedId && importers.hasOwnProperty(selectedId)) {
			let importer = this.importer = new importers[selectedId].importer(this.app, this);

			contentEl.createDiv('button-container u-center-text', el => {
				el.createEl('button', { cls: 'mod-cta', text: 'Import' }, el => {
					el.addEventListener('click', async () => {
						contentEl.empty();
						let progressEl = contentEl.createDiv();

						let progress = new ProgressReporter(progressEl);
						try {
							await importer.import(progress);
						}
						finally {
							contentEl.createDiv('button-container u-center-text', el => {
								el.createEl('button', { cls: 'mod-cta', text: 'Done' }, el => {
									el.addEventListener('click', async () => {
										this.close();
									});
								});
							});
						}
					});
				});
			});
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

