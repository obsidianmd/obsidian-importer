// folder/test.md => test.md
export function getOwnName(path: string): string {
	let lastSlashPosition = path.lastIndexOf('/');

	if (lastSlashPosition === -1) {
		return path;
	}
	// skip the '/'
	return path.slice(lastSlashPosition + 1);
}


// folder/test.md => test
export function baseFileName(path: string) {
	let filename = getOwnName(path);
	let pos = filename.lastIndexOf('.');

	if (pos === -1 || pos === filename.length - 1 || pos === 0) {
		return filename;
	}

	return filename.substr(0, pos);
}

function escapeRegex(str: string): string {
	return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

const ILLEGAL_CHARACTERS = '\\/:*?<>\"|';
const ILLEGAL_FILENAME_RE = new RegExp('[' + escapeRegex(ILLEGAL_CHARACTERS) + ']', 'g');

export function sanitizeFileName(name: string) {
        return name.replace(ILLEGAL_FILENAME_RE, '');
}