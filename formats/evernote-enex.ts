import { FileSystemAdapter, Notice } from 'obsidian';
import { path } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { defaultYarleOptions, dropTheRope } from './yarle/yarle';

export class EvernoteEnexImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Evernote', ['enex']);
		this.addOutputLocationSetting('Evernote');
	}

	async import() {
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

		let { app } = this;
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		let yarleOptions = {
			...defaultYarleOptions,
			...{
				enexSources: files,
				outputDir: path.join(adapter.getBasePath(), folder.path),
			}
		};

		let results = await dropTheRope(yarleOptions);

		this.showResult(results);
	}
}
