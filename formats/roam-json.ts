import { FormatImporter } from '../format-importer';
import { FileSystemAdapter, Notice, Setting } from 'obsidian';
import { importRoamJson } from './roam/roam';
import { ProgressReporter } from 'main';

export class RoamJSONImporter extends FormatImporter {
	downloadAttachmentsSetting: Setting;
	downloadAttachments: boolean = false;

	init() {
		this.addFileChooserSetting('Roam (.json)', ['json']);
		this.addOutputLocationSetting('Roam');
		this.modal.contentEl.createEl('h3', { text: 'Import Settings' });

		this.downloadAttachmentsSetting = new Setting(this.modal.contentEl)
			.setName('Download all Attachments')
			.setDesc('If enabled attachments previously uploaded to roam will be downloaded to a local folder. WARNING this can take a large amount of space.')
			.addToggle(toggle => {
				toggle.setValue(this.downloadAttachments);
				toggle.onChange(async (value) => {
					this.downloadAttachments = value;
				});
			});
	}


	async import(progress: ProgressReporter) {
		let { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		let outputFolder = await this.getOutputFolder();
		if (!outputFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		await importRoamJson(this, progress, files, outputFolder, this.downloadAttachments);
	}

	public getUserDNPFormat(): string {
		// @ts-expect-error : Internal Method
		const dailyNotePluginInstance = this.app.internalPlugins.getPluginById('daily-notes').instance;
		if (!dailyNotePluginInstance) {
			console.log('Daily note plugin is not enabled. Roam import defaulting to "YYYY-MM-DD" format.');
			return 'YYYY-MM-DD';
		}

		let dailyPageFormat = dailyNotePluginInstance.options.format;
		return dailyPageFormat || 'YYYY-MM-DD';
	}

}
