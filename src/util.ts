import { App, FrontMatterCache, stringifyYaml, Vault, normalizePath } from 'obsidian';

let slashesRe = /[/\\]/g;
let illegalRe = /[?<>:*|"]/g;
let reservedRe = /^\.+$/;
let windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
let windowsTrailingRe = /[. ]+$/;
let startsWithDotRe = /^\./; // Regular expression to match filenames starting with "."
let badLinkRe = /[[\]#|^]/g; // Regular expression to match characters that interferes with links: [ ] # | ^

/**
 * Drop the control characters a file name cannot contain: C0 (U+0000-U+001F)
 * and C1 (U+0080-U+009F).
 *
 * A filter rather than a regex because the equivalent character class has to
 * spell out control characters, which is worth avoiding in source.
 */
export function stripControlCharacters(name: string): string {
	let out = '';
	for (const ch of name) {
		// Surrogate pairs read as their lead unit here, which is above the C1
		// range, so astral characters are kept.
		const code = ch.charCodeAt(0);
		if (code <= 0x1f || (code >= 0x80 && code <= 0x9f)) continue;
		out += ch;
	}
	return out;
}

// First remove illegal characters such as spaces and periods, then check for Windows reserved words.
//
// A missing name is allowed, and lands on the same "Untitled" every empty name
// does. Titles arrive optional from most sources, and every caller spelling its
// own `|| 'Untitled'` is one more place for that default to drift.
export function sanitizeFileName(name: string | undefined | null) {
	const sanitized = stripControlCharacters(
		(name ?? '')
			.replace(slashesRe, '-') // Replace slashes with dash
			.replace(illegalRe, ''))
		.replace(reservedRe, '')
		.replace(windowsTrailingRe, '')
		.replace(windowsReservedRe, '')
		.replace(startsWithDotRe, '')
		.replace(badLinkRe, '');

	// If the result is empty or only whitespace after sanitization, return a default name
	// This prevents creating files like ".md" (no name) or folders with only spaces
	const trimmed = sanitized.trim();
	return trimmed || 'Untitled';
}

/**
 * Make a path out of names that came from the source.
 *
 * Each segment becomes a folder, so each has to survive as one: a CSV template
 * like `{{Category}}/{{Name}}` puts a cell value straight into a path, and a
 * value ending in a period is a folder Windows will create and then refuse to
 * open. The same rule note titles go through, applied a segment at a time so
 * the separators survive it.
 *
 * A segment left empty contributes nothing, rather than becoming a folder
 * called "Untitled".
 */
export function sanitizeFilePath(path: string): string {
	return path
		.split('/')
		.filter(segment => segment.trim())
		.map(segment => sanitizeFileName(segment))
		.join('/');
}

/**
 * Get a free path to create a file or folder at, appending 1, 2, etc. if needed.
 *
 * Defers to Vault.getAvailablePath, which is what Obsidian itself uses when
 * creating a note. A folder is just a path with no extension.
 *
 * @param vault - Obsidian vault instance
 * @param parentPath - Parent folder path
 * @param fileName - File name with extension (e.g., "note.md"), or a folder name
 * @returns Path that no existing file occupies
 */
export function getUniqueFilePath(vault: Vault, parentPath: string, fileName: string): string {
	const lastDotIndex = fileName.lastIndexOf('.');
	const hasExtension = lastDotIndex > 0;
	const base = normalizePath(`${parentPath}/${hasExtension ? fileName.slice(0, lastDotIndex) : fileName}`);

	return vault.getAvailablePath(base, hasExtension ? fileName.slice(lastDotIndex + 1) : undefined);
}

/**
 * Assign types to the properties an import created, using Obsidian's
 * metadataTypeManager.
 *
 * Only properties without a type yet are assigned, so a type the user set by
 * hand — or one an earlier import already settled on — is left alone.
 */
export function updatePropertyTypes(app: App, propertyTypes: Record<string, string>): void {
	for (const [propName, propType] of Object.entries(propertyTypes)) {
		if (!app.metadataTypeManager.getAssignedWidget(propName)) {
			app.metadataTypeManager.setType(propName, propType);
		}
	}
}

/**
 * A count and the thing counted, pluralised.
 *
 * The count is always in hand where this is used, so "1 record" and "2
 * records" rather than "record(s)". Only the regular -s rule: every noun it is
 * given takes one.
 */
export function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function genUid(length: number): string {
	let array: string[] = [];
	for (let i = 0; i < length; i++) {
		array.push((Math.random() * 16 | 0).toString(16));
	}
	return array.join('');
}

export function parseHTML(html: string): HTMLElement {
	return new DOMParser().parseFromString(html, 'text/html').documentElement;
}

function uint8arrayToArrayBuffer(input: Uint8Array<ArrayBuffer>): ArrayBuffer {
	// Slice to ensure we only return the portion of the buffer that corresponds to this view
	// Use slice which creates a new ArrayBuffer (not SharedArrayBuffer)
	return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
}

export function stringToUtf8(text: string): ArrayBuffer {
	return uint8arrayToArrayBuffer(new TextEncoder().encode(text));
}

export function serializeFrontMatter(frontMatter: FrontMatterCache): string {
	if (!Object.isEmpty(frontMatter)) {
		return '---\n' + stringifyYaml(frontMatter) + '---\n';
	}

	return '';
}

export function truncateText(text: string, limit: number, ellipses: string = '...') {
	if (text.length < limit) {
		return text;
	}

	return text.substring(0, limit) + ellipses;
}

export function extractErrorMessage(error: unknown): string | undefined {
	if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
		return error.message;
	}
	return undefined;
}
