import * as fs from 'fs';
import { App, FileSystemAdapter, htmlToMarkdown, Modal, Notice, Plugin, Setting, TFolder } from 'obsidian';
import * as path from 'path';
import flow from 'xml-flow';
import { defaultYarleOptions, dropTheRope, ImportResult } from 'yarle/yarle';

declare global {
	interface Window {
		electron: any;
	}
}

function escapeRegex(str: string): string {
	return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

const ILLEGAL_CHARACTERS = '\\/:*?<>\"|';
const ILLEGAL_FILENAME_RE = new RegExp('[' + escapeRegex(ILLEGAL_CHARACTERS) + ']', 'g');

export default class ImporterPlugin extends Plugin {
	async onload() {
		this.addRibbonIcon('lucide-import', 'Open Importer', () => {
			new ImporterModal(this.app).open();
		})

		this.addCommand({
			id: 'open-modal',
			name: 'Open importer',
			callback: () => {
				new ImporterModal(this.app).open();
			}
		});
	}

	onunload() {

	}
}

class ImporterModal extends Modal {
	fileLocationSetting: Setting;
	outputLocationSettingInput: HTMLInputElement;
	filePaths: string[] = [];

	constructor(app: App) {
		super(app);

		const { contentEl } = this;
		this.titleEl.setText('Import data into Obsidian');

		new Setting(contentEl)
			.setName('File format')
			.setDesc('The format to be imported.')
			.addDropdown(dropdown => dropdown.addOption('evernote', 'Evernote (.enex)'));

		this.fileLocationSetting = new Setting(contentEl)
			.setName('Files to import')
			.setDesc('Pick the files that you want to import.')
			.addButton(button => button
				.setButtonText('Browse')
				.onClick(() => {
					let electron = window.electron;
					let selectedFiles = electron.remote.dialog.showOpenDialogSync({
						title: 'Pick Evernote ENEX',
						properties: ['openFile', 'dontAddToRecent'],
						filters: [{ name: 'ENEX (Evernote export)', extensions: ['enex'] }],
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
				.then(text => this.outputLocationSettingInput = text.inputEl));


		contentEl.createDiv('button-container u-center-text', el => {
			el.createEl('button', { cls: 'mod-cta', text: 'Import' }, el => {
				el.addEventListener('click', async () => {
					if (this.filePaths.length === 0) {
						new Notice('Please pick at least one file to import.');
						return;
					}

					let parser = new EnexParser(this.app);
					this.modalEl.addClass('is-loading');
					let results = await parser.yarleReadNotebook(this.filePaths, this.outputLocationSettingInput.value);
					this.modalEl.removeClass('is-loading');
					this.showResult(results);
				});
			});
		});
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

class EnexParser {
	app: App;
	folderPath: string;
	folder: TFolder;

	constructor(app: App) {
		this.app = app;
	}

	async yarleReadNotebook(paths: string[], outputFolder: string) {
		let { app } = this;
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		this.folderPath = outputFolder;

		if (this.folderPath === '') {
			this.folderPath = '/';
		}

		let folder = app.vault.getAbstractFileByPath(this.folderPath);

		if (folder === null || !(folder instanceof TFolder)) {
			await app.vault.createFolder(this.folderPath);
			folder = app.vault.getAbstractFileByPath(this.folderPath);
		}

		let yarleOptions = {
			...defaultYarleOptions,
			...{
				enexSources: paths,
				outputDir: path.join(adapter.getBasePath(), folder.path),
			}
		};

		return await dropTheRope(yarleOptions);

	}

	async readNotebookByPath(path: string) {
		let { app } = this;
		let inFile = fs.createReadStream(path);
		let xmlStream = flow(inFile);

		let evernoteNotebook = new EvernoteNotebook();
		evernoteNotebook.notes = [];
		xmlStream.on('tag:note', noteData => {
			let note = new EvernoteNote(noteData);

			evernoteNotebook.notes.push(note);
		});

		let folder = app.vault.getAbstractFileByPath(this.folderPath);

		if (folder === null || !(folder instanceof TFolder)) {
			await app.vault.createFolder(this.folderPath);
			folder = app.vault.getAbstractFileByPath(this.folderPath);
		}

		if (!(folder instanceof TFolder)) {
			new Notice('Failed to create destination folder');
			return;
		}

		this.folder = folder;

		xmlStream.on('end', async () => {
			// Cleanup
			// for (let file of this.folder.children.slice()) {
			// 	await app.vault.delete(file, true);
			// }

			for (let note of evernoteNotebook.notes) {
				await this.saveAsMarkdownFile(note);
			}
		});
	}

	async saveAsMarkdownFile(note: EvernoteNote) {
		let santizedName = note.title.replace(ILLEGAL_FILENAME_RE, '');
		//@ts-ignore
		await this.app.fileManager.createNewMarkdownFile(this.folder, santizedName, note.content);
	}
}

class EvernoteNotebook {
	notes: EvernoteNote[];
}

interface EvernoteNoteData {
	title: string;
	content: string;
	created: string;
	updated: string;
	tag?: string | string[];
	resource?: EvernoteResourceData[];
}

interface EvernoteResourceData {
	data: {
		$attrs: {
			encoding: string
		},
		$text: string
	},
	mime: string,
	width?: number,
	height?: number,
	'resource-attributes': {
		'file-name': string,
		'source-url'?: string
	}
}

class EvernoteNote {
	title: string;
	rawXmlContent: string;
	content: string;
	createdTs: number;
	updatedTs: number;
	attachments: Record<string, EvernoteAttachment> = {};

	constructor(data: EvernoteNoteData) {
		this.title = data.title;
		this.content = htmlToMarkdown(data.content);
	}

}

class EvernoteAttachment {

}
