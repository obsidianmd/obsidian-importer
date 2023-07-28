import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import { FileSystemAdapter, Notice, normalizePath } from 'obsidian';
import { parseFileInfo } from './notion/parser';
import {
	escapeRegex,
	getFileExtension,
	getParentFolder,
	pathToFilename,
	stripFileExtension,
} from '../util';
import { cleanDuplicates } from './notion/clean-duplicates';
import { convertNotesToMd } from './notion/convert-to-md';

export class NotionImporter extends FormatImporter {
	init() {
		this.addFolderChooserSetting('Notion HTML export folder', ['html']);

		this.fileLocationSetting?.settingEl.toggle(false);
		this.folderLocationSetting?.settingEl.toggle(true);

		this.addOutputLocationSetting('Notion');
	}

	async import(): Promise<void> {
		let { filePaths } = this;

		if (filePaths.length === 0) {
			new Notice('Please pick at least one folder to import.');
			return;
		}

		const folderHTML = this.folderLocationSetting.descEl.innerHTML;
		const folderPaths = folderHTML
			.match(/<span class="u-pop">.*?<\/span>/g)
			.map(
				(folder) => folder.match(/<span class="u-pop">(.*?)<\/span>/)[1]
			);
		const folderPathsReplacement = new RegExp(
			folderPaths
				.map((folderPath) => '^' + escapeRegex(folderPath) + '/')
				.join('|')
		);

		let { app } = this;
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		let results: ImportResult = {
			total: 0,
			skipped: 0,
			failed: 0,
		};

		const idsToFileInfo: Record<string, NotionFileInfo> = {};
		const pathsToAttachmentInfo: Record<string, NotionAttachmentInfo> = {};

		await Promise.all(
			filePaths.map(
				(filePath) =>
					new Promise(async (resolve, reject) => {
						try {
							const normalizedFilePath = filePath.replace(
								folderPathsReplacement,
								''
							);
							const text = await this.readPath(filePath);
							const { id, fileInfo, attachments } = parseFileInfo(
								{
									text,
									filePath,
									normalizedFilePath,
								}
							);

							for (let path of attachments)
								pathsToAttachmentInfo[path] = {
									title: pathToFilename(path),
									fullLinkPathNeeded: false,
								};

							idsToFileInfo[id] = fileInfo;
							results.total++;
							resolve(true);
						} catch (e) {
							console.error(e);
							results.failed++;
							reject(e);
						}
					})
			)
		);

		const appSettings = await app.vault.adapter.read(
			normalizePath(`${app.vault.configDir}/app.json`)
		);
		const parsedSettings = JSON.parse(appSettings ?? '{}');
		const attachmentFolderPath = parsedSettings.attachmentFolderPath ?? '';

		cleanDuplicates({
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
			app,
		});

		console.log(idsToFileInfo);

		convertNotesToMd({
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
			app,
		});

		console.log(idsToFileInfo);

		this.showResult(results);
	}
}
