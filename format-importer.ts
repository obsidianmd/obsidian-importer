import {
	App,
	Platform,
	Setting,
	TextComponent,
	TFile,
	TFolder,
} from 'obsidian';
import {
	getAllFiles,
	NodePickedFile,
	NodePickedFolder,
	PickedFile,
	WebPickedFile,
} from './filesystem';
import { ImporterModal, ImportResult } from './main';
import { sanitizeFileName } from './util';

export abstract class FormatImporter {
	app: App;
	modal: ImporterModal;
	files: PickedFile[] = [];

	outputLocationSettingInput: TextComponent;

	constructor(app: App, modal: ImporterModal) {
		this.app = app;
		this.modal = modal;
		this.init();
	}

	abstract init(): void;

	addFileChooserSetting(
		name: string,
		extensions: string[],
		allowMultiple: boolean = true
	) {
		let fileLocationSetting = new Setting(this.modal.contentEl)
			.setName('Files to import')
			.setDesc('Pick the files that you want to import.')
			.addButton((button) =>
				button
					.setButtonText(
						allowMultiple ? 'Choose files' : 'Choose file'
					)
					.onClick(async () => {
						if (Platform.isDesktopApp) {
							let properties = ['openFile', 'dontAddToRecent'];
							if (allowMultiple) {
								properties.push('multiSelections');
							}
							let result =
								await window.electron.remote.dialog.showOpenDialog(
									{
										title: 'Pick files to import',
										properties,
										filters: [{ name, extensions }],
									}
								);

							if (
								!result.canceled &&
								result.filePaths.length > 0
							) {
								this.files = result.filePaths.map(
									(filepath: string) =>
										new NodePickedFile(filepath)
								);
								updateFiles();
							}
						} else {
							let inputEl = createEl('input');
							inputEl.type = 'file';
							inputEl.addEventListener('change', () => {
								let files = Array.from(inputEl.files);
								if (files.length > 0) {
									this.files = files.map(
										(file) => new WebPickedFile(file)
									);
									updateFiles();
								}
							});
							inputEl.click();
						}
					})
			);

		if (allowMultiple && Platform.isDesktopApp) {
			fileLocationSetting.addButton((button) =>
				button.setButtonText('Choose folder').onClick(async () => {
					if (Platform.isDesktopApp) {
						let result =
							await window.electron.remote.dialog.showOpenDialog({
								title: 'Pick folders to import',
								properties: [
									'openDirectory',
									'multiSelections',
									'dontAddToRecent',
								],
							});

						if (!result.canceled && result.filePaths.length > 0) {
							fileLocationSetting.setDesc('Reading folders...');
							let folders = result.filePaths.map(
								(filepath: string) =>
									new NodePickedFolder(filepath)
							);
							this.files = await getAllFiles(
								folders,
								(file: PickedFile) =>
									extensions.contains(file.extension)
							);
							updateFiles();
						}
					}
				})
			);
		}

		let updateFiles = () => {
			let descriptionFragment = document.createDocumentFragment();
			descriptionFragment.createEl('span', {
				text: `These files will be imported: `,
			});
			descriptionFragment.createEl('br');
			descriptionFragment.createEl('span', {
				cls: 'u-pop',
				text: this.files.map((f) => f.name).join(', '),
			});
			fileLocationSetting.setDesc(descriptionFragment);
		};
	}

	addOutputLocationSetting(defaultExportFolerName: string) {
		new Setting(this.modal.contentEl)
			.setName('Output folder')
			.setDesc(
				'Choose a folder in the vault to put the imported files. Leave empty to output to vault root.'
			)
			.addText((text) =>
				text
					.setValue(defaultExportFolerName)
					.then((text) => (this.outputLocationSettingInput = text))
			);
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

		contentEl.createEl('p', {
			text: `You successfully imported ${
				result.total - result.failed.length - result.skipped.length
			} notes, out of ${result.total} total notes!`,
		});

		if (result.skipped.length > 0 || result.failed.length > 0) {
			contentEl.createEl('p', {
				text: `${result.skipped.length} notes were skipped and ${result.failed.length} notes failed to import.`,
			});
		}

		if (result.skipped.length > 0) {
			contentEl.createEl('p', { text: `Skipped notes:` });
			contentEl.createEl('ul', {}, (el) => {
				for (let note of result.skipped) {
					el.createEl('li', { text: note });
				}
			});
		}

		if (result.failed.length > 0) {
			contentEl.createEl('p', { text: `Failed to import:` });
			contentEl.createEl('ul', {}, (el) => {
				for (let note of result.failed) {
					el.createEl('li', { text: note });
				}
			});
		}

		contentEl.createDiv('button-container u-center-text', (el) => {
			el.createEl('button', { cls: 'mod-cta', text: 'Done' }, (el) => {
				el.addEventListener('click', async () => {
					modal.close();
				});
			});
		});
	}

	async saveAsMarkdownFile(
		folder: TFolder,
		title: string,
		content: string
	): Promise<TFile> {
		let santizedName = sanitizeFileName(title);
		// @ts-ignore
		return await this.app.fileManager.createNewMarkdownFile(
			folder,
			santizedName,
			content
		);
	}
}
