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

/** Vault.getAbstractFileByPathInsensitive exists at runtime but is not exported in obsidian.d.ts */
type VaultWithInsensitiveLookup = Vault & {
	getAbstractFileByPathInsensitive?(path: string): TAbstractFile | null;
};

/**
 * Look up a file or folder, ignoring case.
 *
 * Vault.getAbstractFileByPath is an exact key match on the vault's file map, but
 * macOS and Windows filesystems are case-insensitive: "Tron.md" and "TRON.md"
 * are one file on disk while the public lookup reports only the exact spelling
 * as existing. Creating the second then fails with "File already exists", and
 * any caller relying on the public lookup to detect a conflict never sees it.
 *
 * Obsidian implements the comparison we need but does not export it, so it is
 * called through a cast, with the public lookup as a fallback in case it is ever
 * renamed or is missing on an older app version.
 */
export function getAbstractFileByPathInsensitive(vault: Vault, path: string): TAbstractFile | null {
	const insensitive = (vault as VaultWithInsensitiveLookup).getAbstractFileByPathInsensitive;
	if (typeof insensitive === 'function') {
		return insensitive.call(vault, path);
	}
	return vault.getAbstractFileByPath(path);
}

/**
 * Get a unique file path by appending 1, 2, etc. if needed
 * Uses the same naming convention as Obsidian's attachment deduplication (space + number)
 *
 * Matching ignores case, so a vault that already holds "Tron.md" yields
 * "Tron 1.md" for an incoming "TRON.md" rather than a path that collides on
 * disk.
 *
 * @param vault - Obsidian vault instance
 * @param parentPath - Parent folder path
 * @param fileName - File name with extension (e.g., "note.md")
 * @returns Unique file path that doesn't conflict with existing files
 */
export function getUniqueFilePath(vault: Vault, parentPath: string, fileName: string): string {
	let basePath = normalizePath(`${parentPath}/${fileName}`);
	let finalPath = basePath;
	let counter = 1;

	// Synchronous check; case-insensitive to match the filesystem
	while (getAbstractFileByPathInsensitive(vault, finalPath)) {
		// Insert counter before file extension
		const lastDotIndex = fileName.lastIndexOf('.');
		if (lastDotIndex > 0) {
			const nameWithoutExt = fileName.substring(0, lastDotIndex);
			const ext = fileName.substring(lastDotIndex);
			finalPath = normalizePath(`${parentPath}/${nameWithoutExt} ${counter}${ext}`);
		}
		else {
			finalPath = normalizePath(`${parentPath}/${fileName} ${counter}`);
		}
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
