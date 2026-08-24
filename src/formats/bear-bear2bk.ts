import { DataWriteOptions, normalizePath, Notice, Platform, TFile, TFolder } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { FormatImporter, NoteTemplateSample, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import type { ManagedTemplateProperty } from '../note-template-configurator';
import { MAX_PREVIEW_IMAGE_BYTES, MAX_PREVIEW_IMAGES_BYTES, PREVIEW_IMAGE_PLACEHOLDER, previewImageDataUrl, previewImageMime } from '../preview-image';
import { sanitizeFileName } from '../util';
import { readZip, ZipEntryFile } from '../zip';
import { prepareBearApplicationMarkdown, readBearApplicationDatabase } from './bear/application-data';
import type { BearApplicationAttachment } from './bear/application-data';
import { BearTagPlacement, convertBearNote } from './bear/convert';


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
	static extensions = ['bear2bk', 'zip'];

	interruption = 'pause' as const;

	private attachmentMap: Record<string, string> = {};
	private flattenTags: boolean = false;
	private tagPlacement: BearTagPlacement = 'inline';

	init() {
		this.addInstructions(this.addExportSetting(i18n.importer.bear.descExport()));

		this.addFileChooserSetting(i18n.importer.bear.fileType(), Bear2bkImporter.extensions);
		this.defaultOutputFolder = 'Bear';
		this.idProperty = 'bear-id';
		this.idLabel = i18n.importer.bear.labelId();

		this.addSetting('template')
			?.setName(i18n.importer.bear.nameTagsProperty())
			.setDesc(i18n.importer.bear.descTagsProperty())
			.addToggle(t => t
				.setValue(false)
				.onChange(async v => {
					this.tagPlacement = v ? 'property' : 'inline';
					this.templateSettingsChanged();
				})
			);

		this.addSetting('template')
			?.setName(i18n.importer.bear.nameFlattenTags())
			.setDesc(i18n.importer.bear.descFlattenTags())
			.addToggle(t => t
				.setValue(false)
				.onChange(async v => {
					this.flattenTags = v;
					this.templateSettingsChanged();
				})
			);

	}

	protected override managedTemplateProperties(): ManagedTemplateProperty[] {
		return this.tagPlacement === 'property'
			? [{ key: 'tags', value: '{{tags}}' }]
			: [];
	}

	protected override async templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]> {
		const samples: NoteTemplateSample[] = [];
		for (const file of this.files) {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
			await readZip(file, async (_zip, entries) => {
				const database = this.applicationDatabase(entries);
				if (database) {
					samples.push(...await this.applicationPreviewSamples(ctx, database, entries));
					return;
				}

				const metadata = await this.collectMetadata(ctx, entries);
				const resolvePreviewAsset = this.previewAssetResolver(entries);
				for (const entry of entries) {
					if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
					if (entry.extension !== 'md' && entry.extension !== 'markdown') continue;

					try {
						const title = parseFilePath(entry.parent).basename || entry.basename;
						const converted = await convertBearNote(await entry.readText(), {
							basename: title,
							parent: entry.parent,
							flattenTags: this.flattenTags,
							tagPlacement: this.tagPlacement,
							resolveAsset: resolvePreviewAsset,
						});
						const noteMetadata = metadata[entry.parent];
						const generatedProperties = this.tagPlacement === 'property' && converted.tags.length > 0
							? { tags: converted.tags }
							: undefined;
						samples.push({
							title,
							path: normalizePath(`${this.outputLocation}/${title}.md`),
							content: this.mobileSafePreview(converted.content),
							variables: { tags: converted.tags },
							generatedProperties,
							sourceId: noteMetadata?.id,
							times: { ctime: noteMetadata?.ctime, mtime: noteMetadata?.mtime },
						});
					}
					catch (error) {
						console.warn(`Could not preview Bear note ${entry.fullpath}`, error);
					}
				}
			});
		}
		return samples;
	}

	private mobileSafePreview(content: string): string {
		if (!Platform.isMobile) return content;

		// The iOS test build can fail to load Obsidian's lazy Temml resource,
		// rejecting with a bare DOM Event and leaving the preview partly mounted.
		// Show TeX source notation instead. Images remain fully previewable, and
		// this changes only the template preview, never the imported note.
		return content.replace(/(?<!\\)\$/g, '\\$');
	}

	private applicationDatabase(entries: ZipEntryFile[]): ZipEntryFile | undefined {
		return entries.find(entry => /(?:^|\/)Application Data\/database\.sqlite$/i.test(entry.filepath));
	}

	private applicationAttachmentKey(attachment: BearApplicationAttachment): string {
		return normalizePath(`${attachment.id}/${attachment.filename}`).normalize('NFC').toLocaleLowerCase('en');
	}

	private applicationAttachmentEntries(entries: ZipEntryFile[]): Map<string, ZipEntryFile> {
		const result = new Map<string, ZipEntryFile>();
		for (const entry of entries) {
			const parts = normalizePath(entry.filepath).split('/');
			if (parts.length < 2 || !/\/Local Files\//i.test(entry.filepath)) continue;

			const key = parts.slice(-2).join('/').normalize('NFC').toLocaleLowerCase('en');
			result.set(key, entry);
		}
		return result;
	}

	private async applicationPreviewSamples(
		ctx: ImportContext,
		database: ZipEntryFile,
		entries: ZipEntryFile[],
	): Promise<NoteTemplateSample[]> {
		const samples: NoteTemplateSample[] = [];
		const notes = await readBearApplicationDatabase(await database.read());
		const attachmentEntries = this.applicationAttachmentEntries(entries);
		const previewEntry = this.previewAssetResolver(entries);

		for (const note of notes) {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
			if (note.encrypted) continue;

			try {
				const title = sanitizeFileName(note.title, this.outputLocation);
				const parent = `${note.id}.textbundle`;
				const prepared = prepareBearApplicationMarkdown(note);
				const converted = await convertBearNote(prepared.content, {
					basename: note.title,
					parent,
					flattenTags: this.flattenTags,
					tagPlacement: this.tagPlacement,
					resolveAsset: async assetPath => {
						const attachment = prepared.assets.get(normalizePath(assetPath));
						if (!attachment) return PREVIEW_IMAGE_PLACEHOLDER;

						const entry = attachmentEntries.get(this.applicationAttachmentKey(attachment));
						return entry ? await previewEntry(entry.filepath) : PREVIEW_IMAGE_PLACEHOLDER;
					},
				});
				const generatedProperties = this.tagPlacement === 'property' && converted.tags.length > 0
					? { tags: converted.tags }
					: undefined;
				samples.push({
					title,
					path: normalizePath(`${this.outputLocation}/${title}.md`),
					content: this.mobileSafePreview(converted.content),
					variables: { tags: converted.tags },
					generatedProperties,
					sourceId: note.id,
					times: { ctime: note.ctime, mtime: note.mtime },
				});
			}
			catch (error) {
				console.warn(`Could not preview Bear note ${note.id}`, error);
			}
		}

		return samples;
	}

	private previewAssetResolver(entries: ZipEntryFile[]): (assetPath: string) => Promise<string> {
		const assets = new Map(entries.map(entry => [normalizePath(entry.filepath), entry]));
		const resolved = new Map<string, Promise<string>>();
		let remainingBytes = MAX_PREVIEW_IMAGES_BYTES;

		return async assetPath => {
			const normalizedPath = normalizePath(assetPath);
			const existing = resolved.get(normalizedPath);
			if (existing) return await existing;

			const entry = assets.get(normalizedPath);
			const mime = entry ? previewImageMime(entry.extension) : undefined;
			if (!entry || !mime || entry.size > MAX_PREVIEW_IMAGE_BYTES || entry.size > remainingBytes) {
				return PREVIEW_IMAGE_PLACEHOLDER;
			}

			remainingBytes -= entry.size;
			const loading = entry.read()
				.then(data => previewImageDataUrl(mime, data))
				.catch(() => PREVIEW_IMAGE_PLACEHOLDER);
			resolved.set(normalizedPath, loading);
			return await loading;
		};
	}

	async import(ctx: ImportContext): Promise<void> {

		// Keep track of Bear IDs to new Obsidian file names to update links based on the identifier
		let idMapping: Record<string, IDMappingValue> = {};

		let { files } = this;
		if (files.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		let outputFolder = folder;

		let archiveFolder: TFolder | null = null;
		let trashFolder: TFolder | null = null;
		const folderFor = async (metadata: Metadata | undefined): Promise<TFolder> => {
			if (metadata?.archivedtime !== undefined) {
				return archiveFolder ??= await this.createFolders(`${folder.path}/archive`);
			}
			if (metadata?.trashedtime !== undefined) {
				return trashFolder ??= await this.createFolders(`${folder.path}/trash`);
			}
			return outputFolder;
		};

		for (let file of files) {
			if (await ctx.shouldStop()) return;
			ctx.status(i18n.common.statusProcessing({ name: file.name }));
			await readZip(file, async (zip, entries) => {
				const database = this.applicationDatabase(entries);
				if (database) {
					await this.importApplicationData(ctx, database, entries, folderFor, idMapping);
					return;
				}

				const metadataLookup = await this.collectMetadata(ctx, entries);
				for (let entry of entries) {
					if (await ctx.shouldStop()) return;
					let { fullpath, filepath, parent, name, extension } = entry;
					if (name === 'info.json' || name === 'tags.json' || name === 'backup.json') {
						continue;
					}
					ctx.status(i18n.common.statusProcessing({ name }));
					try {
						if (extension === 'md' || extension === 'markdown') {
							const mdFilename = parseFilePath(parent).basename;
							ctx.status(i18n.common.statusImportingNote({ name: mdFilename }));
							const metadata = metadataLookup[parent];
							const targetFolder = await folderFor(metadata);
							const notePath = normalizePath(`${targetFolder.path}/${mdFilename}.md`);
							const { content: mdContent, tags } = await convertBearNote(await entry.readText(), {
								basename: mdFilename,
								parent,
								flattenTags: this.flattenTags,
								tagPlacement: this.tagPlacement,
								resolveAsset: assetPath => this.getAttachmentStoragePath(assetPath, notePath),
							});

							// Use just the filename without extension
							const fileName = mdFilename;

							const { file, written } = await this.writeNote(ctx, targetFolder, fileName, mdContent, {
								sourceId: metadata?.id,
								ctime: metadata?.ctime,
								mtime: metadata?.mtime,
							});

							const noteTags = this.tagPlacement === 'property' ? tags : [];

							if (written) {
								if (metadata?.archivedtime || metadata?.trashedtime || noteTags.length > 0) {
									await this.updateNoteFrontmatter(metadata, file, noteTags);
								}
								if (metadata?.ctime && metadata?.mtime) {
									await this.modifyFileTimestamps(metadata, file);
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
							ctx.status(i18n.importer.bear.statusImportingAsset({ name: entry.name }));
							const noteParent = filepath.slice(0, filepath.indexOf('/assets/'));
							const noteFolder = await folderFor(metadataLookup[noteParent]);
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
							ctx.reportSkipped(fullpath, i18n.importer.bear.reasonUnknownType());
						}
					}
					catch (e) {
						ctx.reportFailed(fullpath, e);
					}
				}
			});
		}

		ctx.status(i18n.importer.bear.statusUpdatingLinks());

		// Second pass to update links based on note IDs
		await this.updateNotesLinks(idMapping);

	}

	private async importApplicationData(
		ctx: ImportContext,
		database: ZipEntryFile,
		entries: ZipEntryFile[],
		folderFor: (metadata: Metadata | undefined) => Promise<TFolder>,
		idMapping: Record<string, IDMappingValue>,
	): Promise<void> {
		const notes = await readBearApplicationDatabase(await database.read());
		const attachmentEntries = this.applicationAttachmentEntries(entries);

		for (const note of notes) {
			if (await ctx.shouldStop()) return;
			if (note.encrypted) {
				ctx.reportSkipped(note.title || note.id, i18n.importer.bear.reasonEncrypted());
				continue;
			}

			const metadata: Metadata = {
				id: note.id,
				ctime: note.ctime,
				mtime: note.mtime,
				archivedtime: note.archivedtime,
				trashedtime: note.trashedtime,
			};
			const targetFolder = await folderFor(metadata);
			const title = sanitizeFileName(note.title, targetFolder.path);
			const notePath = normalizePath(`${targetFolder.path}/${title}.md`);
			const parent = `${note.id}.textbundle`;
			const prepared = prepareBearApplicationMarkdown(note);
			const attachmentPaths = new Map<string, string>();

			try {
				const converted = await convertBearNote(prepared.content, {
					basename: note.title,
					parent,
					flattenTags: this.flattenTags,
					tagPlacement: this.tagPlacement,
					resolveAsset: async assetPath => {
						const attachment = prepared.assets.get(normalizePath(assetPath));
						if (!attachment) return assetPath;

						const key = this.applicationAttachmentKey(attachment);
						const entry = attachmentEntries.get(key);
						if (!entry) return attachment.filename;

						const outputPath = await this.getAttachmentStoragePath(entry.filepath, notePath);
						attachmentPaths.set(key, outputPath);
						return outputPath;
					},
				});

				ctx.status(i18n.common.statusImportingNote({ name: title }));
				const { file, written } = await this.writeNote(ctx, targetFolder, title, converted.content, {
					sourceId: note.id,
					ctime: note.ctime,
					mtime: note.mtime,
				});
				const noteTags = this.tagPlacement === 'property' ? converted.tags : [];

				if (written) {
					if (note.archivedtime || note.trashedtime || noteTags.length > 0) {
						await this.updateNoteFrontmatter(metadata, file, noteTags);
					}
					if (note.ctime && note.mtime) await this.modifyFileTimestamps(metadata, file);
					ctx.reportNoteSuccess(title);
				}

				idMapping[note.id] = {
					filename: parseFilePath(file.path).basename,
					metadata,
					file,
					written,
				};
			}
			catch (error) {
				ctx.reportFailed(note.title || note.id, error);
				continue;
			}

			for (const attachment of note.attachments) {
				if (await ctx.shouldStop()) return;
				const key = this.applicationAttachmentKey(attachment);
				const entry = attachmentEntries.get(key);
				if (!entry) continue;

				try {
					ctx.status(i18n.importer.bear.statusImportingAsset({ name: entry.name }));
					const outputPath = attachmentPaths.get(key)
						?? await this.getAttachmentStoragePath(entry.filepath, notePath);
					const writeOptions: DataWriteOptions = {};
					if (entry.ctime) writeOptions.ctime = entry.ctime.getTime();
					if (entry.mtime) writeOptions.mtime = entry.mtime.getTime();

					await this.vault.createBinary(outputPath, await entry.read(), writeOptions);
					ctx.reportAttachmentSuccess(entry.fullpath);
				}
				catch (error) {
					ctx.reportFailed(entry.fullpath, error);
				}
			}
		}
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

	private async modifyFileTimestamps(metaData: Metadata, file: TFile) {
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
