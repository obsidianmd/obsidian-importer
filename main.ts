import { EvernoteEnexImporter } from 'evernote-enex';
import { FormatImporter } from 'format-importer';
import { HtmlImporter } from 'html';
import { App, DropdownComponent, Modal, Notice, Plugin, Setting, TextComponent } from 'obsidian';
import { ImportResult, ImporterInfo } from 'yarle/interfaces';

declare global {
	interface Window {
		electron: any;
	}
}

export default class ImporterPlugin extends Plugin {
	importers: ImporterInfo[];

	async onload() {
		this.importers = [];
		this.importers.push({
			id: 'evernote-enex',
			name: `Evernote (.enex)`,
			exportFolerName: 'Evernote',
			extensions: ['enex'],
			importer: new EvernoteEnexImporter(this.app)
		});
		this.importers.push({
			id: 'html',
			name: `HTML (.html))`,
			exportFolerName: 'HTML',
			extensions: ['html'],
			importer: new HtmlImporter(this.app)
		});

		this.addRibbonIcon('lucide-import', 'Open Importer', () => {
			new ImporterModal(this.app, this).open();
		})

		this.addCommand({
			id: 'open-modal',
			name: 'Open importer',
			callback: () => {
				new ImporterModal(this.app, this).open();
			}
		});
	}

	onunload() {

	}
}

class ImporterModal extends Modal {
	plugin: ImporterPlugin;
	fileLocationSetting: Setting;
	outputLocationSettingInput: TextComponent;
	filePaths: string[] = [];
	fileFormatSetting: DropdownComponent;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app);

		this.plugin = plugin;

		const { contentEl } = this;
		this.titleEl.setText('Import data into Obsidian');

		new Setting(contentEl)
			.setName('File format')
			.setDesc('The format to be imported.')
			.addDropdown(dropdown => {
				let importers = this.plugin.importers;

				for (let importer of importers) {
					dropdown.addOption(importer.id, importer.name);
				}

				this.fileFormatSetting = dropdown;
			});

		this.fileLocationSetting = new Setting(contentEl)
			.setName('Files to import')
			.setDesc('Pick the files that you want to import.')
			.addButton(button => button
				.setButtonText('Browse')
				.onClick(() => {
					let importerInfo = this.getCurrentImporterInfo();
					if (!importerInfo) {
						return;
					}
					let electron = window.electron;
					let selectedFiles = electron.remote.dialog.showOpenDialogSync({
						title: 'Pick files to import',
						properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
						filters: [{ name: importerInfo.name, extensions: importerInfo.extensions }],
					});

					if (selectedFiles && selectedFiles.length > 0) {
						this.filePaths = selectedFiles;
						this.updateFileLocation();
					}
				}));

		new Setting(contentEl)
			.setName('Output folder')
			.setDesc('Choose a folder in the vault to put the imported files. Leave empty to output to vault root.')
			.addText(text => text
				.setValue('Evernote')
				.then(text => this.outputLocationSettingInput = text));

		this.fileFormatSetting.onChange(() => {
			let newImporterInfo = this.getCurrentImporterInfo();
			if (!newImporterInfo) {
				return;
			}

			this.outputLocationSettingInput.setValue(newImporterInfo.exportFolerName);
		})

		contentEl.createDiv('button-container u-center-text', el => {
			el.createEl('button', { cls: 'mod-cta', text: 'Import' }, el => {
				el.addEventListener('click', async () => {
					if (this.filePaths.length === 0) {
						new Notice('Please pick at least one file to import.');
						return;
					}

					let importerInfo = this.getCurrentImporterInfo();
					if (!importerInfo) {
						return;
					}

					this.modalEl.addClass('is-loading');
				
					let results = await importerInfo.importer.import(this.filePaths, this.outputLocationSettingInput.getValue());
					this.modalEl.removeClass('is-loading');
					this.showResult(results);
				});
			});
		});
	}

	getCurrentImporterInfo(): ImporterInfo {
		let format = this.fileFormatSetting.getValue();
		let importers = this.plugin.importers.filter(importer => importer.id === format);

		if (importers.length === 0) {
			new Notice('Invalid import format.');
			return null;
		}

		return importers.first();
	}

	updateFileLocation() {
		let descriptionFragment = document.createDocumentFragment();
		descriptionFragment.createEl('span', { text: `You've picked the following files to import: ` });
		descriptionFragment.createEl('span', { cls: 'u-pop', text: this.filePaths.join(', ') });
		this.fileLocationSetting.setDesc(descriptionFragment);
	}

	showResult(result: ImportResult) {
		let { contentEl } = this;

		contentEl.empty();

		contentEl.createEl('p', { text: `You successfully imported ${result.total - result.failed - result.skipped} notes, out of ${result.total} total notes!` });

		if (result.skipped !== 0 || result.failed !== 0) {
			contentEl.createEl('p', { text: `${result.skipped} notes were skipped and ${result.failed} notes failed to import.` });
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

