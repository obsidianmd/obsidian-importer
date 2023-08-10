import { parseHTML, sanitizeFileName } from '../../util';
import { ZipEntryFile } from '../../zip';
import { NotionResolverInfo } from './notion-types';
import { getNotionId, parseParentIds } from './notion-utils';

export async function parseFileInfo(info: NotionResolverInfo, file: ZipEntryFile) {
	let { filepath } = file;

	if (file.extension === 'html') {
		const text = await file.readText();

		const dom = parseHTML(text);

		const id = getNotionId(dom.find('article')?.getAttr('id') ?? '');
		if (!id) throw new Error('no id found for: ' + filepath);
		// Because Notion cuts titles to be very short and chops words in half, we read the complete title from the HTML to get full words. Worth the extra processing time.
		const parsedTitle = dom.find('title')?.textContent || 'Untitled';

		let title = sanitizeFileName(
			parsedTitle
				.replace(/\n/g, ' ')
				.replace(/:/g, '-')
				.replace(/#/g, '')
				.trim()
		);

		// XXX: This needs to be optimized
		// just in case title names are too long
		while (title.length > 200) {
			const wordList = title.split(' ');
			title = wordList.slice(0, wordList.length - 1).join(' ') + '...';
		}

		info.idsToFileInfo[id] = {
			path: filepath,
			parentIds: parseParentIds(filepath),
			title,
			fullLinkPathNeeded: false,
		};
	}
	else {
		info.pathsToAttachmentInfo[filepath] = {
			path: filepath,
			parentIds: parseParentIds(filepath),
			nameWithExtension: sanitizeFileName(file.name),
			targetParentFolder: '',
			fullLinkPathNeeded: false,
		};
	}
}
