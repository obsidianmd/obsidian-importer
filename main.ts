import { App, Modal, Plugin, Setting } from 'obsidian';
import { FormatImporter } from './format-importer';
import { Bear2bkImporter } from './formats/bear-bear2bk';
import { EvernoteEnexImporter } from './formats/evernote-enex';
import { HtmlImporter } from './formats/html';

declare global {
	interface Window {
		electron: any;
	}
}

interface ImporterDefinition {
	name: string;
	importer: new (app: App, modal: Modal) => FormatImporter;
}

export interface ImportResult {
	total: number,
	failed: string[],
	skipped: string[]
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
			}
		};

		this.addRibbonIcon('lucide-import', 'Open Importer', () => {
			new ImporterModal(this.app, this).open();
		});

		this.addCommand({
			id: 'open-modal',
			name: 'Open importer',
			callback: () => {
				new ImporterModal(this.app, this).open();
			}
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
						this.modalEl.addClass('is-loading');
						try {
							await importer.import();
						} finally {
							this.modalEl.removeClass('is-loading');
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

