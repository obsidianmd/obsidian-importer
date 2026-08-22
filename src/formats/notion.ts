import { normalizePath, Notice, DataWriteOptions } from 'obsidian';
import { PickedFile } from '../filesystem';
import { attachmentLocationAsSetting, FormatImporter, NoteTemplateSample, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { NOTION_ID_PROPERTY } from '../constants';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { extractErrorMessage } from '../util';
import { readZip, ZipEntryFile } from '../zip';
import { cleanDuplicates } from './notion/clean-duplicates';
import { readToMarkdown } from './notion/convert-to-md';
import { NotionResolverInfo } from './notion/notion-types';
import { getNotionId } from './notion/notion-utils';
import { parseFileInfo } from './notion/parse-info';


export class NotionImporter extends FormatImporter {
	static extensions = ['zip'];

	interruption = 'pause' as const;

	parentsInSubfolders: boolean;
	singleLineBreaks: boolean;

	init() {
		this.parentsInSubfolders = true;
		this.singleLineBreaks = false;

		this.addInstructions(this.addExportSetting(i18n.importer.notion.descExport()));

		this.addFileChooserSetting(i18n.importer.notion.fileType(), NotionImporter.extensions, false,
			i18n.importer.notion.descFiles());
		this.defaultOutputFolder = 'Notion';
		this.idProperty = NOTION_ID_PROPERTY;
		this.idLabel = i18n.importer.notion.labelId();
		this.addSetting()
			?.setName(i18n.importer.notion.nameSubfolders())
			.setDesc(i18n.importer.notion.descSubfolders())
			.addToggle((toggle) => toggle
				.setValue(this.parentsInSubfolders)
				.onChange((value) => (this.parentsInSubfolders = value)));

		this.startGroup('template');
		this.addSetting('template')
			?.setName(i18n.importer.notion.nameSingleLineBreaks())
			.setDesc(i18n.importer.notion.descSingleLineBreaks())
			.addToggle((toggle) => toggle
				.setValue(this.singleLineBreaks)
				.onChange((value) => {
					this.singleLineBreaks = value;
					this.templateSettingsChanged();
				}));
	}

	protected override async templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]> {
		const info = new NotionResolverInfo(
			attachmentLocationAsSetting(this.attachmentLocation),
			this.singleLineBreaks,
		);
		await processZips(ctx, this.files, async entry => {
			if (await ctx.shouldStop()) return;
			try {
				await parseFileInfo(info, entry);
			}
			catch (error) {
				console.warn(`Could not index Notion preview entry ${entry.fullpath}`, error);
			}
		});

		const samples: NoteTemplateSample[] = [];
		if (await ctx.shouldStop()) return samples;
		await processZips(ctx, this.files, async entry => {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) return;
			if (entry.extension !== 'html') return;
			const id = getNotionId(entry.name);
			const fileInfo = id ? info.idsToFileInfo[id] : undefined;
			if (!id || !fileInfo) return;

			try {
				const content = await readToMarkdown(info, entry);
				const parent = info.getPathForFile(fileInfo);
				samples.push({
					title: fileInfo.title,
					path: normalizePath(`${this.outputLocation}/${parent}${fileInfo.title}.md`),
					content,
					sourceId: id,
					times: {
						ctime: fileInfo.ctime?.getTime(),
						mtime: fileInfo.mtime?.getTime(),
					},
				});
			}
			catch (error) {
				console.warn(`Could not preview Notion page ${entry.fullpath}`, error);
			}
		});
		return samples;
	}

	async import(ctx: ImportContext): Promise<void> {
		const { vault, parentsInSubfolders, files } = this;
		if (files.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		let targetFolderPath = folder.path;
		targetFolderPath = normalizePath(targetFolderPath);
		// As a convention, all parent folders should end with "/" in this importer.
		if (!targetFolderPath?.endsWith('/')) targetFolderPath += '/';

		const info = new NotionResolverInfo(attachmentLocationAsSetting(this.attachmentLocation), this.singleLineBreaks);

		// loads in only path & title information to objects
		ctx.status(i18n.importer.notion.statusLooking());
		let total = 0;
		await processZips(ctx, files, async (file) => {
			try {
				await parseFileInfo(info, file);
				total = Object.keys(info.idsToFileInfo).length + Object.keys(info.pathsToAttachmentInfo).length;
				ctx.reportProgress(0, total);
			}
			catch {
				ctx.reportSkipped(file.fullpath);
			}
		});
		if (await ctx.shouldStop()) return;

		ctx.status(i18n.importer.notion.statusResolving());

		cleanDuplicates({
			vault,
			info,
			targetFolderPath,
			parentsInSubfolders,
		});

		const flatFolderPaths = new Set<string>([targetFolderPath]);
		const allFolderPaths = Object.values(info.idsToFileInfo)
			.map((fileInfo) => targetFolderPath + info.getPathForFile(fileInfo))
			.concat(Object.values(info.pathsToAttachmentInfo).map(
				(attachmentInfo) => attachmentInfo.targetParentFolder
			));
		for (let folderPath of allFolderPaths) {
			flatFolderPaths.add(folderPath);
		}
		for (let path of flatFolderPaths) {
			if (await ctx.shouldStop()) return;
			await this.createFolders(path);
		}

		let current = 0;
		ctx.status(i18n.importer.notion.statusStarting());
		await processZips(ctx, files, async (file) => {
			current++;
			ctx.reportProgress(current, total);

			try {
				if (file.extension === 'html') {
					const id = getNotionId(file.name);
					if (!id) {
						throw new Error('ids not found for ' + file.filepath);
					}
					const fileInfo = info.idsToFileInfo[id];
					if (!fileInfo) {
						throw new Error('file info not found for ' + file.filepath);
					}

					ctx.status(i18n.common.statusImportingNote({ name: fileInfo.title }));

					const markdownBody = await readToMarkdown(info, file);
					let writeOptions: DataWriteOptions = {};

					if (fileInfo.ctime) {
						writeOptions.ctime = fileInfo.ctime.getTime();
						writeOptions.mtime = fileInfo.ctime.getTime();
					}

					if (fileInfo.mtime) {
						writeOptions.mtime = fileInfo.mtime.getTime();
					}

					const parent = await this.createFolders(`${targetFolderPath}${info.getPathForFile(fileInfo)}`);
					const { written } = await this.writeNote(ctx, parent, fileInfo.title, markdownBody, { ...writeOptions, sourceId: id });
					if (written) ctx.reportNoteSuccess(file.fullpath);
				}
				else {
					const attachmentInfo = info.pathsToAttachmentInfo[file.filepath];
					if (!attachmentInfo) {
						throw new Error('attachment info not found for ' + file.filepath);
					}

					ctx.status(i18n.common.statusImportingAttachment({ name: file.name }));

					const data = await file.read();
					const parent = await this.createFolders(attachmentInfo.targetParentFolder);
					await this.createBinaryFile(parent, attachmentInfo.nameWithExtension, data);
					ctx.reportAttachmentSuccess(file.fullpath);
				}
			}
			catch (e) {
				if (extractErrorMessage(e) === 'page body was not found') {
					ctx.reportSkipped(file.fullpath, i18n.importer.notion.reasonNoPageBody());
					return;
				}

				ctx.reportFailed(file.fullpath, e);
			}
		});
	}
}

