import { DataWriteOptions, normalizePath, Notice, TFile } from 'obsidian';
import { helpUrl } from '../constants';
import { parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { readZip, ZipEntryFile } from '../zip';
import { convertBearNote } from './bear/convert';

const HELP_PERMALINK = 'import/bear';

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
	written: boolean;
};

export class Bear2bkImporter extends FormatImporter {
	interruption = 'pause' as const;

	private attachmentMap: Record<string, string> = {};
	private flattenTags: boolean = false;

	init() {
		this.addSetting('source')
			?.setName('Export your data')
			.setDesc('Back up your notes in Bear, you will receive a .bear2bk file.')
			.addButton(button => button
				.setButtonText('Open')
				.onClick(() => window.open(helpUrl(HELP_PERMALINK))));

		this.addFileChooserSetting('Bear2bk', ['bear2bk']);
		this.defaultOutputFolder = 'Bear';
		this.idProperty = 'bear-id';
		this.idLabel = 'Bear ID';

		this.addSetting()
			?.setName('Flatten nested tags')
			.setDesc(
				'When enabled, tags will be split on slashes (/) during import.'
			)
			.addToggle(t => t
				.setValue(false)
				.onChange(async v => this.flattenTags = v)
			);

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

		const archiveFolder = await this.createFolders(`${folder.path}/archive`);
		const trashFolder = await this.createFolders(`${folder.path}/trash`);

		for (let file of files) {
			if (await ctx.shouldStop()) return;
			ctx.status('Processing ' + file.name);
			await readZip(file, async (zip, entries) => {
				const metadataLookup = await this.collectMetadata(ctx, entries);
				for (let entry of entries) {
					if (await ctx.shouldStop()) return;
					let { fullpath, filepath, parent, name, extension } = entry;
					if (name === 'info.json' || name === 'tags.json' || name === 'backup.json') {
						continue;
					}
					ctx.status('Processing ' + name);
					try {
						if (extension === 'md' || extension === 'markdown') {
							const mdFilename = parseFilePath(parent).basename;
							ctx.status('Importing note ' + mdFilename);
							const metadata = metadataLookup[parent];
							let targetFolder = outputFolder;
							if (metadata?.archivedtime !== undefined) {
								targetFolder = archiveFolder;
							}
							else if (metadata?.trashedtime !== undefined) {
								targetFolder = trashFolder;
							}
							const notePath = normalizePath(`${targetFolder.path}/${mdFilename}.md`);
							const { content: mdContent, tags } = await convertBearNote(await entry.readText(), {
								basename: mdFilename,
								parent,
								flattenTags: this.flattenTags,
								resolveAsset: assetPath => this.getAttachmentStoragePath(assetPath, notePath),
							});

							// Use just the filename without extension
							const fileName = mdFilename;

							const { file, written } = await this.writeNote(ctx, targetFolder, fileName, mdContent, {
								sourceId: metadata?.id,
								ctime: metadata?.ctime,
								mtime: metadata?.mtime,
							});

							if (written) {
								if (metadata?.archivedtime || metadata?.trashedtime || tags.length > 0) {
									await this.updateNoteFrontmatter(metadata, file, tags);
								}
								if (metadata?.ctime && metadata?.mtime) {
									await this.modifFileTimestamps(metadata, file);
								}
							}

							// Keep skipped notes as link targets without rewriting them.
							idMapping[metadata?.id] = {
								filename: parseFilePath(file.path).basename,
								metadata: metadata,
								file: file,
								written,
							};

							if (written) ctx.reportNoteSuccess(mdFilename);
						}
						else if (filepath.match(/\/assets\//g)) {
							ctx.status('Importing asset ' + entry.name);
							const noteParent = filepath.slice(0, filepath.indexOf('/assets/'));
							const noteMetadata = metadataLookup[noteParent];
							const noteFolder = noteMetadata?.archivedtime !== undefined
								? archiveFolder
								: noteMetadata?.trashedtime !== undefined ? trashFolder : outputFolder;
							const noteName = parseFilePath(noteParent).basename;
							const notePath = normalizePath(`${noteFolder.path}/${noteName}.md`);
							const outputPath = await this.getAttachmentStoragePath(entry.filepath, notePath);
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
		await this.updateNotesLinks(idMapping);

	}

	private async updateNoteFrontmatter(metaData: Metadata | undefined, file: TFile, tags: string[]) {
		const writeOptions: DataWriteOptions = {
			ctime: metaData?.ctime,
			mtime: metaData?.mtime,
		};

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
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

	private async modifFileTimestamps(metaData: Metadata, file: TFile) {
		const writeOptions: DataWriteOptions = {
			ctime: metaData.ctime,
			mtime: metaData.mtime,
		};
		await this.vault.append(file, '', writeOptions);
	}

	private updateNotesLinks(idMapping: Record<string, IDMappingValue>): Promise<void> {
		const updatePromises = Object.values(idMapping).filter(note => note.written).map(async (note) => {
			const { metadata, file } = note;
			const writeOptions: DataWriteOptions = {
				ctime: metadata?.ctime,
				mtime: metadata?.mtime,
			};
			await this.vault.process(file, (mdContent) => {
				return mdContent.replace(/bear:\/\/x-callback-url\/open-note\?id=([A-Z0-9-]+)/g,
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
			if (await ctx.shouldStop()) return metaData;

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
	private async getAttachmentStoragePath(attachmentPath: string, sourcePath?: string): Promise<string> {
		const normalizedPath = normalizePath(attachmentPath);

		if (this.attachmentMap[normalizedPath]) {
			return this.attachmentMap[normalizedPath];
		}

		const usedPaths = Object.values(this.attachmentMap);
		let outputPath = await this.getAvailablePathForAttachment(normalizedPath, usedPaths, sourcePath);
		// Colons are not allowed in Obsidian file paths.
		outputPath = outputPath.replace(/:/g, '');
		this.attachmentMap[normalizedPath] = outputPath;
		return outputPath;
	}

}
