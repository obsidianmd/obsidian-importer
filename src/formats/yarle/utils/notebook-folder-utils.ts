const notebookStackSeparator = '@@@';

let slashesRe = /[/\\]/g;
let illegalRe = /[\?<>:\*\|"]/g;
let controlRe = /[\x00-\x1f\x80-\x9f]/g;
let reservedRe = /^\.+$/;
let windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
let windowsTrailingRe = /[\. ]+$/;
let startsWithDotRe = /^\./;
let badLinkRe = /[\[\]#|^]/g;

export function sanitizeNotebookFolderName(name: string): string {
	const sanitized = name
		.replace(slashesRe, '-')
		.replace(illegalRe, '')
		.replace(controlRe, '')
		.replace(reservedRe, '')
		.replace(windowsTrailingRe, '')
		.replace(windowsReservedRe, '')
		.replace(startsWithDotRe, '')
		.replace(badLinkRe, '');

	return sanitized.trim() || 'Untitled';
}

export function getNotebookNameAndFolderNames(basename: string): { notebookName: string, notebookFolderNames: string[] } {
	const notebookFolderNames = basename.split(notebookStackSeparator);

	let notebookName = notebookFolderNames.pop();
	if (!notebookName) {
		notebookName = basename;
	}
	return {
		notebookName,
		notebookFolderNames
	};
}

export function getSanitizedNotebookFolderNames(basename: string): string[] {
	const { notebookFolderNames } = getNotebookNameAndFolderNames(basename);
	return notebookFolderNames.map(sanitizeNotebookFolderName);
}
