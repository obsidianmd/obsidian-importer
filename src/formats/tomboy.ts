import { Notice, Setting } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { TomboyCoreConverter, TomboyNote } from './tomboy-core';

export class TomboyImporter extends FormatImporter {
	private coreConverter = new TomboyCoreConverter();
	private todoEnabled: boolean = true; // Enable by default for testing

	init() {
		this.addFileChooserSetting('Tomboy', ['note'], true);
		this.addOutputLocationSetting('Tomboy import');

		// Add TODO checkbox setting following CONTRIBUTING.md guidance
		new Setting(this.modal.contentEl)
			.setName('Convert TODO lists to checkboxes')
			.setDesc('When enabled, lists in notes with "TODO" in the title will be converted to task lists with checkboxes. Strikethrough items will be marked as completed.')
			.addToggle((toggle: any) => {
				toggle.setValue(this.todoEnabled)
					.onChange((value: boolean) => this.todoEnabled = value);
			});
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

		// Pass TODO setting to core converter
		(this.coreConverter as any).setTodoEnabled?.(this.todoEnabled);

		const markdownContent = this.coreConverter.convertToMarkdown(tomboyNote);
		await this.saveAsMarkdownFile(folder, tomboyNote.title, markdownContent);
	}


}
