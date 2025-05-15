import { normalizePath, Notice, Setting, DataWriteOptions } from 'obsidian';
import { PickedFile } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { readZip, ZipEntryFile } from '../zip';
import { cleanDuplicates } from './notion/clean-duplicates';
import { readToMarkdown } from './notion/convert-to-md';
import { NotionResolverInfo } from './notion/notion-types';
import { getNotionId } from './notion/notion-utils';
import { parseFileInfo } from './notion/parse-info';

export class NotionImporter extends FormatImporter {


	parentsInSubfolders: boolean;
	singleLineBreaks: boolean;

	init() {
		this.parentsInSubfolders = true;
		this.addFileChooserSetting('Exported Notion', ['zip']);
		this.addOutputLocationSetting('Notion');
		new Setting(this.modal.contentEl)
			.setName('Save parent pages in subfolders')
			.setDesc('Places the parent database pages in the same folder as the nested content.')
			.addToggle((toggle) => toggle
				.setValue(this.parentsInSubfolders)
				.onChange((value) => (this.parentsInSubfolders = value)));

		new Setting(this.modal.contentEl)
			.setName('Single line breaks')
			.setDesc('Separate Notion blocks with only one line break (default is 2).')
			.addToggle((toggle) => toggle
				.setValue(this.singleLineBreaks)
				.onChange((value) => {
					this.singleLineBreaks = value;
				}));
	}

	async import(ctx: ImportContext): Promise<void> {
		const { vault, parentsInSubfolders, files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		let targetFolderPath = folder.path;
		targetFolderPath = normalizePath(targetFolderPath);
		// As a convention, all parent folders should end with "/" in this importer.
		if (!targetFolderPath?.endsWith('/')) targetFolderPath += '/';

		const info = new NotionResolverInfo(vault.getConfig('attachmentFolderPath') ?? '', this.singleLineBreaks);

		// loads in only path & title information to objects
		ctx.status('Looking for files to import');
		let total = 0;
		await processZips(ctx, files, async (file) => {
			try {
				await parseFileInfo(info, file);
				total = Object.keys(info.idsToFileInfo).length + Object.keys(info.pathsToAttachmentInfo).length;
				ctx.reportProgress(0, total);
			}
			catch (e) {
				ctx.reportSkipped(file.fullpath);
			}
		});
		if (ctx.isCancelled()) return;

		ctx.status('Resolving links and de-duplicating files');

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
			if (ctx.isCancelled()) return;
			await this.createFolders(path);
		}

		let current = 0;
		ctx.status('Starting import');
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

					ctx.status(`Importing note ${fileInfo.title}`);

					const markdownBody = await readToMarkdown(info, file);
					let writeOptions: DataWriteOptions = {};

					if (fileInfo.ctime) {
						writeOptions.ctime = fileInfo.ctime.getTime();
						writeOptions.mtime = fileInfo.ctime.getTime();
					}

					if (fileInfo.mtime) {
						writeOptions.mtime = fileInfo.mtime.getTime();
					}

					const path = `${targetFolderPath}${info.getPathForFile(fileInfo)}${fileInfo.title}.md`;
					await vault.create(path, markdownBody, writeOptions);
					ctx.reportNoteSuccess(file.fullpath);
				}
				else {
					const attachmentInfo = info.pathsToAttachmentInfo[file.filepath];
					if (!attachmentInfo) {
						throw new Error('attachment info not found for ' + file.filepath);
					}

					ctx.status(`Importing attachment ${file.name}`);

					const data = await file.read();
					await vault.createBinary(`${attachmentInfo.targetParentFolder}${attachmentInfo.nameWithExtension}`, data);
					ctx.reportAttachmentSuccess(file.fullpath);
				}
			}
			catch (e) {
				if (e.message === 'page body was not found') {
					ctx.reportSkipped(file.fullpath, 'page body was not found');
					return;
				}

				ctx.reportFailed(file.fullpath, e);
			}
		});
	}
}

async function processZips(ctx: ImportContext, files: PickedFile[], callback: (file: ZipEntryFile) => Promise<void>) {
	for (let zipFile of files) {
		if (ctx.isCancelled()) return;
		try {
			await readZip(zipFile, async (zip, entries) => {
				for (let entry of entries) {
					if (ctx.isCancelled()) return;

					// throw an error for Notion Markdown exports
					if (entry.extension === 'md' && getNotionId(entry.name)) {
						new Notice('Notion Markdown export detected. Please export Notion data to HTML instead.');
						ctx.cancel();
						throw new Error('Notion importer uses only HTML exports. Please use the correct format.');
					}

					// Skip databses in CSV format
					if (entry.extension === 'csv' && getNotionId(entry.name)) continue;

					// Skip summary files
					if (entry.name === 'index.html') continue;

					// Only recurse into zip files if they are at the root of the parent zip
					// because users can attach zip files to Notion, and they should be considered
					// attachment files.
					if (entry.extension === 'zip' && entry.parent === '') {
						try {
							await processZips(ctx, [entry], callback);
						}
						catch (e) {
							ctx.reportFailed(entry.fullpath);
						}
					}
					else {
						await callback(entry);
					}
				}
			});
		}
		catch (e) {
			ctx.reportFailed(zipFile.fullpath);
		}
	}
}
