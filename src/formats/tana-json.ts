import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { Notice } from 'obsidian';
import { TanaGraphImporter } from './tana/tana-import';

export class TanaJSONImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Tana (.json)', ['json']);
	}

	async import(progress: ImportContext) {
		let { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		const importer = new TanaGraphImporter();

		for (let file of files) {
			const data = await file.readText();
			importer.importTanaGraph(data);
			if (importer.fatalError) {
				new Notice(importer.fatalError);
				return;
			}
		}

		const totalCount = importer.result.size;
		let index = 1;
		for (const [filename, markdownOutput] of importer.result) {
			if (progress.isCancelled()) {
				return;
			}
			try {
				await this.vault.create(filename, markdownOutput);
				progress.reportNoteSuccess(filename);
				progress.reportProgress(index, totalCount);
			}
			catch (error) {
				console.error('Error saving Markdown to file:', filename, error);
				progress.reportFailed(filename);
			}
			index++;
		}
	}
}
