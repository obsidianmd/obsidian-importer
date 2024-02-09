import { moment } from 'obsidian';
import { fs, parseFilePath, path } from '../../../filesystem';
import { sanitizeFileName } from '../../../util';

import { yarleOptions } from '../yarle';

import { ResourceFileProperties } from '../models/ResourceFileProperties';
import { escapeStringRegexp } from './escape-string-regexp';
import { extensionForMime } from '../../../mime';

export const normalizeTitle = (title: string) => {
	return sanitizeFileName(title).replace(/[\[\]\#\^]/g, '');
};

export const getFileIndex = (dstPath: string, fileNamePrefix: string): number | string => {
	const index = fs
		.readdirSync(dstPath)
		.filter(file => {
			// make sure we get the first copy with no count suffix or the copies whose filename changed
			// drop the extension to compare with filename prefix
			const filePrefix = file.split('.').slice(0, -1).join('.');
			const escapedFilePrefix = escapeStringRegexp(fileNamePrefix);
			const fileWithSameName = filePrefix.match(new RegExp(`${escapedFilePrefix}\\.\\d+`));

			return filePrefix === fileNamePrefix || fileWithSameName;
		})
		.length;

	return index;

};
export const getResourceFileProperties = (workDir: string, resource: any): ResourceFileProperties => {
	const UNKNOWNFILENAME = yarleOptions.useUniqueUnknownFileNames ? 'unknown_filename' + (Math.random().toString(16) + '0000000').slice(2, 10) : 'unknown_filename';

	const extension = getExtension(resource);
	let fileName = UNKNOWNFILENAME;

	if (resource['resource-attributes'] && resource['resource-attributes']['file-name']) {
		const fileNamePrefix = resource['resource-attributes']['file-name'].substr(0, 50);
		fileName = parseFilePath(fileNamePrefix).basename;

	}
	fileName = fileName.replace(/[/\\?%*:|"<>\[\]\+]/g, '-');

	if (yarleOptions.sanitizeResourceNameSpaces) {
		fileName = fileName.replace(/ /g, yarleOptions.replacementChar);
	}

	const index = getFileIndex(workDir, fileName);
	const fileNameWithIndex = index > 0 ? `${fileName}.${index}` : fileName;

	return {
		fileName: `${fileNameWithIndex}.${extension}`,
		extension,
		index,
	};
};

export const getFilePrefix = (note: any): string => {
	return normalizeTitle(note['title'] ? `${note['title'].toString()}` : 'Untitled');
};

export const getNoteFileName = (dstPath: string, note: any, extension: string = 'md'): string => {
	return `${getNoteName(dstPath, note)}.${extension}`;
};
export const getExtensionFromResourceFileName = (resource: any): string => {
	if (!(resource['resource-attributes'] &&
		resource['resource-attributes']['file-name'])) {
		return '';
	}
	const splitFileName = resource['resource-attributes']['file-name'].split('.');

	return splitFileName.length > 1 ? splitFileName[splitFileName.length - 1] : undefined;

};

export const getExtensionFromMime = (resource: any): string => {
	const mimeType = resource.mime;
	if (!mimeType) {
		return '';
	}

	return extensionForMime(mimeType) || '';
};

export const getExtension = (resource: any): string => {
	const UNKNOWNEXTENSION = 'dat';

	return getExtensionFromResourceFileName(resource) || getExtensionFromMime(resource) || UNKNOWNEXTENSION;
};

export const getZettelKastelId = (note: any, dstPath: string): string => {
	return moment(note['created']).format('YYYYMMDDHHmm');
};

export const getNoteName = (dstPath: string, note: any): string => {
	let noteName;

	if (yarleOptions.isZettelkastenNeeded || yarleOptions.useZettelIdAsFilename) {
		const zettelPrefix = getZettelKastelId(note, dstPath);
		const nextIndex = getFileIndex(dstPath, zettelPrefix);
		const separator = ' ';
		noteName = (nextIndex !== 0) ?
			`${zettelPrefix}.${nextIndex}` :
			zettelPrefix;

		if (!yarleOptions.useZettelIdAsFilename) {
			noteName += getFilePrefix(note) !== 'Untitled' ? `${separator}${getFilePrefix(note)}` : '';
		}
	}
	else {
		const fileNamePrefix = getFilePrefix(note);
		const nextIndex = getFileIndex(dstPath, fileNamePrefix);

		noteName = (nextIndex === 0) ? fileNamePrefix : `${fileNamePrefix}.${nextIndex}`;
	}

	return noteName;

};

export const getNotebookName = (enexFile: string): string => {
	return path.basename(enexFile, '.enex');
};
