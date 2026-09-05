import { sanitizeTag as stripIllegalTagChars } from '../../util';

/**
 * Searches a string for characters unsupported by Obsidian in the tag body and returns a sanitized string.
 * If the # symbol is included at the start or anywhere else it will be removed.
 */

export function sanitizeTag(name: string): string {
	// Remove problem characters
	let tagName = stripIllegalTagChars(name);
	// Convert spaces to hyphens
	tagName = tagName.split(' ').join('-');
	// Prevent tags starting with a number
	if (!isNaN(Number(tagName[0]))) {
		tagName = '_' + tagName;
	}

	return tagName;
}

/**
 * Normalizes inline hashtags that correspond to labels exported with the note.
 *
 * Keep does not distinguish arbitrary `#` text from label mentions in the note
 * body. Restricting this to known labels avoids treating URL fragments,
 * issue numbers, and punctuation after ordinary hashtags as part of a tag.
 */

export function sanitizeTags(str: string, labels: readonly string[]): string {
	const uniqueLabels = Array.from(new Set(labels.filter(Boolean)))
		.sort((left, right) => right.length - left.length);

	for (const label of uniqueLabels) {
		const literal = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// Punctuation and Markdown delimiters may precede a tag. URL/word
		// characters may not: excluding them leaves fragments and issue#123 alone.
		const labelMention = new RegExp(
			`(^|[^\\p{L}\\p{N}_/#:?&=%-])\\\\?#${literal}(?![\\p{L}\\p{N}_/-])`,
			'gu',
		);
		str = str.replace(labelMention, (_match, prefix: string) => `${prefix}#${sanitizeTag(label)}`);
	}

	return str;
}

/**
 * Takes a string and returns in lowercase with the first letter capitalised.
 */

export function toSentenceCase(str: string) {
	return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
