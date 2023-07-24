import { App, FileSystemAdapter, Modal, Setting, TFile, TFolder, TextComponent, normalizePath } from "obsidian";
import { ImportResult, ImporterModal } from "./main";
import { sanitizeFileName } from "./util";

export abstract class FormatImporter {
	app: App;
	modal: ImporterModal;

	constructor(app: App, modal: ImporterModal) {
		this.app = app;
		this.modal = modal;
		this.init();
	}

	abstract init(): void;

	filePaths: string[] = [];
	addFileChooserSetting(name: string, extensions: string[]) {
		let fileLocationSetting = new Setting(this.modal.contentEl)
			.setName('Files to import')
			.setDesc('Pick the files that you want to import.')
			.addButton(button => button
				.setButtonText('Browse')
				.onClick(() => {
					let electron = window.electron;
					let selectedFiles = electron.remote.dialog.showOpenDialogSync({
						title: 'Pick files to import',
						properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
						filters: [{ name, extensions }],
					});

					if (selectedFiles && selectedFiles.length > 0) {
						this.filePaths = selectedFiles;
						let descriptionFragment = document.createDocumentFragment();
						descriptionFragment.createEl('span', { text: `You've picked the following files to import: ` });
						descriptionFragment.createEl('span', { cls: 'u-pop', text: selectedFiles.join(', ') });
						fileLocationSetting.setDesc(descriptionFragment);
					}
				}));
	}

	outputLocationSettingInput: TextComponent;
	addOutputLocationSetting(defaultExportFolerName: string) {
		new Setting(this.modal.contentEl)
			.setName('Output folder')
			.setDesc('Choose a folder in the vault to put the imported files. Leave empty to output to vault root.')
			.addText(text => text
				.setValue(defaultExportFolerName)
				.then(text => this.outputLocationSettingInput = text));
	}

	async getOutputFolder(): Promise<TFolder> | null {
		let { vault } = this.app;

		let folderPath = this.outputLocationSettingInput.getValue();
		if (folderPath === '') {
			folderPath = '/';
		}

		let folder = vault.getAbstractFileByPath(folderPath);

		if (folder === null || !(folder instanceof TFolder)) {
			await vault.createFolder(folderPath);
			folder = vault.getAbstractFileByPath(folderPath);
		}

		if (folder instanceof TFolder) {
			return folder;
		}

		return null;
	}

	abstract import(): Promise<void>;

	showResult(result: ImportResult) {
		let { modal } = this;
		let { contentEl } = modal;

		contentEl.empty();

		contentEl.createEl('p', { text: `You successfully imported ${result.total - result.failed - result.skipped} notes, out of ${result.total} total notes!` });

		if (result.skipped !== 0 || result.failed !== 0) {
			contentEl.createEl('p', { text: `${result.skipped} notes were skipped and ${result.failed} notes failed to import.` });
		}

		contentEl.createDiv('button-container u-center-text', el => {
			el.createEl('button', { cls: 'mod-cta', text: 'Done' }, el => {
				el.addEventListener('click', async () => {
					modal.close();
				});
			});
		});
	}

	// todo: return results
	async saveAsMarkdownFile(folder: TFolder, title: string, content: string) {
		let santizedName = sanitizeFileName(title);
		//@ts-ignore
		await this.app.fileManager.createNewMarkdownFile(folder, santizedName, content);
	}
}
