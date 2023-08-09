import { BlobWriter, Entry } from '@zip.js/zip.js';
import { normalizePath, Notice, Setting } from 'obsidian';
import { PickedFile } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';
import { cleanDuplicates } from './notion/clean-duplicates';
import { readToMarkdown } from './notion/convert-to-md';
import { assembleParentIds, getNotionId } from './notion/notion-utils';
import { parseFileInfo } from './notion/parse-info';

export class NotionImporter extends FormatImporter {
	parentsInSubfolders: boolean;

	init() {
		this.parentsInSubfolders = true;
		this.addFileChooserSetting('Exported Notion .zip', ['zip'], true);
		this.addOutputLocationSetting('Notion');
		new Setting(this.modal.contentEl)
			.setName('Save parents in subfolders')
			.setDesc(
				'Move parents to their children\'s subfolder to support Folder Notes. If not selected, parents are placed outside of their children\'s subfolder.'
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.parentsInSubfolders)
					.onChange((value) => (this.parentsInSubfolders = value));
			});
	}

	async import(results: ProgressReporter): Promise<void> {
		let { app, files, parentsInSubfolders } = this;

		let targetFolderPath = (await this.getOutputFolder())?.path ?? '';
		targetFolderPath = normalizePath(targetFolderPath);
		// As a convention, all parent folders should end with "/" in this importer.
		if (!targetFolderPath?.endsWith('/')) targetFolderPath += '/';

		if (files.length === 0) {
			new Notice('Please pick at least one folder to import.');
			return;
		}

		const idsToFileInfo: Record<string, NotionFileInfo> = {};
		const pathsToAttachmentInfo: Record<string, NotionAttachmentInfo> = {};
		const parser = new DOMParser();
		const attachmentFolderPath =
			app.vault.getConfig('attachmentFolderPath') ?? '';

		// loads in only path & title information to objects
		await processZips(
			files,
			async (file) => {
				await parseFileInfo(file, {
					idsToFileInfo,
					pathsToAttachmentInfo,
					parser,
					attachmentFolderPath,
				});
			},
			(file) => {
				results.reportSkipped(file.filename);
			}
		);

		const notes = Object.keys(idsToFileInfo).length;
		const attachments = Object.keys(pathsToAttachmentInfo).length;
		const total = notes + attachments;

		cleanDuplicates({
			app,
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
			targetFolderPath,
			parentsInSubfolders,
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

		let current = 0;

		await processZips(
			files,
			async (file) => {
				current++;
				results.reportProgress(current, total);
				if (!file.getData) {
					throw new Error('can\'t get data for ' + file.filename);
				}
				if (file.filename.endsWith('.html')) {
					const id = getNotionId(file.filename);
					if (!id) {
						throw new Error('ids not found for ' + file.filename);
					}
					const fileInfo = idsToFileInfo[id];
					if (!fileInfo) {
						throw new Error('file info not found for ' + file.filename);
					}

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
					results.reportNoteSuccess(file.filename);
				}
				else {
					const attachmentInfo = pathsToAttachmentInfo[file.filename];
					if (!attachmentInfo) {
						throw new Error(
							'attachment info not found for ' + file.filename
						);
					}

					const data = await (
						await file.getData(new BlobWriter())
					).arrayBuffer();
					await app.vault.adapter.writeBinary(
						normalizePath(
							`${attachmentInfo.targetParentFolder}${attachmentInfo.nameWithExtension}`
						),
						data
					);
					results.reportAttachmentSuccess(file.filename);
				}
			},
			(file) => {
				results.reportFailed(file.filename);
			}
		);
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
				) {
					continue;
				}
				try {
					if (!file.getData) continue;
					await callback(file);
				}
				catch (e) {
					console.error(e);
					errorCallback(file);
				}
			}
		});
	}
}
