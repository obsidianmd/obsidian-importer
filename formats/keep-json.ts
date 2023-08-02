import { FormatImporter } from "../format-importer";
import { DataWriteOptions, Notice, Setting } from "obsidian";
import { copyFile, getOrCreateFolder, modifyWriteOptions, separatePathNameExt } from '../util';
import { ImportResult } from '../main';
import { convertJsonToMd } from "./keep/convert-json-to-md";
import { convertStringToKeepJson } from "./keep/models/KeepJson";
import { addKeepFrontMatter } from "./keep/add-keep-frontmatter";


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

	async import(): Promise<void> {

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
						results.skipped.push(`${file.name} (Archived note)`);
						continue;
					}
					if(keepJson.isTrashed && !this.importTrashed) {
						results.skipped.push(`${file.name} (Deleted note)`);
						continue;
					}
					
					let mdContent = convertJsonToMd(keepJson);
					const fileRef = await this.saveAsMarkdownFile(folder, file.basename, mdContent);
					await addKeepFrontMatter(fileRef, keepJson);					
					
					const writeOptions: DataWriteOptions = {
						ctime: keepJson.createdTimestampUsec/1000,
						mtime: keepJson.userEditedTimestampUsec/1000
					}
					modifyWriteOptions(fileRef, writeOptions);

				} else {
					let assetFolder = await getOrCreateFolder(assetFolderPath);
					// Keep assets have filenames that appear unique, so no duplicate handling isn't implemented
					await copyFile(file, `${assetFolder.path}/${file.name}`);
					
				}
				results.total++;

			} catch (e) {
				console.error(`${file.name} ::: `, e);
				results.failed.push(`${file.name}`);
			}
		}

		this.showResult(results);
	}
}