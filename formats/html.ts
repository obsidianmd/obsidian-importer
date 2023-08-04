import { htmlToMarkdown, Notice } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';

export class HtmlImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('HTML', ['htm', 'html']);
		this.addOutputLocationSetting('HTML');
	}

	async import(progress: ProgressReporter): Promise<void> {
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

		let i = 0;
		for (let file of files) {
			progress.reportProgress(i, files.length);
			i++;
			try {
				let htmlContent = await file.readText();
				let mdContent = htmlToMarkdown(htmlContent);
				await this.saveAsMarkdownFile(folder, file.basename, mdContent);
				progress.reportNoteSuccess(file.name);
			}
			catch (e) {
				progress.reportFailed(file.name, e);
			}
		}
	}
}
