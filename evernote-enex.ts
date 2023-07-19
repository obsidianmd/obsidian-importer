import { FormatImporter } from "format-importer";
import { App, FileSystemAdapter, TFolder } from "obsidian";
import * as path from 'path';
import { defaultYarleOptions, dropTheRope } from 'yarle/yarle';

export class EvernoteEnexImporter extends FormatImporter {
	app: App;
	folderPath: string;
	folder: TFolder;

	async import(filePaths: string[], outputFolder: string) {
		let { app } = this;
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		this.folderPath = outputFolder;

		if (this.folderPath === '') {
			this.folderPath = '/';
		}

		let folder = app.vault.getAbstractFileByPath(this.folderPath);

		if (folder === null || !(folder instanceof TFolder)) {
			await app.vault.createFolder(this.folderPath);
			folder = app.vault.getAbstractFileByPath(this.folderPath);
		}

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