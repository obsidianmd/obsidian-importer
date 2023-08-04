import { BlobWriter, TextWriter } from '@zip.js/zip.js';
import { parseFilePath } from 'filesystem';
import { normalizePath, Notice } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportResult } from '../main';

export class Bear2bkImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Bear2bk', ['bear2bk']);
		this.addOutputLocationSetting('Bear');
	}

	async import(): Promise<void> {
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

		let results: ImportResult = {
			total: 0,
			skipped: [],
			failed: []
		};

		const attachmentsFolderPath = await this.createFolders(`${folder.path}/assets`);
		const assetMatcher = /!\[\]\(assets\//g;

		for (let file of files) {
			await file.readZip(async zip => {
				for (let zipFileEntry of await zip.getEntries()) {
					if (!zipFileEntry || zipFileEntry.directory) continue;
					let { filename } = zipFileEntry;
					let { parent, name, basename, extension } = parseFilePath(filename);
					try {
						if (extension === 'md' || extension === 'markdown') {
							const mdFilename = parseFilePath(parent).basename;
							let mdContent = await zipFileEntry.getData(new TextWriter());
							if (mdContent.match(assetMatcher)) {
								// Replace asset paths with new asset folder path.
								mdContent = mdContent.replace(assetMatcher, `![](${attachmentsFolderPath.path}/`);
							}
							let filePath = normalizePath(mdFilename);
							await this.saveAsMarkdownFile(folder, filePath, mdContent);
							results.total++;
						}
						else if (filename.match(/\/assets\//g)) {
							const assetFileVaultPath = `${attachmentsFolderPath.path}/${name}`;
							const existingFile = this.vault.getAbstractFileByPath(assetFileVaultPath);
							if (existingFile) {
								results.skipped.push(filename);
							}
							else {
								const assetData = await zipFileEntry.getData(new BlobWriter());
								await this.vault.createBinary(assetFileVaultPath, await assetData.arrayBuffer());
							}
							results.total++;
						}
						else {
							results.skipped.push(filename);
							results.total++;
						}

					} catch (error) {
						results.failed.push(filename);
					}
				}
			});
		}
		this.showResult(results);
	}
}
