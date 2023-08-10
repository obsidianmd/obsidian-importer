import { normalizePath, Notice } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';
import { readZip } from '../zip';

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
			await readZip(file, async (zip, entries) => {
				for (let entry of entries) {
					let { fullpath, filepath, parent, name, extension } = entry;
					try {
						if (extension === 'md' || extension === 'markdown') {
							const mdFilename = parseFilePath(parent).basename;
							let mdContent = await entry.readText();
							if (mdContent.match(assetMatcher)) {
								// Replace asset paths with new asset folder path.
								mdContent = mdContent.replace(assetMatcher, `![](${attachmentsFolderPath.path}/`);
							}
							let filePath = normalizePath(mdFilename);
							await this.saveAsMarkdownFile(outputFolder, filePath, mdContent);
							progress.reportNoteSuccess(mdFilename);
						}
						else if (filepath.match(/\/assets\//g)) {
							const assetFileVaultPath = `${attachmentsFolderPath.path}/${name}`;
							const existingFile = this.vault.getAbstractFileByPath(assetFileVaultPath);
							if (existingFile) {
								progress.reportSkipped(fullpath);
							}
							else {
								const assetData = await entry.read();
								await this.vault.createBinary(assetFileVaultPath, assetData);
								progress.reportAttachmentSuccess(fullpath);
							}
						}
						else {
							progress.reportSkipped(fullpath);
						}
					}
					catch (e) {
						progress.reportFailed(fullpath, e);
					}
				}
			});
		}
	}
}
