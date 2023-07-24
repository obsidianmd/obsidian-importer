import { FormatImporter } from "../format-importer";
import { FileSystemAdapter, Notice } from "obsidian";
import * as path from 'path';
import { defaultYarleOptions, dropTheRope } from './yarle/yarle';

export class EvernoteEnexImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Evernote (.enex)', ['enex']);
		this.addOutputLocationSetting('Evernote');
	}

	async import() {
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

		let { app } = this;
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		let yarleOptions = {
			...defaultYarleOptions,
			...{
				enexSources: filePaths,
				outputDir: path.join(adapter.getBasePath(), folder.path),
			}
		};

		let results = await dropTheRope(yarleOptions);

		this.showResult(results);
	}
}
