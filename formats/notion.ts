import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import {
	FileSystemAdapter,
	Notice,
	TAbstractFile,
	TFolder,
	moment,
	normalizePath,
} from 'obsidian';
import { cleanDuplicates } from './notion/clean-duplicates';
import { readToMarkdown } from './notion/convert-to-md';
import { PickedFile } from 'filesystem';
import {
	assembleParentIds,
	getNotionId,
	parseDate,
} from './notion/notion-utils';
import { BlobWriter, Entry } from '@zip.js/zip.js';
import { parseFileInfo } from './notion/parse-info';

export class NotionImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Exported Notion .zip', ['zip'], true);
		this.addOutputLocationSetting('Notion');
	}

	async import(): Promise<void> {
		let { app, files } = this;

		await this.app.vault.delete(
			this.app.vault.getAbstractFileByPath('Notion') as TAbstractFile,
			true
		);

		let targetFolderPath = (await this.getOutputFolder())?.path ?? '';
		targetFolderPath = normalizePath(targetFolderPath);
		// As a convention, all parent folders should end with "/" in this importer.
		if (!targetFolderPath?.endsWith('/')) targetFolderPath += '/';

		targetFolderPath = 'Notion/';

		if (files.length === 0) {
			new Notice('Please pick at least one folder to import.');
			return;
		}

		let results: ImportResult = {
			total: 0,
			skipped: [],
			failed: [],
		};

		const idsToFileInfo: Record<string, NotionFileInfo> = {};
		const pathsToAttachmentInfo: Record<string, NotionAttachmentInfo> = {};
		const failedResults = new Set<string>();
		const parser = new DOMParser();

		// loads in only path & title information to objects
		await processZips(
			files,
			async (file) => {
				await parseFileInfo(file, {
					idsToFileInfo,
					pathsToAttachmentInfo,
					results,
					parser,
				});
			},
			(file) => {
				failedResults.add(file.filename);
			}
		);

		const attachmentFolderPath =
			app.vault.getConfig('attachmentFolderPath') ?? '';

		cleanDuplicates({
			app,
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
			targetFolderPath,
		});

		const flatFolderPaths = new Set<string>([targetFolderPath]);
		const allFolderPaths = Object.values(idsToFileInfo)
			.map(
				(fileInfo) =>
					targetFolderPath +
					assembleParentIds(fileInfo, idsToFileInfo).join('')
			)
			.concat(
				Object.values(pathsToAttachmentInfo).map(
					(attachmentInfo) => attachmentInfo.targetParentFolder
				)
			);
		for (let folderPath of allFolderPaths) {
			flatFolderPaths.add(folderPath);
		}
		for (let path of flatFolderPaths) {
			await this.createFolders(path);
		}

		const attachmentPaths = Object.keys(pathsToAttachmentInfo);

		await processZips(
			files,
			async (file) => {
				if (!file.getData)
					throw new Error("can't get data for " + file.filename);
				if (file.filename.endsWith('.html')) {
					const id = getNotionId(file.filename);
					if (!id)
						throw new Error('ids not found for ' + file.filename);
					const fileInfo = idsToFileInfo[id];
					if (!fileInfo)
						throw new Error(
							'file info not found for ' + file.filename
						);

					const { markdownBody, properties } = await readToMarkdown(
						file,
						{
							attachmentPaths,
							idsToFileInfo,
							pathsToAttachmentInfo,
							parser,
						}
					);

					const path = `${targetFolderPath}${assembleParentIds(
						fileInfo,
						idsToFileInfo
					).join('')}${fileInfo.title}.md`;
					const newFile = await app.vault.create(path, markdownBody);
					if (properties.length > 0) {
						await app.fileManager.processFrontMatter(
							newFile,
							(frontMatter) => {
								for (let property of properties) {
									frontMatter[property.title] =
										property.content;
								}
							}
						);
					}
				} else {
					const attachmentInfo = pathsToAttachmentInfo[file.filename];
					if (!attachmentInfo)
						throw new Error(
							'attachment info not found for ' + file.filename
						);

					const data = await (
						await file.getData(new BlobWriter())
					).arrayBuffer();
					await app.vault.adapter.writeBinary(
						normalizePath(
							`${attachmentInfo.targetParentFolder}${attachmentInfo.nameWithExtension}`
						),
						data
					);
				}
			},
			(file) => {
				failedResults.add(file.filename);
			}
		);

		results.failed = [...failedResults];

		const allMarkdownFiles = app.vault
			.getMarkdownFiles()
			.map((file) => file.name);
		const loadedNotes = Object.values(idsToFileInfo);
		const skippedFiles = loadedNotes
			.filter((note) => !allMarkdownFiles.includes(note.title + '.md'))
			.map((note) => note.path);
		results.skipped.push(...skippedFiles);

		this.showResult(results);
	}
}

async function processZips(
	files: PickedFile[],
	callback: (file: Entry) => Promise<void>,
	errorCallback: (file: Entry) => void
) {
	for (let zipFile of files) {
		await zipFile.readZip(async (zip) => {
			const entries = await zip.getEntries();

			const isDatabaseCSV = (filename: string) =>
				filename.endsWith('.csv') && getNotionId(filename);

			for (let file of entries) {
				if (
					isDatabaseCSV(file.filename) ||
					file.directory ||
					!file.getData
				)
					continue;
				try {
					if (!file.getData) continue;
					await callback(file);
				} catch (e) {
					console.error(e);
					errorCallback(file);
				}
			}
		});
	}
}
