import { moment } from 'obsidian';

const illegalReNoDir = /[\?<>\\:\*\|"]/g;
const controlRe = /[\x00-\x1f\x80-\x9f]/g;
const reservedRe = /^\.+$/;
const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const windowsTrailingRe = /[\. ]+$/;
const startsWithDotRe = /^\./; // Regular expression to match filenames starting with "."
const squareBracketOpenRe = /\[/g; // Regular expression to match "["
const squareBracketCloseRe = /\]/g; // Regular expression to match "]"

export function sanitizeFileNameKeepPath(name: string) {
	return name
		.replace(illegalReNoDir, '')
		.replace(controlRe, '')
		.replace(reservedRe, '')
		.replace(windowsReservedRe, '')
		.replace(windowsTrailingRe, '')
		.replace(squareBracketOpenRe, '')
		.replace(squareBracketCloseRe, '')
		.replace(startsWithDotRe, '');
}

export function convertDateString(dateString: string, newFormat: string): string {
	const validFormat = 'MMMM Do, YYYY';
	const dateObj = moment(dateString, validFormat);

	if (dateObj.format(validFormat) !== dateString) {
		// The input date string does not match the specified format
		return dateString;
	}

	if (dateObj.isValid()) {
		return dateObj.format(newFormat);
	}
	else {
		// Handle the case where the input string is not a valid date
		return dateString;
	}
}