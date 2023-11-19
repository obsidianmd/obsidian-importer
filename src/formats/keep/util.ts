let potentialTagsRe = /(#[^ ^#]*)/g; // Finds any non-whitespace sections starting with #
let illegalTagCharsRe = /[\\:*?<>\"|!@#$%^&()+=\`\'~;,.]/g;

/**
 * Searches a string for characters unsupported by Obsidian in the tag body and returns a sanitized string.
 * If the # symbol is included at the start or anywhere else it will be removed.
 */

export function sanitizeTag(name: string): string {
	// Remove problem characters
	let tagName = name
		.replace(illegalTagCharsRe, '');
	// Convert spaces to hyphens	
	tagName = tagName.split(' ').join('-');
	// Prevent tags starting with a number
	if (!isNaN(tagName[0] as any)) {
		tagName = '_' + tagName;
	}

	return tagName;
}

/**
 * Searches a string for tags that include characters unsupported in tags by Obsidian.
 * Returns a string with those hastags normalised.
 */

export function sanitizeTags(str: string): string {
	return str.replace(potentialTagsRe, (str: string): string => {
		return '#' + sanitizeTag(str);
	});
}

/**
 * Takes a string and returns in lowercase with the first letter capitalised.
 */

export function toSentenceCase(str: string) {
	return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
