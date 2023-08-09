import { Entry, TextWriter } from '@zip.js/zip.js';
import { parseFilePath } from '../../filesystem';
import { sanitizeFileName } from '../../util';
import { getNotionId, parseAttachmentFolderPath, parseParentIds } from './notion-utils';

export async function parseFileInfo(
	file: Entry,
	{
		idsToFileInfo,
		pathsToAttachmentInfo,
		parser,
		attachmentFolderPath,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		parser: DOMParser;
		attachmentFolderPath: string;
	}
) {
	if (!file.getData) return;

	const { attachmentsInCurrentFolder } =
		parseAttachmentFolderPath(attachmentFolderPath);

	if (file.filename.endsWith('.zip')) {
		new Notification(
			'Nested .zips found; please notify developer at github.com/obsidianmd/obsidian-importer.'
		);
		throw new Error('nested .zips, not prepared to handle');
	}
	if (file.filename.endsWith('.html')) {
		const text = await file.getData(new TextWriter());

		const filePath = file.filename;
		const parentIds = parseParentIds(file.filename);
		const document = parser.parseFromString(text, 'text/html');

		const id = getNotionId(
			document.querySelector('article')?.getAttribute('id') ?? ''
		);
		if (!id) throw new Error('no id found for: ' + file.filename);
		// Because Notion cuts titles to be very short and chops words in half, we read the complete title from the HTML to get full wrods. Worth the extra processing time.
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
		const { basename, extension } = parseFilePath(file.filename);

		const attachmentInfo: NotionAttachmentInfo = {
			nameWithExtension: sanitizeFileName(
				`${basename || 'Untitled'}.${extension}`
			),
			targetParentFolder: '',
			fullLinkPathNeeded: false,
			parentIds: attachmentsInCurrentFolder
				? parseParentIds(file.filename)
				: [],
			path: file.filename,
		};
		pathsToAttachmentInfo[file.filename] = attachmentInfo;
	}
}
