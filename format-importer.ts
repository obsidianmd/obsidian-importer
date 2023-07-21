import { App } from "obsidian";
import { ImportResult } from "main";

export abstract class FormatImporter {
	app: App;

	id: string;
	name: string;
	extensions: string[];
	defaultExportFolerName: string;

	constructor(app: App) {
		this.app = app;
	}

	abstract import(filePaths: string[], outputFolder: string): Promise<ImportResult>;
}
