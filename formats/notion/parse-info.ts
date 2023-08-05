import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import { sanitizeFileName } from '../../util';
import { assembleParentIds, getNotionId, parseParentIds } from './notion-utils';
import { htmlToMarkdown } from 'obsidian';
import { PickedFile, parseFilePath } from 'filesystem';
import { BlobWriter, Entry, TextWriter } from '@zip.js/zip.js';

export async function parseFileInfo(
	file: Entry,
	{
		idsToFileInfo,
		pathsToAttachmentInfo,
		results,
		parser,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		results: ImportResult;
		parser: DOMParser;
	}
) {
	if (!file.getData) return;

	results.total++;

	if (file.filename.endsWith('.html')) {
		const text = await file.getData(new TextWriter());

		const filePath = file.filename;

		const parentIds = parseParentIds(file.filename);

		const document = parser.parseFromString(text, 'text/html');

		const id = getNotionId(
			document.querySelector('article')?.getAttribute('id') ?? ''
		);
		if (!id) throw new Error('no id found for: ' + file.filename);
		const parsedTitle =
			document.querySelector('title')?.textContent || 'Untitled';

		let title = sanitizeFileName(
			parsedTitle
				.replace(/\n/g, ' ')
				.replace(/:/g, '-')
				.replace(/#/g, '')
				.replace(/\n/g, ' ')
				.replace(/^\s+/, '')
				.replace(/\s+$/, '')
		);

		// just in case title names are too long
		while (title.length > 100) {
			const wordList = title.split(' ');
			title = wordList.slice(0, wordList.length - 1).join(' ') + '...';
		}

		const fileInfo: NotionFileInfo = {
			path: filePath,
			parentIds,
			title,
			fullLinkPathNeeded: false,
		};

		idsToFileInfo[id] = fileInfo;
	} else {
		const { name, extension } = parseFilePath(file.filename);
		const attachmentInfo: NotionAttachmentInfo = {
			nameWithExtension: sanitizeFileName(
				`${name || 'Untitled'}.${extension}`
			),
			targetParentFolder: '',
			fullLinkPathNeeded: false,
			parentIds: parseParentIds(file.filename),
			path: file.filename,
		};
		pathsToAttachmentInfo[file.filename] = attachmentInfo;
	}
}
