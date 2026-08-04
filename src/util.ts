import { FrontMatterCache, stringifyYaml, TAbstractFile, Vault, normalizePath } from 'obsidian';

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
 * Vault.getAvailablePath and getAbstractFileByPathInsensitive exist at runtime
 * but are not exported in obsidian.d.ts.
 */
type VaultInternals = Vault & {
	getAvailablePath?(base: string, extension?: string): string;
	getAbstractFileByPathInsensitive?(path: string): TAbstractFile | null;
};

/**
 * Look up a file or folder, ignoring case.
 *
 * Vault.getAbstractFileByPath is an exact key match on the vault's file map, but
 * macOS and Windows filesystems are case-insensitive: "Tron.md" and "TRON.md"
 * are one file on disk while the public lookup reports only the exact spelling
 * as existing, so a caller relying on it never sees the conflict.
 *
 * Only for questions of the form "does this already exist?". To pick a path to
 * create at, use getUniqueFilePath, which asks the vault for a free one.
 */
export function getAbstractFileByPathInsensitive(vault: Vault, path: string): TAbstractFile | null {
	const insensitive = (vault as VaultInternals).getAbstractFileByPathInsensitive;
	if (typeof insensitive === 'function') {
		return insensitive.call(vault, path);
	}
	return vault.getAbstractFileByPath(path);
}

/**
 * Get a free path to create a file at, appending 1, 2, etc. if needed.
 *
 * Defers to Vault.getAvailablePath, which is what Obsidian itself uses when
 * creating a note. It applies the same "space + number" convention and compares
 * case-insensitively, so it will not hand back a path that collides with an
 * existing file on a case-insensitive filesystem.
 *
 * @param vault - Obsidian vault instance
 * @param parentPath - Parent folder path
 * @param fileName - File name with extension (e.g., "note.md")
 * @returns Path that no existing file occupies
 */
export function getUniqueFilePath(vault: Vault, parentPath: string, fileName: string): string {
	const lastDotIndex = fileName.lastIndexOf('.');
	const hasExtension = lastDotIndex > 0;
	const base = normalizePath(`${parentPath}/${hasExtension ? fileName.slice(0, lastDotIndex) : fileName}`);
	const extension = hasExtension ? fileName.slice(lastDotIndex + 1) : undefined;

	const getAvailablePath = (vault as VaultInternals).getAvailablePath;
	if (typeof getAvailablePath === 'function') {
		return getAvailablePath.call(vault, base, extension);
	}

	// Fallback for an app version without it: same convention, same comparison
	let counter = 1;
	let finalPath = normalizePath(`${parentPath}/${fileName}`);
	while (getAbstractFileByPathInsensitive(vault, finalPath)) {
		finalPath = normalizePath(`${base} ${counter}${hasExtension ? `.${extension}` : ''}`);
		counter++;
	}
	return finalPath;
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

export function uint8arrayToArrayBuffer(input: Uint8Array<ArrayBuffer>): ArrayBuffer {
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
