import { KeepImporter } from 'formats/keep-json';
import { FormatImporter } from './format-importer';
import { Bear2bkImporter } from './formats/bear-bear2bk';
import { EvernoteEnexImporter } from './formats/evernote-enex';
import { HtmlImporter } from './formats/html';
import { App, Modal, Notice, Plugin, Setting } from 'obsidian';

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

// Deprecated, only here until current PRs are closed
export interface ImportResult {
	total: number,
	failed: string[],
	skipped: string[]
}

export class ProgressReporter {
	notes = 0;
	attachments = 0;
	skipped: string[] = [];
	failed: string[] = [];

	reportNoteSuccess(name: string) {
		this.notes++;
		console.log('Import success', name);
	}

	reportAttachmentSuccess(name: string) {
		this.attachments++;
		console.log('Import success', name);
	}

	reportSkipped(name: string, reason?: any) {
		this.skipped.push(name);
		console.log('Import skipped', name, reason);
	}

	reportFailed(name: string, reason?: any) {
		this.failed.push(name);
		console.log('Import failed', name, reason);
	}

	reportProgress(current: number, total: number) {
		console.log('Current progress:', (100 * current / total).toFixed(1) + '%');
	}
}

export default class ImporterPlugin extends Plugin {
	importers: Record<string, ImporterDefinition>;

	async onload() {
		this.importers = {
			'evernote': {
				name: 'Evernote (.enex)',
				importer: EvernoteEnexImporter,
			},
			'html': {
				name: 'HTML (.html)',
				importer: HtmlImporter,
			},
			'bear': {
				name: 'Bear (.bear2bk)',
				importer: Bear2bkImporter,
			},
			'keep': {
				name: 'Google Keep (.json)',
				importer: KeepImporter,
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
						let progress = new ProgressReporter();
						this.modalEl.addClass('is-loading');
						new Notice('Import started.');
						try {
							await importer.import(progress);
						}
						finally {
							this.modalEl.removeClass('is-loading');
							this.showResult(progress);
						}
						new Notice('Import complete.');
					});
				});
			});
		}
	}

	showResult(result: ProgressReporter) {
		let { contentEl } = this;
		let { notes, attachments, skipped, failed } = result;

		contentEl.empty();

		let numNotes = `${notes} notes`;
		if (attachments > 0) {
			numNotes += ` and ${attachments} attachments`;
		}
		contentEl.createEl('p', { text: `You successfully imported ${numNotes}!` });

		if (skipped.length > 0 || failed.length > 0) {
			contentEl.createEl('p', { text: `${skipped.length} notes were skipped and ${failed.length} notes failed to import.` });
		}

		if (skipped.length > 0) {
			contentEl.createEl('p', { text: 'Skipped notes:' });
			contentEl.createEl('ul', {}, el => {
				for (let note of skipped) {
					el.createEl('li', { text: note });
				}
			});
		}

		if (failed.length > 0) {
			contentEl.createEl('p', { text: 'Failed to import:' });
			contentEl.createEl('ul', {}, el => {
				for (let note of failed) {
					el.createEl('li', { text: note });
				}
			});
		}

		contentEl.createDiv('button-container u-center-text', el => {
			el.createEl('button', { cls: 'mod-cta', text: 'Done' }, el => {
				el.addEventListener('click', async () => {
					this.close();
				});
			});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

