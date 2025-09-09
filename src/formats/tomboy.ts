import { Notice } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { TomboyCoreConverter, TomboyNote } from './tomboy-core';

export class TomboyImporter extends FormatImporter {
	private coreConverter = new TomboyCoreConverter();

	init() {
		this.addFileChooserSetting('Tomboy', ['note'], true);
		this.addOutputLocationSetting('Tomboy import');
	}

	async import(ctx: ImportContext): Promise<void> {
		const { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		ctx.reportProgress(0, files.length);
		for (let i = 0; i < files.length; i++) {
			if (ctx.isCancelled()) return;

			const file = files[i];
			ctx.status('Processing ' + file.name);
			try {
				await this.processFile(ctx, folder, file);
				ctx.reportNoteSuccess(file.fullpath);
			} catch (e) {
				ctx.reportFailed(file.fullpath, e);
			}

			ctx.reportProgress(i + 1, files.length);
		}
	}

	private async processFile(ctx: ImportContext, folder: any, file: any): Promise<void> {
		const xmlContent = await file.readText();
		const tomboyNote = this.coreConverter.parseTomboyXML(xmlContent);
		const markdownContent = this.coreConverter.convertToMarkdown(tomboyNote);
		await this.saveAsMarkdownFile(folder, tomboyNote.title, markdownContent);
	}


}
