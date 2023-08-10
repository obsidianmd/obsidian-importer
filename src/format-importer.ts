import { App, normalizePath, Platform, Setting, TFile, TFolder, Vault } from 'obsidian';
import { getAllFiles, NodePickedFile, NodePickedFolder, PickedFile, WebPickedFile } from './filesystem';
import { ImporterModal, ProgressReporter } from './main';
import { sanitizeFileName } from './util';

const MAX_PATH_DESCRIPTION_LENGTH = 300;

export abstract class FormatImporter {
	app: App;
	vault: Vault;
	modal: ImporterModal;

	files: PickedFile[] = [];
	outputLocation: string = '';

	constructor(app: App, modal: ImporterModal) {
		this.app = app;
		this.vault = app.vault;
		this.modal = modal;
		this.init();
	}

	abstract init(): void;

	addFileChooserSetting(name: string, extensions: string[], allowMultiple: boolean = false) {
		let fileLocationSetting = new Setting(this.modal.contentEl)
			.setName('Files to import')
			.setDesc('Pick the files that you want to import.')
			.addButton(button => button
				.setButtonText(allowMultiple ? 'Choose files' : 'Choose file')
				.onClick(async () => {
					if (Platform.isDesktopApp) {
						let properties = ['openFile', 'dontAddToRecent'];
						if (allowMultiple) {
							properties.push('multiSelections');
						}
						let result = await window.electron.remote.dialog.showOpenDialog({
							title: 'Pick files to import', properties,
							filters: [{ name, extensions }],
						});

						if (!result.canceled && result.filePaths.length > 0) {
							this.files = result.filePaths.map((filepath: string) => new NodePickedFile(filepath));
							updateFiles();
						}
					}
					else {
						let inputEl = createEl('input');
						inputEl.type = 'file';
						inputEl.accept = extensions.map(e => '.' + e.toLowerCase()).join(',');
						inputEl.addEventListener('change', () => {
							if (!inputEl.files) return;
							let files = Array.from(inputEl.files);
							if (files.length > 0) {
								this.files = files.map(file => new WebPickedFile(file))
									.filter(file => extensions.contains(file.extension));
								updateFiles();
							}
						});
						inputEl.click();
					}
				}));

		if (allowMultiple && Platform.isDesktopApp) {
			fileLocationSetting.addButton(button => button
				.setButtonText('Choose folders')
				.onClick(async () => {
					if (Platform.isDesktopApp) {
						let result = await window.electron.remote.dialog.showOpenDialog({
							title: 'Pick folders to import',
							properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
						});

						if (!result.canceled && result.filePaths.length > 0) {
							fileLocationSetting.setDesc('Reading folders...');
							let folders = result.filePaths.map((filepath: string) => new NodePickedFolder(filepath));
							this.files = await getAllFiles(folders, (file: PickedFile) => extensions.contains(file.extension));
							updateFiles();
						}
					}
				}));
		}

		let updateFiles = () => {
			let descriptionFragment = document.createDocumentFragment();
			let fileCount = this.files.length;
			let pathText = this.files.map(f => f.name).join(', ');
			if (pathText.length > MAX_PATH_DESCRIPTION_LENGTH) {
				pathText = pathText.substring(0, MAX_PATH_DESCRIPTION_LENGTH) + '...';
			}
			descriptionFragment.createEl('span', { text: `These ${fileCount} files will be imported: ` });
			descriptionFragment.createEl('br');
			descriptionFragment.createEl('span', { cls: 'u-pop', text: pathText });
			fileLocationSetting.setDesc(descriptionFragment);
		};
	}

	addOutputLocationSetting(defaultExportFolderName: string) {
		this.outputLocation = defaultExportFolderName;
		new Setting(this.modal.contentEl)
			.setName('Output folder')
			.setDesc('Choose a folder in the vault to put the imported files. Leave empty to output to vault root.')
			.addText(text => text
				.setValue(defaultExportFolderName)
				.onChange(value => this.outputLocation = value));
	}

	async getOutputFolder(): Promise<TFolder | null> {
		let { vault } = this.app;

		let folderPath = this.outputLocation;
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

	abstract import(progress: ProgressReporter): Promise<any>;

	// Utility functions for vault

	/**
	 * Recursively create folders, if they don't exist.
	 */
	async createFolders(path: string): Promise<TFolder> {
		let normalizedPath = normalizePath(path);
		let folder = this.vault.getAbstractFileByPath(normalizedPath);
		if (folder && folder instanceof TFolder) {
			return folder;
		}

		await this.vault.createFolder(normalizedPath);
		folder = this.vault.getAbstractFileByPath(normalizedPath);
		if (!(folder instanceof TFolder)) {
			throw new Error(`Failed to create folder at "${path}"`);
		}

		return folder;
	}

	async saveAsMarkdownFile(folder: TFolder, title: string, content: string): Promise<TFile> {
		let sanitizedName = sanitizeFileName(title);
		// @ts-ignore
		return await this.app.fileManager.createNewMarkdownFile(folder, sanitizedName, content);
	}
}

