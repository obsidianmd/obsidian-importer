import { DataWriteOptions, normalizePath, Notice, TFile } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { readZip, ZipEntryFile } from '../zip';

type Metadata = {
	ctime?: number,
	mtime?: number,
	archived: boolean,
	trashed: boolean,
}

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

		const attachmentsFolder = await this.createFolders(`${folder.path}/assets`);
		const assetMatcher = /!\[\]\(assets\//g;
		const archiveFolder = await this.createFolders(`${folder.path}/archive`);
		const trashFolder = await this.createFolders(`${folder.path}/trash`);

		for (let file of files) {
			if (ctx.isCancelled()) return;
			ctx.status('Processing ' + file.name);
			await readZip(file, async (zip, entries) => {
				const metadataLookup = await this.collectMetadata(entries);
				for (let entry of entries) {
					if (ctx.isCancelled()) return;
					let { fullpath, filepath, parent, name, extension } = entry;
					if (['info.json', 'tags.json'].includes(name)) {
						continue
					}
					ctx.status('Processing ' + name);
					try {
						if (extension === 'md' || extension === 'markdown') {
							const mdFilename = parseFilePath(parent).basename;
							ctx.status('Importing note ' + mdFilename);
							let mdContent = await entry.readText();
							mdContent = this.removeMarkdownHeader(mdFilename, mdContent);
							if (mdContent.match(assetMatcher)) {
								// Replace asset paths with new asset folder path.
								mdContent = mdContent.replace(assetMatcher, `![](${attachmentsFolder.path}/`);
							}
							const filePath = normalizePath(mdFilename);
							const metadata = metadataLookup[parent];
							let targetFolder = outputFolder;
							if (metadata?.archived) {
								targetFolder = archiveFolder;
							} else if (metadata?.trashed) {
								targetFolder = trashFolder;
							}
							const file = await this.saveAsMarkdownFile(targetFolder, filePath, mdContent);
							if (metadata?.ctime && metadata?.mtime) {
								await this.modifFileTimestamps(metadata, file);
							}
							ctx.reportNoteSuccess(mdFilename);
						}
						else if (filepath.match(/\/assets\//g)) {
							ctx.status('Importing asset ' + name);
							const assetFileVaultPath = `${attachmentsFolder.path}/${name}`;
							const existingFile = this.vault.getAbstractFileByPath(assetFileVaultPath);
							if (existingFile) {
								ctx.reportSkipped(fullpath, 'asset with filename already exists');
							}
							else {
								const assetData = await entry.read();
								await this.vault.createBinary(assetFileVaultPath, assetData);
								ctx.reportAttachmentSuccess(fullpath);
							}
						}
						else {
							ctx.reportSkipped(fullpath, 'unknown type of file');
						}
					}
					catch (e) {
						ctx.reportFailed(fullpath, e);
					}
				}
			});
		}
	}

	private async modifFileTimestamps(metaData: Metadata, file: TFile) {
		const writeOptions: DataWriteOptions = {
			ctime: metaData.ctime,
			mtime: metaData.mtime,
		};
		await this.vault.append(file, '', writeOptions);
	}

	private async collectMetadata(entries: ZipEntryFile[]): Promise<{ [key: string]: Metadata; }> {
		let metaData: { [key: string]: Metadata; } = {};
		for (let entry of entries) {
			if (entry.name !== 'info.json') {
				continue;
			}
			const infoJson = await entry.readText();
			const info = JSON.parse(infoJson);

			const bearMetadata = info['net.shinyfrog.bear'];
			const creationDate = Date.parse(bearMetadata.creationDate);
			const modificationDate = Date.parse(bearMetadata.modificationDate);
			metaData[entry.parent] = {
				ctime: isNaN(creationDate) ? undefined : creationDate,
				mtime: isNaN(modificationDate) ? undefined : modificationDate,
				archived: bearMetadata.archived === 1,
				trashed: bearMetadata.trashed === 1,
			};
		}
		return metaData;
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
