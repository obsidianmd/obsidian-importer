import { FormatImporter } from "format-importer";
import { FileSystemAdapter, TFolder } from "obsidian";
import * as path from 'path';
import { defaultYarleOptions, dropTheRope } from './yarle/yarle';

export class EvernoteEnexImporter extends FormatImporter {
	id = 'evernote-enex';
	name = `Evernote (.enex)`;
	extensions = ['enex'];
	defaultExportFolerName = 'Evernote';
	folder: TFolder;

	async import(filePaths: string[], outputFolder: string) {
		let { app } = this;
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		this.setOutputFolderPath(outputFolder);

		let folder = await this.getOutputFolder();

		let yarleOptions = {
			...defaultYarleOptions,
			...{
				enexSources: filePaths,
				outputDir: path.join(adapter.getBasePath(), folder.path),
			}
		};

		return await dropTheRope(yarleOptions);
	}
}
