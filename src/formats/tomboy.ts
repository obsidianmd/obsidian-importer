import { Notice, Setting, ToggleComponent, DropdownComponent } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { TomboyCoreConverter } from './tomboy/core';

export class TomboyImporter extends FormatImporter {
	private coreConverter: TomboyCoreConverter;
	private todoEnabled: boolean;
	private keepTitleMode: 'yes' | 'no' | 'automatic';

	init() {
		this.todoEnabled = true;
		this.coreConverter = new TomboyCoreConverter();
		this.keepTitleMode = 'automatic';

		this.addFileChooserSetting('Tomboy', ['note'], true);
		this.addOutputLocationSetting('Tomboy import');

		new Setting(this.modal.contentEl)
			.setName('Convert TODO lists to checkboxes')
			.setDesc('When enabled, lists in notes with "TODO" in the title will be converted to task lists with checkboxes. Strikethrough items will be marked as completed.')
			.addToggle((toggle: ToggleComponent) => {
				toggle.setValue(this.todoEnabled)
					  .onChange((value: boolean) => this.todoEnabled = value);
			});

		new Setting(this.modal.contentEl)
			.setName('Keep title in markdown')
			.setDesc('Choose whether to keep the note title in the markdown content. "Automatic" keeps titles only when special characters are lost in filename conversion.')
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption('automatic', 'Automatic')
					.addOption('yes', 'Yes')
					.addOption('no', 'No')
					.setValue(this.keepTitleMode)
					.onChange((value: string) => this.keepTitleMode = value as 'yes' | 'no' | 'automatic');
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
		this.coreConverter.setTodoEnabled(this.todoEnabled);
		this.coreConverter.setKeepTitleMode(this.keepTitleMode);

		const tomboyNote = this.coreConverter.parseTomboyXML(xmlContent);
		const markdownContent = this.coreConverter.convertToMarkdown(tomboyNote);

		await this.saveAsMarkdownFile(folder, tomboyNote.title, markdownContent);
	}
}
