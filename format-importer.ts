import * as fs from 'fs';
import * as fsPromises from "fs/promises";
import * as path from 'path';
import { App, DataWriteOptions, DropdownComponent, Setting, TFolder, TextComponent, normalizePath } from "obsidian";
import { ImportResult, ImporterModal } from "./main";
import { sanitizeFileName } from "./util";

export abstract class FormatImporter {
	app: App;
	modal: ImporterModal;
	filePaths: string[] = [];
	folderPaths: string[] = [];

	outputLocationSettingInput: TextComponent;
	fileLocationSetting: Setting;
	folderLocationSetting: Setting;

	constructor(app: App, modal: ImporterModal) {
		this.app = app;
		this.modal = modal;
		this.init();
	}

	abstract init(): void;

	// give option to choose both folder and file depending on their need
	// this is due to the technical limitation that the system chooser doesn't let
	// the user choose folders and individual files at the same time
	addFileOrFolderChooserSetting(name: string, extensions: string[]) {
		let importTypeSettingDropdown: DropdownComponent = null;
		let updateSetting = () => {
			let value = importTypeSettingDropdown.getValue();
			this.fileLocationSetting.settingEl.toggle(value === 'files');
			this.folderLocationSetting.settingEl.toggle(value === 'folders');
		}

		new Setting(this.modal.contentEl)
			.setName('Import type')
			.setDesc('Choose if you want to import folders or files.')
			.addDropdown(dropdown => dropdown
				.addOption('files', 'Files')
				.addOption('folders', 'Folders')
				.onChange(updateSetting)
				.setValue('files')
				.then(dropdown => importTypeSettingDropdown = dropdown));

		this.addFileChooserSetting(name, extensions);
		this.addFolderChooserSetting(name, extensions);

		updateSetting();
	}

	addFileChooserSetting(name: string, extensions: string[]) {
		this.fileLocationSetting = new Setting(this.modal.contentEl)
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
						this.fileLocationSetting.setDesc(descriptionFragment);
					}
				}));
	}

	addFolderChooserSetting(name: string, extensions: string[]) {
		let walk = (dir: string): string[] => {
			let results: string[] = [];
			let list = fs.readdirSync(dir);

			list.forEach(file => {
				file = path.join(dir, file);

				let stat = fs.statSync(file);
				if (stat && stat.isDirectory()) {
					results = results.concat(walk(file));
				}
				else {
					let lastDotPosition = file.lastIndexOf('.');

					if (lastDotPosition === -1 || lastDotPosition === file.length - 1 || lastDotPosition === 0) {
						return;
					}

					let extension = file.slice(lastDotPosition + 1);

					if (extensions.contains(extension)) {
						results.push(file);
					}
				}
			});

			return results;
		}

		this.folderLocationSetting = new Setting(this.modal.contentEl)
			.setName('Folders to import')
			.setDesc('Pick the folders that you want to import.')
			.addButton(button => button
				.setButtonText('Browse')
				.onClick(async () => {
					let electron = window.electron;
					let selectedFolders = electron.remote.dialog.showOpenDialogSync({
						title: 'Pick folders to import',
						properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
						filters: [{ name, extensions }],
					});

					if (selectedFolders && selectedFolders.length > 0) {
						this.folderPaths = selectedFolders.map((path: string) => normalizePath(path));
						this.filePaths = [];

						for (let folder of selectedFolders) {
							this.filePaths = this.filePaths.concat(walk(folder));
						}

						let descriptionFragment = document.createDocumentFragment();
						descriptionFragment.createEl('span', { text: `You've picked the following folders to import: ` });
						descriptionFragment.createEl('span', { cls: 'u-pop', text: selectedFolders.join(', ') });
						this.folderLocationSetting.setDesc(descriptionFragment);
					}
				}));
	}

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

		contentEl.createEl('p', { text: `You successfully imported ${result.total - result.failed.length - result.skipped.length} notes, out of ${result.total} total notes!` });

		if (result.skipped.length > 0 || result.failed.length > 0) {
			contentEl.createEl('p', { text: `${result.skipped.length} notes were skipped and ${result.failed.length} notes failed to import.` });
		}

		if (result.skipped.length > 0) {
			contentEl.createEl('p', { text: `Skipped notes:` });
			contentEl.createEl('ul', {}, el => {
				for (let note of result.skipped) {
					el.createEl('li', { text: note });
				}
			});
		}

		if (result.failed.length > 0) {
			contentEl.createEl('p', { text: `Failed to import:` });
			contentEl.createEl('ul', {}, el => {
				for (let note of result.failed) {
					el.createEl('li', { text: note });
				}
			});
		}

		contentEl.createDiv('button-container u-center-text', el => {
			el.createEl('button', { cls: 'mod-cta', text: 'Done' }, el => {
				el.addEventListener('click', async () => {
					modal.close();
				});
			});
		});
	}

	async readPath(path: string) {
		return await fsPromises.readFile(path, 'utf-8');
	}

	// todo: return results
	async saveAsMarkdownFile(folder: TFolder, title: string, content: string, options: DataWriteOptions) {
		const {vault } = this.app;
		let sanitizedName = sanitizeFileName(title);
		await vault.create(`${folder.path}/${sanitizedName}.md`, content, options);
	}
}

