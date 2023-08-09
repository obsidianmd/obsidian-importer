import { Notice } from 'obsidian';
import { parseFilePath } from '../../filesystem';
import { parseHTML, sanitizeFileName } from '../../util';
import { ZipEntryFile } from '../../zip/util';
import { getNotionId, parseAttachmentFolderPath, parseParentIds } from './notion-utils';

export async function parseFileInfo(
	file: ZipEntryFile,
	{
		idsToFileInfo,
		pathsToAttachmentInfo,
		attachmentFolderPath,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		attachmentFolderPath: string;
	}
) {
	const { attachmentsInCurrentFolder } =
		parseAttachmentFolderPath(attachmentFolderPath);

	if (file.extension === 'zip') {
		new Notice(
			'Nested .zips found; please notify developer at github.com/obsidianmd/obsidian-importer.'
		);
		throw new Error('nested .zips, not prepared to handle');
	}
	if (file.extension === 'html') {
		const text = await file.readText();

		const filePath = file.filepath;
		const parentIds = parseParentIds(file.filepath);
		const dom = parseHTML(text);

		const id = getNotionId(
			dom.find('article')?.getAttribute('id') ?? ''
		);
		if (!id) throw new Error('no id found for: ' + file.filepath);
		// Because Notion cuts titles to be very short and chops words in half, we read the complete title from the HTML to get full words. Worth the extra processing time.
		const parsedTitle = dom.find('title')?.textContent || 'Untitled';

		let title = sanitizeFileName(
			parsedTitle
				.replace(/\n/g, ' ')
				.replace(/:/g, '-')
				.replace(/#/g, '')
				.trim()
		);

		// just in case title names are too long
		while (title.length > 200) {
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
	}
	else {
		const { basename, extension } = parseFilePath(file.filepath);

		const attachmentInfo: NotionAttachmentInfo = {
			nameWithExtension: sanitizeFileName(
				`${basename || 'Untitled'}.${extension}`
			),
			targetParentFolder: '',
			fullLinkPathNeeded: false,
			parentIds: attachmentsInCurrentFolder
				? parseParentIds(file.filepath)
				: [],
			path: file.filepath,
		};
		pathsToAttachmentInfo[file.filepath] = attachmentInfo;
	}
}
