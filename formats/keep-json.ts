import { FormatImporter } from "../format-importer";
import { Notice, normalizePath } from "obsidian";
import { copyFile, getOrCreateFolder, separatePathNameExt } from '../util';
import { ImportResult } from '../main';
import { convertJsonToMd } from "./keep/convert-json-to-md";
import { convertStringToKeepJson } from "./keep/models/KeepJson";

export class KeepImporter extends FormatImporter {
	init() {
		const noteExts = ['json'];
		// Google Keep exports in the original format uploaded, so limiting to only binary formats Obsidian supports
		const attachmentExts = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mpg', 'm4a', 'webm', 'wav', 'ogv', '3gp', 'mov', 'mp4', 'mkv', 'pdf'];

		this.addFileOrFolderChooserSetting('Notes & attachments', [...noteExts, ...attachmentExts]);
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
			new Notice('Please select a location to export to.');
			return;
		}
		let assetFolderPath = `${folder.path}/Assets`;

		let results: ImportResult = {
			total: 0,
			skipped: [],
			failed: []
		};

		for (let srcPath of filePaths) {
			try {
				const fileMeta = separatePathNameExt(srcPath)
				if(fileMeta.ext == 'json') {
					let rawContent = await this.readPath(srcPath);
					let keepJson = convertStringToKeepJson(rawContent);
					let mdContent = convertJsonToMd(keepJson);
					await this.saveAsMarkdownFile(folder, fileMeta.name, mdContent);
				} else {
					let assetFolder = await getOrCreateFolder(assetFolderPath);
					await copyFile(srcPath, `${assetFolder.path}/${fileMeta.name}.${fileMeta.ext}`);
				}
				results.total++;
			} catch (e) {
				console.error(e);
				results.failed.push(srcPath);
			}
		}

		this.showResult(results);
	}
}
