import * as fs from 'fs';
import { App, FileSystemAdapter, TFile, TFolder, normalizePath } from "obsidian";
import { ImportResult } from "main";
import { pathToFilename, sanitizeFileName } from "./util";

export abstract class FormatImporter {
	app: App;

	id: string;
	name: string;
	extensions: string[];
	defaultExportFolerName: string;

	transformors: Array<(input: string, path: string) => string | Promise<string>>;
	postProcessors: Array<(originalFileList: string[], outputMarkdownFileList: string[]) => void>;

	outputFolderPath: string;

	constructor(app: App) {
		this.app = app;

		this.transformors = [];
		this.postProcessors = [];

		this.outputFolderPath = this.defaultExportFolerName;
	}

	setOutputFolderPath(folderPath: string) {
		if (folderPath === '') {
			folderPath = '/';
		}

		this.outputFolderPath = folderPath;
	}

	// Using `addTransformer` to add a transformer function is the simplest way to perform an import
	// by transform each file in their original format to Markdown `input: string` is the content of
	// each file we're importing from the returned string is the content in each imported Markdown

	// Note: you can add multiple transformers; they will be executed in the order that they're added
	// For example, you might want to sanitize each file before

	// If you want to skip a file, return `null`.
	// If you want to create an empty Markdown file, return an empty string instead.
	addTransformer(transformer: (input: string, path: string) => null | string | Promise<string>) {
		this.transformors.push(transformer);
	}

	// Add post processors to make further changes after an initial pass done by transformors
	// For example, you might want to do some cross referencing to fix the internal links or
	// media links after converting everything to Markdown
	// In Post Processors, it's common to make use of helper functions like `readMarkdownOutput`,
	// `editMarkdownOutput`, and `replaceInMarkdownOutput` to fix up Markdown output
	addPostProcessor(postProcessor: (originalFileList: string[], outputMarkdownFileList: string[]) => void) {
		this.postProcessors.push(postProcessor);
	}

	// Read the Markdown output by path. DO NOT use this function in transformers; only use it in post processors.
	// `path` is relative to the exported folder
	async readMarkdownOutput(path: string): Promise<string> | null {
		let { app } = this;
		let file = this.getFileByPath(path);

		return await app.vault.cachedRead(file);
	}

	async editMarkdownOutput(path: string, newContent: string) {
		let { app } = this;
		let file = this.getFileByPath(path);

		return await app.vault.modify(file, newContent);
	}

	async replaceInMarkdownOutput(path: string, pattern: string | RegExp, replacement: string) {
		let content = await this.readMarkdownOutput(path);
		let newContent = content.replace(pattern, replacement);

		await this.editMarkdownOutput(path, newContent);
	}

	// If you have already defined transformers and post processors, you can leave this alone
	// You can handle everything yourself by overriding the `import` function
	// Or you can call `super.import(filePaths, outputFolder)` inside your `import` function
	// to still let the transformers and post processors run, but also add your own logic
	async import(filePaths: string[], outputFolder: string): Promise<ImportResult> {
		let { app } = this;
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		this.setOutputFolderPath(outputFolder);

		let folder = await this.getOutputFolder();

		let fileList = this.listInputFiles();
		let result: ImportResult = { total: 0, failed: 0, skipped: 0 }
		for (let transformor of this.transformors) {
			for (let path of filePaths) {
				try {
					let originalContent = await fs.readFileSync(path, 'utf-8');
					let transformedContent = await transformor(originalContent, path);
					if (transformedContent === null) {
						result.skipped++;

					}
					else {
						path = normalizePath(path);
						this.saveAsMarkdownFile(folder, pathToFilename(path), transformedContent);
					}

					result.total++;
				}
				catch (e) {
					console.error(e);
					result.failed++;
				}
			}
		}

		let inputFiles = this.listInputFiles();
		let outputFiles = this.listOutputFiles();
		for (let postProcessor of this.postProcessors) {
			postProcessor(inputFiles, outputFiles);
		}

		return result;
	}

	async getOutputFolder(): Promise<TFolder> | null {
		let folder = app.vault.getAbstractFileByPath(this.outputFolderPath);

		if (folder === null || !(folder instanceof TFolder)) {
			await app.vault.createFolder(this.outputFolderPath);
			folder = app.vault.getAbstractFileByPath(this.outputFolderPath);
		}

		if (folder instanceof TFolder) {
			return folder;
		}

		return null;
	}

	private getFileByPath(path: string): TFile | null {
		let { app } = this;
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		let file = app.vault.getAbstractFileByPath(this.outputFolderPath + '/' + path);

		if (file instanceof TFile) {
			return file;
		}

		return null;
	}

	private listInputFiles(): string[] {
		return [];
	}

	private listOutputFiles(): string[] {
		return [];
	}

	// todo: return results
	async saveAsMarkdownFile(folder: TFolder, title: string, content: string) {
		let santizedName = sanitizeFileName(title);
		//@ts-ignore
		await this.app.fileManager.createNewMarkdownFile(folder, santizedName, content);
	}
}
