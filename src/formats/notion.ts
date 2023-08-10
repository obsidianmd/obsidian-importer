import { normalizePath, Notice, Setting } from 'obsidian';
import { PickedFile } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';
import { readZip, ZipEntryFile } from '../zip';
import { cleanDuplicates } from './notion/clean-duplicates';
import { readToMarkdown } from './notion/convert-to-md';
import { NotionResolverInfo } from './notion/notion-types';
import { getNotionId } from './notion/notion-utils';
import { parseFileInfo } from './notion/parse-info';

export class NotionImporter extends FormatImporter {
	parentsInSubfolders: boolean = false;

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
	}

	async import(results: ProgressReporter): Promise<void> {
		const { app, vault, parentsInSubfolders, files } = this;
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

		const info = new NotionResolverInfo(vault.getConfig('attachmentFolderPath') ?? '');

		// loads in only path & title information to objects
		await processZips(files, async (file) => {
			try {
				await parseFileInfo(info, file);
			}
			catch (e) {
				results.reportSkipped(file.fullpath);
			}
		});

		const notes = Object.keys(info.idsToFileInfo).length;
		const attachments = Object.keys(info.pathsToAttachmentInfo).length;
		const total = notes + attachments;

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
			await this.createFolders(path);
		}

		let current = 0;

		await processZips(files, async (file) => {
			current++;
			results.reportProgress(current, total);

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

					const markdownBody = await readToMarkdown(info, file);

					const path = `${targetFolderPath}${info.getPathForFile(fileInfo)}${fileInfo.title}.md`;
					await vault.create(path, markdownBody);
					results.reportNoteSuccess(file.fullpath);
				}
				else {
					const attachmentInfo = info.pathsToAttachmentInfo[file.filepath];
					if (!attachmentInfo) {
						throw new Error('attachment info not found for ' + file.filepath);
					}

					const data = await file.read();
					await vault.createBinary(`${attachmentInfo.targetParentFolder}${attachmentInfo.nameWithExtension}`, data);
					results.reportAttachmentSuccess(file.fullpath);
				}
			}
			catch (e) {
				results.reportFailed(file.fullpath, e);
			}
		});
	}
}

async function processZips(files: PickedFile[], callback: (file: ZipEntryFile) => Promise<void>) {
	for (let zipFile of files) {
		await readZip(zipFile, async (zip, entries) => {
			for (let entry of entries) {
				if (entry.extension === 'csv' && getNotionId(entry.name)) continue;

				if (entry.extension === 'zip') {
					await processZips([entry], callback);
				}
				else {
					await callback(entry);
				}
			}
		});
	}
}
