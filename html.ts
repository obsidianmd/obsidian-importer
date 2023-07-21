import * as fs from 'fs';
import { FormatImporter } from "format-importer";
import { FileSystemAdapter, TFolder, htmlToMarkdown, normalizePath } from "obsidian";
import { pathToFilename, sanitizeFileName } from "./util";
import { ImportResult } from "main";

export class HtmlImporter extends FormatImporter {
	id = 'html';
	name = `HTML (.html)`;
	extensions = ['html'];
	defaultExportFolerName = 'HTML';

	async import(filePaths: string[], outputFolder: string) {
		let { app } = this;
		let adapter = app.vault.adapter;

		if (!(adapter instanceof FileSystemAdapter)) return;

		let results: ImportResult = {
			total: 0,
			skipped: 0,
			failed: 0
		};

		if (outputFolder === '') {
			outputFolder = '/';
		}

		let folder = app.vault.getAbstractFileByPath(outputFolder);

		if (folder === null || !(folder instanceof TFolder)) {
			await app.vault.createFolder(outputFolder);
			folder = app.vault.getAbstractFileByPath(outputFolder);
		}

		for (let path of filePaths) {
			try {
				if (folder instanceof TFolder) {
					let htmlContent = await fs.readFileSync(path, 'utf-8');
					let mdContent = htmlToMarkdown(htmlContent);
					await this.saveAsMarkdownFile(folder, pathToFilename(path), mdContent);
					results.total++;
				}
			} catch (e) {
				console.error(e);
				results.failed++;
			}

		}

		return results;
	}

	// todo: return results
	async saveAsMarkdownFile(folder: TFolder, title: string, content: string) {
		let santizedName = sanitizeFileName(title);
		//@ts-ignore
		await this.app.fileManager.createNewMarkdownFile(folder, santizedName, content);
	}
}
