let slashesRe = /[/\\]/g;
let illegalRe = /[\?<>:\*\|"]/g;
let controlRe = /[\x00-\x1f\x80-\x9f]/g;
let reservedRe = /^\.+$/;
let windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
let windowsTrailingRe = /[\. ]+$/;
let startsWithDotRe = /^\./;
let badLinkRe = /[\[\]#|^]/g;

export function sanitizeFileName(name: string) {
	const sanitized = name
		.replace(slashesRe, '-')
		.replace(illegalRe, '')
		.replace(controlRe, '')
		.replace(reservedRe, '')
		.replace(windowsTrailingRe, '')
		.replace(windowsReservedRe, '')
		.replace(startsWithDotRe, '')
		.replace(badLinkRe, '');

	const trimmed = sanitized.trim();
	return trimmed || 'Untitled';
}

export function sanitizeFilePath(filePath: string) {
	return filePath
		.split(slashesRe)
		.map(segment => segment.trim())
		.filter(segment => segment.length > 0)
		.map(sanitizeFileName)
		.join('/');
}
