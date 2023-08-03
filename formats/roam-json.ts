import { FormatImporter } from "../format-importer";
import { FileSystemAdapter, Notice } from "obsidian";
import * as path from 'path';
//import roam stuff here

export class RoamJSONImporter extends FormatImporter {
	init() {
		this.addFileOrFolderChooserSetting('Roam (.json)', ['json']);
		this.addOutputLocationSetting('Roam');
	}

	async import() {
		let { filePaths } = this;
		if (filePaths.length === 0) {
			new Notice('Please pick at least one JSON file to import.');
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

		let roamOptions = {
			...{
				jsonSources: filePaths,
				outputDir: path.join(adapter.getBasePath(), folder.path),
			}
		};

		// let results = await dropTheRope(roamOptions);
		let results
		this.showResult(results);
	}
}
