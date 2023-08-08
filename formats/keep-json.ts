import { FormatImporter } from "../format-importer";
import { DataWriteOptions, Notice, Setting, TFile } from "obsidian";
import { ImportResult, ProgressReporter } from '../main';
import { convertJsonToMd } from "./keep/convert-json-to-md";
import { KeepJson, convertStringToKeepJson } from "./keep/models/keep-json";
import { toSentenceCase } from "../util";


const NOTE_EXTS = ['json'];
// Google Keep supports attachment formats that might change and exports in the original format uploaded, so limiting to binary formats Obsidian supports
const ATTACHMENT_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mpg', 'm4a', 'webm', 'wav', 'ogv', '3gp', 'mov', 'mp4', 'mkv', 'pdf'];


export class KeepImporter extends FormatImporter {
	importArchivedSetting: Setting;
	importTrashedSetting: Setting;
	importArchived: boolean = false;
	importTrashed: boolean = false;

	init() {
		this.modal.contentEl.createEl('h3', {text: 'Supported features'});
		const listEl = this.modal.contentEl.createEl('ul');
		listEl.createEl('li', {
			text: `All checklists will import as first level items as Google Keep doesn't export indentation information.`,
		});
		listEl.createEl('li', {
			text: `Reminders and user assignments on notes won't import as they are not supported by Obsidian.`,
		});
		listEl.createEl('li', {
			text: `All other information should import as a combination of content and tags.`,
		});

		this.modal.contentEl.createEl('h3', {text: 'Exporting from Google Keep'});
		const firstParaEl = this.modal.contentEl.createEl('p', {
			text: 'To export your files from Google Keep, open ',
		});
		firstParaEl.createEl('a', {
			text: 'Google Takeout',
			href: 'https://takeout.google.com/'
		});
		firstParaEl.appendText(' and select only Google Keep files. Once you have the exported zip, unzip it and and import the files below before clicking import.');

		this.modal.contentEl.createEl('h2', {text: 'Prepare your import'});

		this.addFileChooserSetting('Notes & attachments', [...NOTE_EXTS, ...ATTACHMENT_EXTS]);

		this.importArchivedSetting = new Setting(this.modal.contentEl)
            .setName('Import archived notes')
			.setDesc('If imported, files archived in Google Keep will be tagged as archived.')
            .addToggle(toggle => {
                toggle.setValue(this.importArchived)
                toggle.onChange(async (value) => {
                    this.importArchived = value;
                });
            });
        
		this.importTrashedSetting = new Setting(this.modal.contentEl)
            .setName('Import deleted notes')
			.setDesc('If imported, files deleted in Google Keep will be tagged as deleted. Deleted notes will only exist in your Google export if deleted recently.')
            .addToggle(toggle => {
                toggle.setValue(this.importTrashed)
                toggle.onChange(async (value) => {
                    this.importTrashed = value;
                });
            });

		this.addOutputLocationSetting('Google Keep');

	}

	async import(progress: ProgressReporter): Promise<void> {

		let { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to import your files to.');
			return;
		}
		let assetFolderPath = `${folder.path}/Assets`;

		let results: ImportResult = {
			total: 0,
			skipped: [],
			failed: []
		};

		for (let file of files) {
			try {
				if(file.extension === 'json') {
					let rawContent = await file.readText();
					let keepJson = convertStringToKeepJson(rawContent);
					if(!keepJson) throw(`JSON file doesn't match expected Google Keep format.`);
					
					if(keepJson.isArchived && !this.importArchived) {
						progress.reportSkipped(file.name, 'Archived note');
						continue;
					}
					if(keepJson.isTrashed && !this.importTrashed) {
						progress.reportSkipped(file.name, 'Deleted note');
						continue;
					}
					
					let mdContent = convertJsonToMd(keepJson);
					const fileRef = await this.saveAsMarkdownFile(folder, file.basename, mdContent);
					await this.addKeepFrontMatter(fileRef, keepJson);					
					
					const writeOptions: DataWriteOptions = {
						ctime: keepJson.createdTimestampUsec/1000,
						mtime: keepJson.userEditedTimestampUsec/1000
					}
					this.modifyWriteOptions(fileRef, writeOptions);

				} else {
					let assetFolder = await this.createFolders(assetFolderPath);
					// Keep assets have filenames that appear unique, so no duplicate handling isn't implemented
					await this.copyFile(file, `${assetFolder.path}/${file.name}`);
					
				}
				progress.reportNoteSuccess(file.name);

			} catch (e) {
				console.error(`${file.name} ::: `, e);
				progress.reportFailed(file.name, e);
			}
		}

		this.showResult(results);
	}

	async addKeepFrontMatter(fileRef: TFile, keepJson: KeepJson) {
		await this.app.fileManager.processFrontMatter(fileRef, (frontmatter: any) => {

			if (keepJson.title) this.addAliasToFrontmatter(keepJson.title, fileRef, frontmatter);
		
			// Add in tags to represent Keep properties
			if(keepJson.color && keepJson.color !== 'DEFAULT') {
				let colorName = keepJson.color.toLowerCase();
				colorName = toSentenceCase(colorName);
				this.addTagToFrontmatter(`Keep/Color/${colorName}`, fileRef, frontmatter);
			}
			if(keepJson.isPinned)    	this.addTagToFrontmatter(`Keep/Pinned`, fileRef, frontmatter);
			if(keepJson.attachments)	this.addTagToFrontmatter(`Keep/Attachment`, fileRef, frontmatter);
			if(keepJson.isArchived)		this.addTagToFrontmatter(`Keep/Archived`, fileRef, frontmatter);
			if(keepJson.isTrashed) 		this.addTagToFrontmatter(`Keep/Deleted`, fileRef, frontmatter);
		
			if (keepJson.labels) {
				for (let i = 0; i < keepJson.labels.length; i++) {
					this.addTagToFrontmatter(`Keep/Label/${keepJson.labels[i].name}`, fileRef, frontmatter);
				}
			};

		});
	}
}