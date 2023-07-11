import { App, Modal, Plugin, PluginSettingTab, Setting, TFolder, htmlToMarkdown } from 'obsidian';
import flow from 'xml-flow';
import * as fs from 'fs';
// Remember to rename these classes and interfaces!

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

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'import:open-modal',
			name: 'Open importer',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
		contentEl.createDiv('button-container u-center-text', el => {
			el.createEl('button', { cls: 'mod-cta', text: 'Pick file' }, el => {
				el.addEventListener('click', () => {
					let electron = window.electron;
					let selectedFiles = electron.remote.dialog.showOpenDialogSync({
						title: 'Pick Evernote ENEX ',
						properties: ['openFile', 'dontAddToRecent'],
						filters: [{ name: 'ENEX (Evernote export)', extensions: ['enex'] }],
					});

					if (selectedFiles && selectedFiles.length > 0) {
						new EnexParser(this.app, selectedFiles);
					}
				})
			});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for my awesome plugin.' });

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					console.log('Secret: ' + value);
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}

class EnexParser {
	app: App;
	folderPath: string;
	folder: TFolder;

	constructor(app: App, paths: string[]) {
		this.app = app;
		this.folderPath = 'evernote'

		for (let path of paths) {
			this.readNotebookByPath(path);
		}
	}

	async readNotebookByPath(path: string) {
		let inFile = fs.createReadStream(path);
		let xmlStream = flow(inFile);

		let evernoteNotebook = new EvernoteNotebook();
		evernoteNotebook.notes = [];
		xmlStream.on('tag:note', noteData => {
			let note = new EvernoteNote();
			console.log(noteData);
			note.title = noteData.title;
			note.content = htmlToMarkdown(noteData.content);

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

class EvernoteNote {
	title: string;
	rawXmlContent: string;
	content: string;
	createdTs: number;
	updatedTs: number;
	attachments: Record<string, EvernoteAttachment> = {};

}

class EvernoteAttachment {

}