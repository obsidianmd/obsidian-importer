import { App, FrontMatterCache, stringifyYaml, Vault, normalizePath } from 'obsidian';

let slashesRe = /[/\\]/g;
let illegalRe = /[\?<>:\*\|"]/g;
let controlRe = /[\x00-\x1f\x80-\x9f]/g;
let reservedRe = /^\.+$/;
let windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
let windowsTrailingRe = /[\. ]+$/;
let startsWithDotRe = /^\./; // Regular expression to match filenames starting with "."
let badLinkRe = /[\[\]#|^]/g; // Regular expression to match characters that interferes with links: [ ] # | ^

// First remove illegal characters such as spaces and periods, then check for Windows reserved words.
export function sanitizeFileName(name: string) {
	const sanitized = name
		.replace(slashesRe, '-') // Replace slashes with dash
		.replace(illegalRe, '')
		.replace(controlRe, '')
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
