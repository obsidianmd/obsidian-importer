import { DataWriteOptions, normalizePath, Notice, TFile } from 'obsidian';
import { path, parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { readZip, ZipEntryFile } from '../zip';

type Metadata = {
	ctime?: number;
	mtime?: number;
	archived: boolean;
	trashed: boolean;
};

export class Bear2bkImporter extends FormatImporter {
	private attachmentMap: Record<string, string> = {};

	init() {
		this.addFileChooserSetting('Bear2bk', ['bear2bk']);
		this.addOutputLocationSetting('Bear');
	}

	private extractTagsFromContent(content: string): string[] {
		const tags = new Set<string>();

		// 1. Extract #enclosed/tags# (can contain spaces and slashes, but content should be single-line)
		const enclosedTagRegex = /#([^\n#]+?)#/g; // Changed [^#] to [^\n#] to disallow newlines in tag content
		let matchEnclosed;
		while ((matchEnclosed = enclosedTagRegex.exec(content)) !== null) {
			const rawEnclosedTag = matchEnclosed[1].trim();
			if (rawEnclosedTag) {
				const parts = rawEnclosedTag.split('/');
				for (const part of parts) {
					const cleanPart = part.trim();
					if (cleanPart) {
						tags.add(cleanPart);
					}
				}
			}
		}

		// 2. Extract simple #tags (alphanumeric, underscore, hyphen, and slash, no spaces)
		//    Ensures it's not part of a URL or an already processed enclosed tag.
		//    Allows / in the middle of the tag, but not at the start or end of the simple tag.
		const simpleTagRegex = /(?<!\S)#([a-zA-Z0-9_][a-zA-Z0-9_/\-]*[a-zA-Z0-9_]|[a-zA-Z0-9_]+)(?![#\w/])/g;
		let matchSimple;
		while ((matchSimple = simpleTagRegex.exec(content)) !== null) {
			const rawSimpleTag = matchSimple[1].trim(); 
			if (rawSimpleTag) {
				const parts = rawSimpleTag.split('/');
				for (const part of parts) {
					const cleanPart = part.trim();
					if (cleanPart) {
						tags.add(cleanPart);
					}
				}
			}
		}

		const finalTags = Array.from(tags);
		return finalTags;
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
		const assetMatcher = new RegExp('\\[[^\\]]*\\]\\((assets/[^\\)]+)\\)', 'gm');

		const archiveFolder = await this.createFolders(`${folder.path}/archive`);
		const trashFolder = await this.createFolders(`${folder.path}/trash`);

		for (let file of files) {
			if (ctx.isCancelled()) return;
			ctx.status('Processing ' + file.name);
			await readZip(file, async (zip, entries) => {
				const metadataLookup = await this.collectMetadata(ctx, entries);
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
								for (const match of assetMatches) {
									const [ fullMatch, linkPath ] = match;
									let assetPath = path.join(parent, decodeURI(linkPath));
									let replacementPath = await this.getAttachmentStoragePath(assetPath);

									// Don't allow spaces in the file name.
									replacementPath = encodeURI(replacementPath);

									// NOTE: We can't use metadataCache.fileToLinktext to potentially shorten
									// the path because the attachment might not yet exist, so we can't get a TFile.

									const replacement = fullMatch.replace(linkPath, replacementPath);
									mdContent = mdContent.replace(fullMatch, replacement);
								}
							}

							// Extract tags from content
							const tags = this.extractTagsFromContent(mdContent);

							// Use just the filename without extension
							const fileName = mdFilename;
							const metadata = metadataLookup[parent];
							let targetFolder = outputFolder;
							if (metadata?.archived) {
								targetFolder = archiveFolder;
							}
							else if (metadata?.trashed) {
								targetFolder = trashFolder;
							}

							const file = await this.saveAsMarkdownFile(targetFolder, fileName, mdContent);
							
							if (metadata?.ctime || metadata?.mtime || tags.length > 0) {
								await this.updateNoteFile(metadata, file, mdContent, tags);
							}
							
							ctx.reportNoteSuccess(mdFilename);
						}
						else if (filepath.match(/\/assets\//g)) {
							ctx.status('Importing asset ' + entry.name);
							const outputPath = await this.getAttachmentStoragePath(entry.filepath);
							const assetData = await entry.read();

							const writeOptions: DataWriteOptions = {};
							if (entry.ctime) {
								writeOptions.ctime = entry.ctime.getTime();
							}
							if (entry.mtime) {
								writeOptions.mtime = entry.mtime.getTime();
							}

							if (Object.keys(writeOptions).length > 0) {
								await this.vault.createBinary(outputPath, assetData, writeOptions);
							}
							else {
								await this.vault.createBinary(outputPath, assetData);
							}
							
							ctx.reportAttachmentSuccess(entry.fullpath);
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

	private async updateNoteFile(metaData: Metadata | undefined, file: TFile, content: string, tags: string[]): Promise<string> {
		// Format dates in the specified format: YYYY-MM-DDThh:mm:ss
		const frontmatter: Record<string, any> = {}; // Changed to Record<string, any> for tags array
		if (metaData?.ctime) {
			frontmatter['created'] = new Date(metaData.ctime).toISOString().slice(0, 19);
		}
		if (metaData?.mtime) {
			frontmatter['modified'] = new Date(metaData.mtime).toISOString().slice(0, 19);
		}

		if (tags.length > 0) {
			frontmatter['tags'] = tags;
		}

		// Add frontmatter to content only if there's something to add
		let contentWithFrontmatter = content;
		if (Object.keys(frontmatter).length > 0) {
			const frontmatterString = Object.entries(frontmatter)
				.map(([key, value]) => {
					if (Array.isArray(value)) { // Handle tags array
						return `${key}:\n  - ${value.join('\n  - ')}`;
					}
					return `${key}: ${value}`;
				})
				.join('\n');
			
			contentWithFrontmatter = `---\n${frontmatterString}\n---\n\n${content}`;
		}


		// Still set the file system timestamps
		const writeOptions: DataWriteOptions = {
			ctime: metaData?.ctime,
			mtime: metaData?.mtime,
		};
		
		// Write the content with frontmatter
		await this.vault.modify(file, contentWithFrontmatter, writeOptions);
		
		return contentWithFrontmatter;
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

	/**
	 * Return a filepath for the provided asset. The filepath will not collide
	 * with other assets existing in the vault or named using this function,
	 * even if the file has not yet been created.
	 */
	private async getAttachmentStoragePath(attachmentPath: string): Promise<string> {
		const normalizedPath = normalizePath(attachmentPath);

		if (this.attachmentMap[normalizedPath]) {
			return this.attachmentMap[normalizedPath];
		}

		const usedPaths = Object.values(this.attachmentMap);
		let outputPath = await this.getAvailablePathForAttachment(normalizedPath, usedPaths);
		// Colons are not allowed in Obsidian file paths.
		outputPath = outputPath.replace(/:/g, '');
		this.attachmentMap[normalizedPath] = outputPath;
		return outputPath;
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
