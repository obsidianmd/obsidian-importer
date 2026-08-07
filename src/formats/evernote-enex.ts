import { FileSystemAdapter, Notice } from 'obsidian';
import { path } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { defaultYarleOptions, dropTheRope } from './yarle/yarle';

export class EvernoteEnexImporter extends FormatImporter {
	/**
	 * Stop lands within a note, from the parser's tag:note listener. Pause
	 * cannot: that listener is synchronous, so the only checkpoint that can be
	 * awaited is between .enex files, and one file is long enough that Pause
	 * would sit there looking broken while notes kept arriving.
	 */
	interruption = 'stop' as const;

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
