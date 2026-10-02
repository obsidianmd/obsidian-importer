import { parseHTML, sanitizeFileName } from '../../util';
import { ZipEntryFile } from '../../zip';
import { NotionResolverInfo } from './notion-types';
import { getNotionId, parseParentIds } from './notion-utils';
import { exportYear, notionDateValue } from './date-values';

export async function parseFileInfo(info: NotionResolverInfo, file: ZipEntryFile) {
	recordFileInfo(info, {
		filepath: file.filepath,
		name: file.name,
		extension: file.extension,
		mtime: file.mtime,
		text: file.extension === 'html' ? await file.readText() : undefined,
	});
}

export interface NotionExportEntry {
	filepath: string;
	name: string;
	extension: string;
	mtime?: Date;
	text?: string;
}

export function recordFileInfo(info: NotionResolverInfo, file: NotionExportEntry) {
	let { filepath } = file;

	if (file.extension === 'html') {
		const text = file.text ?? '';

		const dom = parseHTML(text);
		info.dateParser.observe(dom);
		const body = dom.find('body');
		const children = body.children;
		let id: string | undefined;
		for (let i = 0; i < children.length; i++) {
			id = getNotionId(children[i].getAttr('id') ?? '');
			if (id) break;
		}
		if (!id) {
			throw new Error('no id found for: ' + filepath);
		}

		const ctime = dom.querySelector('tr.property-row-created_time time');
		const mtime = dom.querySelector('tr.property-row-last_edited_time time');
		const created = ctime ? notionDateValue(ctime) : undefined;
		const modified = mtime ? notionDateValue(mtime) : undefined;
		const year = exportYear(file.mtime);

		// Because Notion cuts titles to be very short and chops words in half, we read the complete title from the HTML to get full words. Worth the extra processing time.
		const parsedTitle = dom.find('title')?.textContent || 'Untitled';

		let title = stripTo200(sanitizeFileName(
			parsedTitle
				.replace(/\n/g, ' ')
				.replace(/[:/]/g, '-')
				.replace(/#/g, '')
				.trim()
		));

		info.idsToFileInfo[id] = {
			path: filepath,
			parentIds: parseParentIds(filepath),
			// Resolve after indexing, when numeric order evidence from later pages
			// is available. Capture only the values, not the page DOM.
			get ctime() {
				return created ? info.dateParser.timestamp(created, year) : null;
			},
			get mtime() {
				return modified ? info.dateParser.timestamp(modified, year) : null;
			},
			title,
			fullLinkPathNeeded: false,
		};
	}
	else {
		info.pathsToAttachmentInfo[filepath] = {
			path: filepath,
			parentIds: parseParentIds(filepath),
			// Notion url-encodes attachments on export — need to decode.
			// NOTE: for some unicode, Notion destroys the filename completely
			// so it cannot be retrieved trivially.
			// This is a Notion bug, not an Obsidian Importer bug.
			nameWithExtension: sanitizeFileName(decodeURIComponent(file.name)),
			targetParentFolder: '',
			fullLinkPathNeeded: false,
		};
	}
}

function stripTo200(title: string) {
	if (title.length < 200) return title;

	// just in case title names are too long
	const wordList = title.split(' ');
	const titleList = [];
	let length = 0;
	let i = 0;
	let hasCompleteTitle = false;
	while (length < 200) {
		if (!wordList[i]) {
			hasCompleteTitle = true;
			break;
		}
		titleList.push(wordList[i]);
		length += wordList[i].length + 1;
		i++;
	}
	let strippedTitle = titleList.join(' ');
	if (!hasCompleteTitle) strippedTitle += '...';
	return strippedTitle;
}
