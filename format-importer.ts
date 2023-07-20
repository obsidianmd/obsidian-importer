import { App } from "obsidian";
import { ImportResult } from "interfaces";

export abstract class FormatImporter {
	app: App;

	constructor(app: App) {
		this.app = app;
	}

	abstract import(filePaths: string[], outputFolder: string): Promise<ImportResult>;
}
