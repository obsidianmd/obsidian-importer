import { FileSystemAdapter, Notice } from 'obsidian';
import { path } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { defaultYarleOptions, dropTheRope } from './yarle/yarle';

export class EvernoteEnexImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Evernote', ['enex'], true);
		this.addOutputLocationSetting('Evernote');
	}

	async import(ctx: ImportContext) {
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
			},
		};

		await dropTheRope(yarleOptions, ctx);
	}
}
