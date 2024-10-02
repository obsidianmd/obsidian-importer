import { DataWriteOptions, normalizePath, Notice, TFile } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { readZip, ZipEntryFile } from '../zip';

type Metadata = {
	ctime?: number;
	mtime?: number;
	archived: boolean;
	trashed: boolean;
};

interface AssetMap {
	// Containing note path
	[key: string]: {
		// Asset path -> vault path
		[key: string]: string;
	};
};


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

		// match 1: assets/something.jpg
		// match 2: something.jpg
		const assetMatcher = new RegExp('\\[[^\\]]*\\]\\((assets/([^\\)]+))\\)', 'gm');

		const archiveFolder = await this.createFolders(`${folder.path}/archive`);
		const trashFolder = await this.createFolders(`${folder.path}/trash`);

		for (let file of files) {
			if (ctx.isCancelled()) return;
			ctx.status('Processing ' + file.name);
			await readZip(file, async (zip, entries) => {
				const metadataLookup = await this.collectMetadata(ctx, entries);
				const assetMap = await this.storeAssets(ctx, entries, outputFolder.path);
				for (let entry of entries) {
					if (ctx.isCancelled()) return;
					let { fullpath, filepath, parent, name, extension } = entry;
					if (name === 'info.json' || name === 'tags.json') {
						continue;
					}
					ctx.status('Processing ' + name);
					try {
						if (extension === 'md' || extension === 'markdown') {
							const mdFilename = parseFilePath(parent).basename;
							ctx.status('Importing note ' + mdFilename);
							let mdContent = await entry.readText();
							mdContent = this.removeMarkdownHeader(mdFilename, mdContent);

							const assetMatches = [...mdContent.matchAll(assetMatcher)];
							if (assetMatches.length > 0) {
								const entryAssetMap = assetMap[parent];
								if (entryAssetMap) {
									for (const match of assetMatches) {
										const [ fullMatch, linkPath, assetName ] = match;
										const replacementPath = entryAssetMap[assetName];
										if (replacementPath) {
											const replacement = fullMatch.replace(linkPath, replacementPath);
											mdContent = mdContent.replace(fullMatch, replacement);
										}
									}
								}
							}

							const filePath = normalizePath(mdFilename);
							const metadata = metadataLookup[parent];
							let targetFolder = outputFolder;
							if (metadata?.archived) {
								targetFolder = archiveFolder;
							}
							else if (metadata?.trashed) {
								targetFolder = trashFolder;
							}
							const file = await this.saveAsMarkdownFile(targetFolder, filePath, mdContent);
							if (metadata?.ctime && metadata?.mtime) {
								await this.modifFileTimestamps(metadata, file);
							}
							ctx.reportNoteSuccess(mdFilename);
						}
						else if (filepath.match(/\/assets\//g)) {
							// Assets were already imported
							continue;
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

	private async collectMetadata(ctx: ImportContext, entries: ZipEntryFile[]): Promise<{ [key: string]: Metadata }> {
		let metaData: { [key: string]: Metadata } = {};
		for (let entry of entries) {
			if (ctx.isCancelled()) return metaData;

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

	/** Iterate the files and store files in the assets directories, recording a mapping to where they end up in the vault. */
	private async storeAssets(ctx: ImportContext, entries: ZipEntryFile[], notesOutputFolderPath: string): Promise<AssetMap> {
		const assetsMap: AssetMap = {};
		for (let entry of entries) {
			if (ctx.isCancelled()) return assetsMap;

			if (!entry.filepath.match(/\/assets\//g)) {
				continue;
			}

			ctx.status('Importing asset ' + entry.name);
			const outputPath = await this.app.fileManager.getAvailablePathForAttachment(entry.name, notesOutputFolderPath);
			const assetData = await entry.read();
			const assetFile = await this.vault.createBinary(outputPath, assetData);
			ctx.reportAttachmentSuccess(entry.fullpath);

			// Remove '/assets' to get the parent folder for the note this asset belongs to.
			const parent = parseFilePath(entry.parent).parent;
			let parentMap = assetsMap[parent];
			if (!parentMap) {
				assetsMap[parent] = parentMap = {};
			}

			// We can't have spaces in the asset path.
			const mapPath = this.app.metadataCache.fileToLinktext(assetFile, notesOutputFolderPath, false);
			parentMap[entry.name] = encodeURI(mapPath);
		}
		return assetsMap;
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
