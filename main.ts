import { App, Modal, Plugin, Setting, TFolder, htmlToMarkdown, normalizePath } from 'obsidian';
import flow from 'xml-flow';
import * as fs from 'fs';
import { dropTheRope, defaultYarleOptions } from './yarle/yarle';
import { OutputFormat } from 'yarle/output-format';
import { TaskOutputFormat } from 'yarle';

declare global {
	interface Window {
		electron: any;
	}
}

interface MyPluginSettings {
	mySetting: string;
}

function escapeRegex(str: string): string {
	return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

const ILLEGAL_CHARACTERS = '\\/:*?<>\"|';
const ILLEGAL_FILENAME_RE = new RegExp('[' + escapeRegex(ILLEGAL_CHARACTERS) + ']', 'g');

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		this.addRibbonIcon('lucide-import', 'Open Importer', () => {
			new ImporterModal(this.app).open();
		})

		this.addCommand({
			id: 'import:open-modal',
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
	filePaths: string[];

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText('Import data into Obsidian')

		new Setting(contentEl)
			.setName('Export type')
			.setDesc('The format to be imported.')
			.addDropdown(dropdown => dropdown.addOption('evernote', 'Evernote (.enex)'));

		this.fileLocationSetting = new Setting(contentEl)
			.setName('File location')
			.setDesc(`Pick the files that you'd like to import.`)
			.addButton(button => button
				.setButtonText('Browse')
				.onClick(() => {
					let electron = window.electron;
					let selectedFiles = electron.remote.dialog.showOpenDialogSync({
						title: 'Pick Evernote ENEX ',
						properties: ['openFile', 'dontAddToRecent'],
						filters: [{ name: 'ENEX (Evernote export)', extensions: ['enex'] }],
					});

					if (selectedFiles && selectedFiles.length > 0) {
						this.filePaths = selectedFiles;
						this.updateFileLocation();
					}
				}));

		contentEl.createDiv('button-container u-center-text', el => {
			el.createEl('button', { cls: 'mod-cta', text: 'Import' }, el => {
				el.addEventListener('click', () => {
					new EnexParser(this.app, this.filePaths);
				});
			});
		});
	}

	updateFileLocation() {
		let descriptionFragment = document.createDocumentFragment();
		descriptionFragment.createEl('span', {text: `You've picked the following files to import: `});
		descriptionFragment.createEl('span', {cls: 'u-pop', text: this.filePaths.join(', ')});
		this.fileLocationSetting.setDesc(descriptionFragment);
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

	constructor(app: App, paths: string[]) {
		this.app = app;
		this.folderPath = 'evernote';

		this.yarleReadNotebook(paths);
	}

	async yarleReadNotebook(paths: string[]) {
		let folder = app.vault.getAbstractFileByPath(this.folderPath);

		if (folder === null || !(folder instanceof TFolder)) {
			await app.vault.createFolder(this.folderPath);
			folder = app.vault.getAbstractFileByPath(this.folderPath);
		}

		this.folder = folder as TFolder;

		for (let file of this.folder.children.slice()) {
			await app.vault.delete(file, true);
		}

		let yarleOptions = {
			...defaultYarleOptions,
			...{
				enexSources: paths,
				//@ts-ignore
				outputDir: normalizePath(this.app.vault.adapter.getBasePath() + '/evernote'),
				outputFormat: OutputFormat.ObsidianMD,
				taskOutputFormat: TaskOutputFormat.ObsidianMD
			}
		};
		let results = await dropTheRope(yarleOptions);
		console.log(results)
	}

	async readNotebookByPath(path: string) {
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

		this.folder = folder as TFolder;

		xmlStream.on('end', async () => {
			// testing
			for (let file of this.folder.children.slice()) {
				await app.vault.delete(file, true);
			}

			for (let note of evernoteNotebook.notes) {
				await this.saveAsMarkdownFile(note);
			}
		});
	}

	async saveAsMarkdownFile(note: EvernoteNote) {
		let santizedName = note.title.replace(ILLEGAL_FILENAME_RE, '');
		//@ts-ignore
		await app.fileManager.createNewMarkdownFile(this.folder, santizedName, note.content);
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