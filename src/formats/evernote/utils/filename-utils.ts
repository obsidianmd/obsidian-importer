import { EvernoteResource } from '../models/EvernoteNote';
import { parseFilePath } from '../../../filesystem';
import { sanitizeFileName } from '../../../util';

import { extensionForMime } from '../../../mime';

// Planning and link lookup must use the same sanitized title.
export const normalizeTitle = (title: string) => {
	return sanitizeFileName(title);
};

const PLAIN_EXTENSION = /^[a-z0-9]+$/i;

export const getResourceFileName = (resource: EvernoteResource): string => {
	const fallback = (resource.mime && extensionForMime(resource.mime)) || 'dat';
	const fileName = resource['resource-attributes']?.['file-name'];
	if (!fileName) return `unknown_filename.${fallback}`;

	const [basename, ext] = splitPlainExtension(fileName)
		// Web Clipper names can keep the image URL's query, as in photo.png?width=120.
		?? splitPlainExtension(fileName.replace(/^(.*\.[a-z0-9]+)[?#].*$/i, '$1'))
		?? [parseFilePath(fileName).name, fallback];

	return `${basename.replace(/[/\\?%*:|"<>[\]+]/g, '-')}.${ext}`;
};

const splitPlainExtension = (fileName: string): [string, string] | null => {
	const name = parseFilePath(fileName).name;
	const dot = name.lastIndexOf('.');
	const extension = name.slice(dot + 1);

	return dot > 0 && PLAIN_EXTENSION.test(extension) ? [name.slice(0, dot), extension] : null;
};
