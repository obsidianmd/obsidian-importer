import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import { FileSystemAdapter, Notice, normalizePath } from 'obsidian';
import { escapeRegex, fixDuplicateSlashes } from '../util';
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
		let targetFolderPath = (await this.getOutputFolder()).path;
		// As a convention, all parent folders should end with "/" in this importer.
		if (!targetFolderPath.endsWith('/')) targetFolderPath += '/';
		targetFolderPath = fixDuplicateSlashes(targetFolderPath);

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

		const attachmentFolderPath = app.vault.getConfig(
			'attachmentFolderPath'
		);

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
			app,
			targetFolderPath,
			results,
		});

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
