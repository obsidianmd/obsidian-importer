import { EvernoteResource } from '../models/EvernoteNote';
import { parseFilePath, path } from '../../../filesystem';
import { sanitizeFileName } from '../../../util';

import { extensionForMime } from '../../../mime';

/** Maximum length for resource filename prefix */
const MAX_RESOURCE_FILENAME_PREFIX_LENGTH = 50;

export const normalizeTitle = (title: string) => {
	return sanitizeFileName(title).replace(/[[\]#^]/g, '');
};

/** What the export calls this attachment, made safe to be a file name. */
export const getResourceFileName = (resource: EvernoteResource): string => {
	const UNKNOWNFILENAME = 'unknown_filename';

	const extension = getExtension(resource);
	let fileName = UNKNOWNFILENAME;

	if (resource['resource-attributes'] && resource['resource-attributes']['file-name']) {
		const fileNamePrefix = resource['resource-attributes']['file-name'].slice(0, MAX_RESOURCE_FILENAME_PREFIX_LENGTH);
		fileName = parseFilePath(fileNamePrefix).basename;

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


export const getNotebookName = (enexFile: string): string => {
	return path.basename(enexFile, '.enex');
};
