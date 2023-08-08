import { BlobWriter, TextWriter } from '@zip.js/zip.js';
import { parseFilePath } from 'filesystem';
import { normalizePath, Notice } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';

export class Bear2bkImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Bear2bk', ['bear2bk']);
		this.addOutputLocationSetting('Bear');
	}

	async import(progress: ProgressReporter): Promise<void> {
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

		let outputFolder = folder;

		const attachmentsFolderPath = await this.createFolders(`${folder.path}/assets`);
		const assetMatcher = /!\[\]\(assets\//g;

		for (let file of files) {
			await file.readZip(async zip => {
				for (let entry of await zip.getEntries()) {
					if (!entry || entry.directory || !entry.getData) continue;
					let { filename } = entry;
					let { parent, name, extension } = parseFilePath(filename);
					try {
						if (extension === 'md' || extension === 'markdown') {
							const mdFilename = parseFilePath(parent).basename;
							let mdContent = await entry.getData(new TextWriter());
							if (mdContent.match(assetMatcher)) {
								// Replace asset paths with new asset folder path.
								mdContent = mdContent.replace(assetMatcher, `![](${attachmentsFolderPath.path}/`);
							}
							let filePath = normalizePath(mdFilename);
							await this.saveAsMarkdownFile(outputFolder, filePath, mdContent);
							progress.reportNoteSuccess(mdFilename);
						}
						else if (filename.match(/\/assets\//g)) {
							const assetFileVaultPath = `${attachmentsFolderPath.path}/${name}`;
							const existingFile = this.vault.getAbstractFileByPath(assetFileVaultPath);
							if (existingFile) {
								progress.reportSkipped(filename);
							}
							else {
								const assetData = await entry.getData(new BlobWriter());
								await this.vault.createBinary(assetFileVaultPath, await assetData.arrayBuffer());
								progress.reportAttachmentSuccess(filename);
							}
						}
						else {
							progress.reportSkipped(filename);
						}
					}
					catch (e) {
						progress.reportFailed(filename, e);
					}
				}
			});
		}
	}
}
