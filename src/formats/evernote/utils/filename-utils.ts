import { EvernoteRun } from '../run';
import { EvernoteNote, EvernoteResource } from '../models/EvernoteNote';
import { parseFilePath, path } from '../../../filesystem';
import { sanitizeFileName } from '../../../util';

import { extensionForMime } from '../../../mime';
import { getNextFilenameIndex } from './filename-dedupe';

// Filename length constants
const MAX_NOTE_NAME_LENGTH = 100; // Limit note name length to prevent path issues
const MAX_RESOURCE_FILENAME_PREFIX_LENGTH = 50; // Maximum length for resource filename prefix

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

export const getFilePrefix = (note: EvernoteNote): string => {
	return normalizeTitle(note['title'] ? `${note['title'].toString()}` : 'Untitled');
};

export const getNoteFileName = (run: EvernoteRun, dstPath: string, note: EvernoteNote, extension: string = 'md'): string => {
	return `${getNoteName(run, dstPath, note)}.${extension}`;
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

export const getNoteName = (run: EvernoteRun, dstPath: string, note: EvernoteNote): string => {
	let filePrefix = getFilePrefix(note);

	// Truncate file name prefix if it's too long
	if (filePrefix.length > MAX_NOTE_NAME_LENGTH) {
		filePrefix = filePrefix.substring(0, MAX_NOTE_NAME_LENGTH);
		console.warn(`Note title too long (${getFilePrefix(note).length} chars), truncated to ${MAX_NOTE_NAME_LENGTH} chars`);
	}

	const nextIndex = run.reusesNoteNames() ? 0 : getNextFilenameIndex(run.namesIn(dstPath), filePrefix);

	return (nextIndex === 0) ? filePrefix : `${filePrefix}.${nextIndex}`;
};

export const getNotebookName = (enexFile: string): string => {
	return path.basename(enexFile, '.enex');
};
