import { htmlToMarkdown, Notice } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportResult } from '../main';

export class HtmlImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('HTML', ['htm', 'html']);
		this.addOutputLocationSetting('HTML');
	}

	async import(): Promise<void> {
		let { files } = this;
		if (files.length === 0) {
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

		for (let file of files) {
			try {
				let htmlContent = await file.readText();
				let mdContent = htmlToMarkdown(htmlContent);
				await this.saveAsMarkdownFile(folder, file.basename, mdContent);
				results.total++;
			} catch (e) {
				console.error(e);
				results.failed.push(file.toString());
			}
		}

		this.showResult(results);
	}
}
