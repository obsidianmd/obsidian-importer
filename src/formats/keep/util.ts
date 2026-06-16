import type { KeepAnnotation } from './models';

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

function normalizeAnnotationText(value: string | undefined): string {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeMarkdownLinkText(text: string): string {
	return text
		.replace(/\\/g, '\\\\')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]');
}

function formatAnnotationLinkUrl(url: string): string {
	return `<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
}

function formatAnnotationPrimaryText(annotation: KeepAnnotation): string {
	const title = normalizeAnnotationText(annotation.title);
	const url = normalizeAnnotationText(annotation.url);
	const description = normalizeAnnotationText(annotation.description);

	if (title && url) {
		return `[${escapeMarkdownLinkText(title)}](${formatAnnotationLinkUrl(url)})`;
	}
	if (url) {
		return formatAnnotationLinkUrl(url);
	}
	if (title) {
		return title;
	}

	return description;
}

export function formatAnnotations(annotations: KeepAnnotation[] | undefined): string {
	const annotationLines: string[] = [];

	for (const annotation of annotations ?? []) {
		const primaryText = formatAnnotationPrimaryText(annotation);
		if (!primaryText) continue;

		annotationLines.push(`- ${primaryText}`);

		const title = normalizeAnnotationText(annotation.title);
		const description = normalizeAnnotationText(annotation.description);
		if (description && description !== primaryText && description !== title) {
			annotationLines.push(`  ${description}`);
		}
	}

	if (annotationLines.length === 0) {
		return '';
	}

	return `## Annotations\n\n${annotationLines.join('\n')}`;
}
