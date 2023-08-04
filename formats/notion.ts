import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import { FileSystemAdapter, Notice, normalizePath } from 'obsidian';
import { escapeRegex, fixDuplicateSlashes } from '../util';
import { cleanDuplicates } from './notion/clean-duplicates';
import { convertNotesToMd } from './notion/convert-to-md';
import { copyFiles } from './notion/copy-files';
import { parseFiles } from './notion/parse-info';

export class NotionImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Exported Notion .zip', ['zip'], true);
		this.addOutputLocationSetting('Notion');
	}

	async import(): Promise<void> {
		let { app, files } = this;

		let targetFolderPath = (await this.getOutputFolder()).path;
		// As a convention, all parent folders should end with "/" in this importer.
		if (!targetFolderPath.endsWith('/')) targetFolderPath += '/';
		targetFolderPath = fixDuplicateSlashes(targetFolderPath);

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

		await parseFiles(files, {
			idsToFileInfo,
			pathsToAttachmentInfo,
			results,
		});

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
