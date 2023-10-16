import { normalizePath, Notice } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { readZip } from '../zip';

export class Bear2bkImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Bear2bk', ['bear2bk']);
		this.addOutputLocationSetting('Bear');
	}

	async import(ctx: ImportContext): Promise<void> {
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
			if (ctx.isCancelled()) return;
			ctx.status('Processing ' + file.name);
			await readZip(file, async (zip, entries) => {
				for (let entry of entries) {
					if (ctx.isCancelled()) return;
					let { fullpath, filepath, parent, name, extension } = entry;
					ctx.status('Processing ' + name);
					try {
						if (extension === 'md' || extension === 'markdown') {
							const mdFilename = parseFilePath(parent).basename;
							ctx.status('Importing note ' + mdFilename);
							let mdContent = await entry.readText();
							mdContent = this.removeMarkdownHeader(mdFilename, mdContent);
							if (mdContent.match(assetMatcher)) {
								// Replace asset paths with new asset folder path.
								mdContent = mdContent.replace(assetMatcher, `![](${attachmentsFolderPath.path}/`);
							}
							let filePath = normalizePath(mdFilename);
							await this.saveAsMarkdownFile(outputFolder, filePath, mdContent);
							ctx.reportNoteSuccess(mdFilename);
						}
						else if (filepath.match(/\/assets\//g)) {
							ctx.status('Importing asset ' + name);
							const assetFileVaultPath = `${attachmentsFolderPath.path}/${name}`;
							const existingFile = this.vault.getAbstractFileByPath(assetFileVaultPath);
							if (existingFile) {
								ctx.reportSkipped(fullpath);
							}
							else {
								const assetData = await entry.read();
								await this.vault.createBinary(assetFileVaultPath, assetData);
								ctx.reportAttachmentSuccess(fullpath);
							}
						}
						else {
							ctx.reportSkipped(fullpath);
						}
					}
					catch (e) {
						ctx.reportFailed(fullpath, e);
					}
				}
			});
		}
	}

	/** Removes an H1 that is the first line of the content iff it matches the filename or is empty. */
	private removeMarkdownHeader(mdFilename: string, mdContent: string): string {
		if (!mdContent.startsWith('# ')) {
			return mdContent;
		}

		const idx = mdContent.indexOf('\n');
		let heading = idx > 0
			? mdContent.substring(2, idx)
			: mdContent.substring(2);
		heading = heading.trim();

		if (heading !== mdFilename.trim() && heading !== '') {
			return mdContent;
		}

		return idx > 0
			? mdContent.substring(idx + 1)
			: '';
	}
}
