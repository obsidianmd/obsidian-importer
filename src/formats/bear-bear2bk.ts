import { DataWriteOptions, normalizePath, Notice, TFile, Setting } from 'obsidian';
import { path, parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { readZip, ZipEntryFile } from '../zip';

type Metadata = {
	id: string;
	ctime?: number;
	mtime?: number;
	archivedtime?: number;
	trashedtime?: number;
};

type IDMappingValue = {
	filename: string;
	metadata: Metadata;
	file: TFile;
};

export class Bear2bkImporter extends FormatImporter {
	private attachmentMap: Record<string, string> = {};
	private flattenTags: boolean = false;
	private storeId: boolean = false;

	private static readonly alphaStart = /^[A-Za-zÀ-ÖØ-öø-įĴ-őŔ-žǍ-ǰǴ-ǵǸ-țȞ-ȟȤ-ȳɃɆ-ɏḀ-ẞƀ-ƓƗ-ƚƝ-ơƤ-ƥƫ-ưƲ-ƶẠ-ỿ]/;
	private static readonly nonAlphaStart = /^[0-9_\-]/;
	private static readonly invalidChar = /[^A-Za-zÀ-ÖØ-öø-įĴ-őŔ-žǍ-ǰǴ-ǵǸ-țȞ-ȟȤ-ȳɃɆ-ɏḀ-ẞƀ-ƓƗ-ƚƝ-ơƤ-ƥƫ-ưƲ-ƶẠ-ỿ0-9_\/-]/;
	private static readonly hexColorTag = /^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
	private static readonly tagCandidate = /(?<!\S)#([^\s#]+)/g;
	private static readonly tagNormalizationMatcher = /(?<!\S)#([0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)(?=\s|$|[^A-Za-z0-9_\/-])#?|#(?!\s)((?:(?!\s#)[^\n#])*?\S)#(?=\S)|#(?!\s)((?:(?!\s#)[^\n#])*?\S)#|(?<!\S)#([^\s#]+)/g;
	private static readonly assetMatcher = /\[[^\]]*\]\((assets\/[^\)]+)\)/gm;
	private static readonly bearLinkMatcher = /bear:\/\/x-callback-url\/open-note\?id=([A-Z0-9\-]+)/g;
	private static readonly numericOnly = /^\d+$/;
	private static readonly collapseUnderscores = /_+/g;

	init() {
		this.addFileChooserSetting('Bear2bk', ['bear2bk']);
		this.addOutputLocationSetting('Bear');

		new Setting(this.modal.contentEl)
			.setName('Flatten nested tags')
			.setDesc(
				'When enabled, tags will be split on slashes (/) during import.'
			)
			.addToggle(t => t
				.setValue(false)
				.onChange(async v => this.flattenTags = v)
			);

		new Setting(this.modal.contentEl)
			.setName('Store note identifiers in front matter')
			.setDesc(
				'Links will be automatically updated. Enable this if the note identifier is used outside of linking between notes.'
			)
			.addToggle(t => t
				.setValue(false)
				.onChange(async v => this.storeId = v)
			);
	}

	private normalizeSimpleTag(rawTag: string): string | null {
		if (!rawTag) {
			return null;
		}

		if (this.isHexColorTag(rawTag)) {
			return null;
		}

		const { alphaStart, nonAlphaStart, invalidChar } = Bear2bkImporter;

		if (alphaStart.test(rawTag)) {
			let cleanTag = rawTag.replace(invalidChar, '_');
			cleanTag = cleanTag.replace(Bear2bkImporter.collapseUnderscores, '_');
			return cleanTag;
		}

		if (nonAlphaStart.test(rawTag)) {
			if (invalidChar.test(rawTag)) {
				return null;
			}
			if (Bear2bkImporter.numericOnly.test(rawTag)) {
				return null;
			}
			return rawTag;
		}

		return null;
	}

	private splitTrailingPunctuation(rawTag: string): { tag: string; trailing: string } | null {
		const match = rawTag.match(/^(.*?)([.,]+)$/);
		if (!match) {
			return null;
		}
		if (match[1] === '') {
			return null;
		}
		return { tag: match[1], trailing: match[2] };
	}

	private normalizeEnclosedTag(tag: string, match: string, addTrailingSpace: boolean): string {
		if (/\s#$/.test(match)) {
			return match;
		}
		const normalizedSingle = tag.replace(/\s+/g, '_');
		const normalized = this.normalizeSimpleTag(normalizedSingle);
		if (!normalized) {
			return match;
		}
		return '#' + normalized + (addTrailingSpace ? ' ' : '');
	}

	private isHexColorTag(rawTag: string): boolean {
		return Bear2bkImporter.hexColorTag.test(rawTag);
	}

	private transformOutsideCodeBlocks(content: string, transformLine: (line: string) => string): string {
		const out: string[] = [];
		let inCode = false;
		let lineStart = 0;
		const length = content.length;

		const isCodeFenceLine = (lineValue: string): boolean => {
			let idx = 0;
			while (idx < lineValue.length) {
				const code = lineValue.charCodeAt(idx);
				if (code !== 32 && code !== 9) {
					break;
				}
				idx += 1;
			}
			return lineValue.startsWith('```', idx);
		};

		for (let i = 0; i <= length; i += 1) {
			const atLineEnd = i === length || content.charCodeAt(i) === 10;
			if (!atLineEnd) {
				continue;
			}

			if (i === length && lineStart === length) {
				break;
			}

			const line = content.slice(lineStart, i);
			if (isCodeFenceLine(line)) {
				inCode = !inCode;
				out.push(line);
			}
			else if (inCode) {
				out.push(line);
			}
			else {
				out.push(this.transformOutsideInlineCode(line, transformLine));
			}

			if (i < length) {
				out.push('\n');
			}
			lineStart = i + 1;
		}

		return out.join('');
	}

	private transformOutsideInlineCode(line: string, transformLine: (line: string) => string): string {
		let inInline = false;
		let currentStart = 0;
		const parts: string[] = [];

		for (let i = 0; i < line.length; i += 1) {
			if (line[i] !== '`') {
				continue;
			}

			if (!inInline) {
				parts.push(transformLine(line.slice(currentStart, i)));
				inInline = true;
			}
			else {
				parts.push('`' + line.slice(currentStart, i) + '`');
				inInline = false;
			}
			currentStart = i + 1;
		}

		if (inInline) {
			return line;
		}

		parts.push(transformLine(line.slice(currentStart)));
		return parts.join('');
	}

	private extractTagsFromContent(content: string): string[] {
		const tags = new Set<string>();
		const isNumericOnly = (value: string) => Bear2bkImporter.numericOnly.test(value);
		const tagCandidateRegex = Bear2bkImporter.tagCandidate;

		this.transformOutsideCodeBlocks(content, (line) => {
			let match;
			tagCandidateRegex.lastIndex = 0;
			while ((match = tagCandidateRegex.exec(line)) !== null) {
				const rawTag = match[1];
				const splitTag = this.splitTrailingPunctuation(rawTag);
				const normalizedTag = this.normalizeSimpleTag(splitTag ? splitTag.tag : rawTag);
				if (!normalizedTag) {
					continue;
				}

				if (this.flattenTags && normalizedTag.includes('/')) {
					const parts = normalizedTag.split('/');
					for (const part of parts) {
						if (part !== '' && !isNumericOnly(part)) {
							tags.add(part);
						}
					}
				}
				else if (!isNumericOnly(normalizedTag)) {
					tags.add(normalizedTag);
				}
			}
			return line;
		});

		return Array.from(tags);
	}

	async import(ctx: ImportContext): Promise<void> {

		// Keep track of Bear IDs to new Obsidian file names to update links based on the identifier
		let idMapping: Record<string, IDMappingValue> = {};

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
		const assetMatcher = Bear2bkImporter.assetMatcher;

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
					if (name === 'info.json' || name === 'tags.json' || name === 'backup.json') {
						continue;
					}
					ctx.status('Processing ' + name);
					try {
						if (extension === 'md' || extension === 'markdown') {
							const mdFilename = parseFilePath(parent).basename;
							ctx.status('Importing note ' + mdFilename);
							let mdContent = await entry.readText();
							mdContent = this.removeMarkdownHeader(mdFilename, mdContent);
							mdContent = this.fixListIndentation(mdContent);

							const assetMatches = [...mdContent.matchAll(assetMatcher)];
							if (assetMatches.length > 0) {
								for (const match of assetMatches) {
									const [fullMatch, linkPath] = match;
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

							// Normalize tags and escape hex color tags (single pass)
							const tagMatcher = Bear2bkImporter.tagNormalizationMatcher;
							mdContent = this.transformOutsideCodeBlocks(mdContent, (line) => {
								return line.replace(tagMatcher, (match, hexTag, enclosedFollowing, enclosedTag, rawTag) => {
									if (hexTag) {
										return `\\#${hexTag}`;
									}
									if (enclosedFollowing) {
										return this.normalizeEnclosedTag(enclosedFollowing, match, true);
									}
									if (enclosedTag) {
										return this.normalizeEnclosedTag(enclosedTag, match, false);
									}
									if (rawTag) {
										const splitTag = this.splitTrailingPunctuation(rawTag);
										const normalizedTag = this.normalizeSimpleTag(splitTag ? splitTag.tag : rawTag);
										if (!normalizedTag) {
											return match;
										}
										return '#' + normalizedTag + (splitTag ? splitTag.trailing : '');
									}
									return match;
								});
							});

							// Extract tags from content
							const tags = this.extractTagsFromContent(mdContent);

							// Use just the filename without extension
							const fileName = mdFilename;
							const metadata = metadataLookup[parent];
							let targetFolder = outputFolder;
							if (metadata?.archivedtime !== undefined) {
								targetFolder = archiveFolder;
							}
							else if (metadata?.trashedtime !== undefined) {
								targetFolder = trashFolder;
							}

							const file = await this.saveAsMarkdownFile(targetFolder, fileName, mdContent);

							if (this.storeId || metadata?.archivedtime || metadata?.trashedtime || tags.length > 0) {
								await this.updateNoteFrontmatter(metadata, file, tags);
							}
							if (metadata?.ctime && metadata?.mtime) {
								await this.modifyFileTimestamps(metadata, file);
							}

							idMapping[metadata?.id] = {
								filename: fileName,
								metadata: metadata,
								file: file,
							};

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

		ctx.status('Updating internal links…');

		// Second pass to update links based on note IDs
		this.updateNotesLinks(idMapping);

	}

	private async updateNoteFrontmatter(metaData: Metadata | undefined, file: TFile, tags: string[]) {
		const writeOptions: DataWriteOptions = {
			ctime: metaData?.ctime,
			mtime: metaData?.mtime,
		};

		this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			if (this.storeId && metaData?.id) {
				frontmatter['id'] = metaData.id;
			}
			if (metaData?.archivedtime) {
				frontmatter['archived'] = new Date(metaData.archivedtime).toISOString().slice(0, 19);
			}
			if (metaData?.trashedtime) {
				frontmatter['trashed'] = new Date(metaData.trashedtime).toISOString().slice(0, 19);
			}

			if (tags.length > 0) {
				frontmatter['tags'] = tags;
			}
		}, writeOptions);
	}

	private async modifyFileTimestamps(metaData: Metadata, file: TFile) {
		const writeOptions: DataWriteOptions = {
			ctime: metaData.ctime,
			mtime: metaData.mtime,
		};
		await this.vault.append(file, '', writeOptions);
	}

	private updateNotesLinks(idMapping: Record<string, IDMappingValue>): Promise<void> {
		const updatePromises = Object.values(idMapping).map(async (note) => {
			const { metadata, file } = note;
			const writeOptions: DataWriteOptions = {
				ctime: metadata?.ctime,
				mtime: metadata?.mtime,
			};
			await this.vault.process(file, (mdContent) => {
				return mdContent.replace(Bear2bkImporter.bearLinkMatcher,
					(match, noteId) => {
						const noteTitle = idMapping[noteId]?.filename;
						if (noteTitle) {
							return encodeURI(noteTitle.normalize('NFC'));
						}
						return match; // No change if ID not found
					});
			}, writeOptions);
		});
		return Promise.all(updatePromises).then(() => { });
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
			const id = bearMetadata.uniqueIdentifier;
			const creationDate = Date.parse(bearMetadata.creationDate);
			const modificationDate = Date.parse(bearMetadata.modificationDate);
			const archivedDate = Date.parse(bearMetadata.archivedDate);
			const trashedDate = Date.parse(bearMetadata.trashedDate);
			metaData[entry.parent] = {
				id: id,
				ctime: isNaN(creationDate) ? undefined : creationDate,
				mtime: isNaN(modificationDate) ? undefined : modificationDate,
				archivedtime: isNaN(archivedDate) || bearMetadata.archived !== 1 ? undefined : archivedDate,
				trashedtime: isNaN(trashedDate) || bearMetadata.trashed !== 1 ? undefined : trashedDate,
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

	private fixListIndentation(text: string): string {
		const hasTrailingNewline = text.endsWith('\n');
		const lines = hasTrailingNewline ? text.slice(0, -1).split('\n') : text.split('\n');

		const out: string[] = [];
		let inFrontmatter = false;
		let inCode = false;
		let codeIndentSourceBase: number | null = null;
		let codeIndentTargetBase: number | null = null;

		const countLeadingSpaces = (value: string): number => {
			let count = 0;
			while (count < value.length && value[count] === ' ') {
				count += 1;
			}
			return count;
		};

		const countLeadingWhitespace = (value: string): number => {
			let count = 0;
			while (count < value.length) {
				const code = value.charCodeAt(count);
				if (code !== 32 && code !== 9 && code !== 13) {
					break;
				}
				count += 1;
			}
			return count;
		};

		const isFrontmatterFence = (lineValue: string): boolean => {
			const start = countLeadingWhitespace(lineValue);
			if (!lineValue.startsWith('---', start)) {
				return false;
			}
			let idx = start + 3;
			while (idx < lineValue.length) {
				const code = lineValue.charCodeAt(idx);
				if (code !== 32 && code !== 9 && code !== 13) {
					return false;
				}
				idx += 1;
			}
			return true;
		};

		const adjustCodeIndent = (lineValue: string, sourceBase: number, targetBase: number): string => {
			const leadingSpaces = countLeadingSpaces(lineValue);
			if (leadingSpaces < sourceBase) {
				return lineValue;
			}
			const newIndent = ' '.repeat(targetBase + (leadingSpaces - sourceBase));
			return newIndent + lineValue.slice(leadingSpaces);
		};

		const listFenceMatch = (lineValue: string): { indent: number; marker: string; fence: string } | null => {
			const match = lineValue.match(/^(\s*)([-*+]\s|\d+\.\s)(```.*)$/);
			if (!match) {
				return null;
			}
			return { indent: match[1].length, marker: match[2], fence: match[3] };
		};

		for (let i = 0; i < lines.length; i += 1) {
			let line = lines[i];

			if (i === 0 && isFrontmatterFence(line)) {
				inFrontmatter = true;
				out.push(line);
				continue;
			}

			if (inFrontmatter) {
				out.push(line);
				if (isFrontmatterFence(line)) {
					inFrontmatter = false;
				}
				continue;
			}

			const listFence = listFenceMatch(line);
			const hasFence = listFence !== null || line.startsWith('```', countLeadingWhitespace(line));
			if (hasFence) {
				if (listFence) {
					const targetIndent = listFence.indent * 2;
					line = ' '.repeat(targetIndent) + listFence.marker + listFence.fence;
					if (!inCode) {
						codeIndentSourceBase = listFence.indent + listFence.marker.length;
						codeIndentTargetBase = targetIndent + listFence.marker.length;
					}
					else {
						codeIndentSourceBase = null;
						codeIndentTargetBase = null;
					}
				}
				else {
					const leadingSpaces = countLeadingSpaces(line);
					line = ' '.repeat(leadingSpaces * 2) + line.slice(leadingSpaces);
					if (!inCode) {
						codeIndentSourceBase = leadingSpaces;
						codeIndentTargetBase = leadingSpaces * 2;
					}
					else {
						codeIndentSourceBase = null;
						codeIndentTargetBase = null;
					}
				}
				inCode = !inCode;
				out.push(line);
				continue;
			}

			if (inCode) {
				if (codeIndentSourceBase !== null && codeIndentTargetBase !== null) {
					line = adjustCodeIndent(line, codeIndentSourceBase, codeIndentTargetBase);
				}
				out.push(line);
				continue;
			}

			const match = line.match(/^( +)([-*+]\s|\d+\.)/);
			if (match) {
				const spaces = match[1];
				const newIndent = ' '.repeat(spaces.length * 2);
				line = newIndent + line.slice(spaces.length);
			}

			out.push(line);
		}

		return out.join('\n') + (hasTrailingNewline ? '\n' : '');
	}
}
