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
	return splitFilename(pathToFilename(path))[0];
}

export function splitFilename(filename: string): [basename: string, extension: string] {
	let lastDotPosition = filename.lastIndexOf('.');

	if (lastDotPosition === -1 || lastDotPosition === filename.length - 1 || lastDotPosition === 0) {
		return [filename, ""];
	}

	return [filename.slice(0, lastDotPosition), filename.slice(lastDotPosition + 1)];
}
