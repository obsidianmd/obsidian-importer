function escapeRegex(str: string): string {
	return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

const ILLEGAL_CHARACTERS = '\\/:*?<>\"|';
const ILLEGAL_FILENAME_RE = new RegExp('[' + escapeRegex(ILLEGAL_CHARACTERS) + ']', 'g');

export function sanitizeFileName(name: string) {
	return name.replace(ILLEGAL_FILENAME_RE, '');
}

export function pathToFilename(path: string) {
	if (!path.contains('/')) return path;

	let lastSlashPosition = path.lastIndexOf('/');
	return path.slice(lastSlashPosition + 1);
}

export function pathToBasename(path: string) {
	return splitFilename(pathToFilename(path)).basename;
}

export function splitFilename(filename: string) {
	let lastDotPosition = filename.lastIndexOf('.');

	if (lastDotPosition === -1 || lastDotPosition === filename.length - 1 || lastDotPosition === 0) {
		return { basename: filename, extension: "" };
	}

	return { basename: filename.slice(0, lastDotPosition), extension: filename.slice(lastDotPosition + 1) };
}
