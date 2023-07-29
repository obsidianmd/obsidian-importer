import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import { FileSystemAdapter, Notice, normalizePath } from 'obsidian';
import { parseFiles } from './notion/parse-info';
import {
	escapeRegex,
	getFileExtension,
	getParentFolder,
	pathToFilename,
	stripFileExtension,
} from '../util';
import { cleanDuplicates } from './notion/clean-duplicates';
import { convertNotesToMd } from './notion/convert-to-md';
import { copyFiles } from './notion/copy-files';

export class NotionImporter extends FormatImporter {
	init() {
		this.addFolderChooserSetting('Notion HTML export folder', ['html']);

		this.fileLocationSetting?.settingEl.toggle(false);
		this.folderLocationSetting?.settingEl.toggle(true);

		this.addOutputLocationSetting('Notion');
	}

	async import(): Promise<void> {
		let { app, filePaths } = this;

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
				.map((folderPath) => '^' + escapeRegex(folderPath) + '\\/')
				.join('|')
		);

		console.log(folderPathsReplacement);
		return;

		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		let results: ImportResult = {
			total: 0,
			skipped: 0,
			failed: 0,
		};

		const idsToFileInfo: Record<string, NotionFileInfo> = {};
		const pathsToAttachmentInfo: Record<string, NotionAttachmentInfo> = {};

		const readPath = this.readPath.bind(this);

		await parseFiles(filePaths, {
			idsToFileInfo,
			pathsToAttachmentInfo,
			results,
			folderPathsReplacement,
			readPath,
		});

		results.total =
			filePaths.length + Object.keys(pathsToAttachmentInfo).length;

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

		convertNotesToMd({
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
		});

		const targetFolderPath = (await this.getOutputFolder()).path;

		await copyFiles({
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
			app,
			targetFolderPath,
			results,
		});

		this.showResult(results);
	}
}
