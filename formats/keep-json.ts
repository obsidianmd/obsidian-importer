import { FormatImporter } from "../format-importer";
import { DataWriteOptions, Notice, Setting, normalizePath } from "obsidian";
import { copyFile, getOrCreateFolder, separatePathNameExt } from '../util';
import { ImportResult } from '../main';
import { convertJsonToMd } from "./keep/convert-json-to-md";
import { convertStringToKeepJson } from "./keep/models/KeepJson";

export class KeepImporter extends FormatImporter {
	importArchivedSetting: Setting;
	importTrashedSetting: Setting;
	importArchived: boolean = false;
	importTrashed: boolean = false;

	init() {
		const noteExts = ['json'];
		// Google Keep exports in the original format uploaded, so limiting to only binary formats Obsidian supports
		const attachmentExts = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mpg', 'm4a', 'webm', 'wav', 'ogv', '3gp', 'mov', 'mp4', 'mkv', 'pdf'];

		this.addFileChooserSetting('Notes & attachments', [...noteExts, ...attachmentExts]);

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
		let { filePaths } = this;
		if (filePaths.length === 0) {
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

		for (let srcPath of filePaths) {
			const fileMeta = separatePathNameExt(srcPath)
			try {
				if(fileMeta.ext == 'json') {
					let rawContent = await this.readPath(srcPath);
					let keepJson = convertStringToKeepJson(rawContent);
					
					if(keepJson.isArchived && !this.importArchived) {
						results.skipped.push(`${fileMeta.name}.${fileMeta.ext} (Archived note)`);
						continue;
					}
					if(keepJson.isTrashed && !this.importTrashed) {
						results.skipped.push(`${fileMeta.name}.${fileMeta.ext} (Deleted note)`);
						continue;
					}
					
					let mdContent = convertJsonToMd(keepJson);
					
					const writeOptions: DataWriteOptions = {
						ctime: keepJson.createdTimestampUsec/1000,
						mtime: keepJson.userEditedTimestampUsec/1000
					}
					await this.saveAsMarkdownFile(folder, fileMeta.name, mdContent, writeOptions);
					
				} else {
					let assetFolder = await getOrCreateFolder(assetFolderPath);
					await copyFile(srcPath, `${assetFolder.path}/${fileMeta.name}.${fileMeta.ext}`);
					
				}
				results.total++;
			} catch (e) {
				console.error(e);
				results.failed.push(`${fileMeta.name}.${fileMeta.ext}`);
			}
		}

		this.showResult(results);
	}
}
