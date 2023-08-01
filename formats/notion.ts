import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import { FileSystemAdapter, Notice, normalizePath } from 'obsidian';
import { escapeRegex } from '../util';
import { cleanDuplicates } from './notion/clean-duplicates';
import { convertNotesToMd } from './notion/convert-to-md';
import { copyFiles } from './notion/copy-files';
import { parseFiles } from './notion/parse-info';
import { assembleParentIds } from './notion/notion-utils';

export class NotionImporter extends FormatImporter {
	init() {
		this.addFolderChooserSetting('Notion HTML export folder', ['html']);

		this.fileLocationSetting?.settingEl.toggle(false);
		this.folderLocationSetting?.settingEl.toggle(true);

		this.addOutputLocationSetting('Notion');
	}

	async import(): Promise<void> {
		let { app, filePaths, folderPaths } = this;
		const targetFolderPath = (await this.getOutputFolder()).path;

		if (filePaths.length === 0) {
			new Notice('Please pick at least one folder to import.');
			return;
		}

		const folderPathsReplacement = new RegExp(
			`^(${folderPaths
				.map((folderPath) => escapeRegex('/' + folderPath))
				.join('|')})`
		);

		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		let results: ImportResult = {
			total: 0,
			skipped: [],
			failed: [],
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

		if (attachmentFolderPath.startsWith('.'))
			cleanDuplicates({
				idsToFileInfo,
				pathsToAttachmentInfo,
				attachmentFolderPath,
				app,
				targetFolderPath,
			});

		convertNotesToMd({
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
		});

		await copyFiles({
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
			app,
			targetFolderPath,
			results,
		});

		const allLoadedPaths = app.vault
			.getMarkdownFiles()
			.map((file) => file.name);
		const loadedNotes = Object.values(idsToFileInfo);
		const skippedFiles = loadedNotes
			.filter((note) => !allLoadedPaths.includes(note.title + '.md'))
			.map((note) => note.path);
		results.skipped.push(...skippedFiles);

		const duplicateFileTest = Object.values(idsToFileInfo).map(
			(fileInfo) =>
				`${assembleParentIds(fileInfo, idsToFileInfo).join('')}${
					fileInfo.title
				}.md`
		);

		this.showResult(results);
	}
}
