import { FormatImporter } from "../format-importer";
import { Notice, htmlToMarkdown, normalizePath } from "obsidian";
import { pathToFilename } from '../util';
import { ImportResult } from '../main';

export class HtmlImporter extends FormatImporter {
	init() {
		this.addFileOrFolderChooserSetting('HTML (.htm .html)', ['htm', 'html']);
		this.addOutputLocationSetting('HTML');
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

		let results: ImportResult = {
			total: 0,
			skipped: [],
			failed: []
		};

		for (let path of filePaths) {
			try {
				let htmlContent = await this.readPath(path);
				let mdContent = htmlToMarkdown(htmlContent);
				path = normalizePath(path);
				await this.saveAsMarkdownFile(folder, pathToFilename(path), mdContent);
				results.total++;
			} catch (e) {
				console.error(e);
				results.failed.push(path);
			}
		}

		this.showResult(results);
	}
}