export async function processZips(ctx: ImportContext, files: PickedFile[], callback: (file: ZipEntryFile) => Promise<void>) {
	for (let zipFile of files) {
		if (await ctx.shouldStop()) return;
		try {
			await readZip(zipFile, async (zip, entries) => {
				for (let entry of entries) {
					if (await ctx.shouldStop()) return;

					// Notion's own default is Markdown & CSV, and this importer reads
					// the HTML export. Nothing here will convert, so say which export
					// it is and stop, rather than letting the walk fail namelessly.
					if (entry.extension === 'md' && getNotionId(entry.name)) {
						ctx.reportFailed(zipFile.fullpath, i18n.importer.notion.reasonMarkdownExport());
						ctx.cancel();
						return;
					}

					// Skip databses in CSV format
					if (entry.extension === 'csv' && getNotionId(entry.name)) continue;

					// Skip summary files
					if (entry.name === 'index.html') continue;

					// Only recurse into zip files if they are at the root of the parent zip
					// because users can attach zip files to Notion, and they should be considered
					// attachment files.
					if (entry.extension === 'zip' && entry.parent === '') {
						// Whatever goes wrong inside is reported there, against the
						// nested zip; wrapping this would name the same file twice.
						await processZips(ctx, [entry], callback);
					}
					else {
						await callback(entry);
					}
				}
			});
		}
		catch (e) {
			// Notion nests the export inside the zip it hands you, so this is
			// usually a file the user never picked. Without the reason it is a
			// failure they can neither place nor act on.
			ctx.reportFailed(zipFile.fullpath, e);
		}
	}
}
