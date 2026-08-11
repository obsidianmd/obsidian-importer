import { EvernoteResource } from '../models/EvernoteNote';
import { parseFilePath } from '../../../filesystem';
import { sanitizeFileName } from '../../../util';

import { extensionForMime } from '../../../mime';

// Planning and link lookup must use the same sanitized title.
export const normalizeTitle = (title: string) => {
	return sanitizeFileName(title);
};

export const getResourceFileName = (resource: EvernoteResource): string => {
	const UNKNOWNFILENAME = 'unknown_filename';

	const extension = getExtension(resource);
	let fileName = UNKNOWNFILENAME;

	if (resource['resource-attributes'] && resource['resource-attributes']['file-name']) {
		fileName = parseFilePath(resource['resource-attributes']['file-name']).basename;
	}
	fileName = fileName.replace(/[/\\?%*:|"<>[\]+]/g, '-');

	return `${fileName}.${extension}`;
};


export const getExtensionFromResourceFileName = (resource: EvernoteResource): string | undefined => {
	if (!(resource['resource-attributes'] &&
		resource['resource-attributes']['file-name'])) {
		return '';
	}
	const splitFileName = resource['resource-attributes']['file-name'].split('.');

	return splitFileName.length > 1 ? splitFileName[splitFileName.length - 1] : undefined;

};

export const getExtensionFromMime = (resource: EvernoteResource): string => {
	const mimeType = resource.mime;
	if (!mimeType) {
		return '';
	}

	return extensionForMime(mimeType) || '';
};

export const getExtension = (resource: EvernoteResource): string => {
	const UNKNOWNEXTENSION = 'dat';

	return getExtensionFromResourceFileName(resource) || getExtensionFromMime(resource) || UNKNOWNEXTENSION;
};
