import { moment } from 'obsidian';

let illegalReNoDir = /[\?<>\\:\*\|"]/g;
let controlRe = /[\x00-\x1f\x80-\x9f]/g;
let reservedRe = /^\.+$/;
let windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
let windowsTrailingRe = /[\. ]+$/;
let startsWithDotRe = /^\./; // Regular expression to match filenames starting with "."
let squareBracketOpenRe = /\[/g; // Regular expression to match "["
let squareBracketCloseRe = /\]/g; // Regular expression to match "]"

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

export function getUserDNPFormat() {
	// @ts-expect-error : Internal Method
	const dailyNotePluginInstance = app.internalPlugins.getPluginById('daily-notes').instance;
	if (!dailyNotePluginInstance) throw new Error('Daily note plugin is not enabled');
	let dailyPageFormat = dailyNotePluginInstance.options.format;
	if (!dailyPageFormat) {
		dailyPageFormat = 'YYYY-MM-DD'; // Default format
	}
	return dailyPageFormat;
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