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

		const dateTimeStr = extractTimeFromDOMElement(dom, "property-row-created_time");
		const dateTimeEditedStr = extractTimeFromDOMElement(dom, "property-row-last_edited_time");
		
		let resultDateTime: Date | null = null;
		let resultDateTimeEdited: Date | null = null;

		// Parse the extracted dateTimeStr
		if (dateTimeStr) {
			resultDateTime = parseDateTime(dateTimeStr);
		}

		if (dateTimeEditedStr) {
			resultDateTimeEdited = parseDateTime(dateTimeEditedStr);
		}

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
			ctime: resultDateTime,
			mtime: resultDateTimeEdited,
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

// Function to parse the date-time string
function parseDateTime(dateTimeStr: string): Date | null {
	// If the string starts with "@", skip the first character
	const cleanedStr = dateTimeStr.startsWith('@') ? dateTimeStr.substr(1).trim() : dateTimeStr.trim();

	// Use the built-in Date constructor
	const dateObj = new Date(cleanedStr);

	// Check if the resulting date object is valid
	if (isNaN(dateObj.getTime())) {
		return null;
	}

	return dateObj;
}

function extractTimeFromDOMElement(dom: HTMLElement, trClassName: string): string | null {
	// Select the <tr> element with the specified class from the provided DOM
	const trElement = dom.querySelector(`tr.${trClassName}`);

	if (trElement) {
		// If the <tr> element exists, select the <time> element within it
		const timeElement = trElement.querySelector('time');

		// Return the inner text of the <time> element or null if not found
		return timeElement ? timeElement.textContent : null;
	}

	return null;
}