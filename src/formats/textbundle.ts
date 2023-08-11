import { normalizePath, Notice } from 'obsidian';
import { parseFilePath, NodePickedFolder, NodePickedFile } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';

export class TextbundleImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Textbundle', ['textbundle']);
		this.addOutputLocationSetting('Textbundle');
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
			let textbundleFolder = new NodePickedFolder(`${file.toString()}/`);
			let entries = await textbundleFolder.list();
			for (let entry of entries) {
				let { parent, basename, extension, name } = parseFilePath(entry.toString());
				try {
					if (extension === 'md' || extension === 'markdown') {
						// Parse parent of file to get the file name.
						let mdFilename = parseFilePath(parent.replace('textbundle', 'md')).basename;
						let mdContent = await (entry as NodePickedFile).readText();
						if (mdContent.match(assetMatcher)) {
							// Replace asset paths with new asset folder path.
							mdContent = mdContent.replace(assetMatcher, `![](${attachmentsFolderPath.path}/`);
						}
						let filePath = normalizePath(mdFilename);
						await this.saveAsMarkdownFile(outputFolder, filePath, mdContent);
						progress.reportNoteSuccess(mdFilename);
					}
					else if (basename === 'assets') {
						let assetFolder = new NodePickedFolder(`${entry.toString()}/`);
						let entries = await assetFolder.list();
						for (let entry of entries) {
							let assetFileVaultPath = `${attachmentsFolderPath.path}/${entry.name}`;
							let existingFile = this.vault.getAbstractFileByPath(assetFileVaultPath);
							if (existingFile) {
								progress.reportSkipped(entry.name, 'the file already exists.');
							}
							else if (entry instanceof NodePickedFile) {
								let assetData = await entry.read();
								await this.vault.createBinary(assetFileVaultPath, assetData);
								progress.reportAttachmentSuccess(entry.name);
							}
							else {
								progress.reportSkipped(entry.name);
							}
						}
					}
					else {
						progress.reportSkipped(name, 'the file is not a media or markdown file.');
					}
				}
				catch (e) {
					progress.reportFailed(name, e);
				}
			}
		}
	}
}
