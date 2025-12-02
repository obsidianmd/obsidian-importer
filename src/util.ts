import { FrontMatterCache, stringifyYaml, Vault, normalizePath } from 'obsidian';

let illegalRe = /[\/\?<>\\:\*\|"]/g;
let controlRe = /[\x00-\x1f\x80-\x9f]/g;
let reservedRe = /^\.+$/;
let windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
let windowsTrailingRe = /[\. ]+$/;
let startsWithDotRe = /^\./; // Regular expression to match filenames starting with "."
let badLinkRe = /[\[\]#|^]/g; // Regular expression to match characters that interferes with links: [ ] # | ^

// I think we should first remove illegal characters such as spaces and periods, and then check whether it is a Windows reserved word.
export function sanitizeFileName(name: string) {
	const sanitized = name
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
 * Get a unique file path by appending 1, 2, etc. if needed
 * Uses the same naming convention as Obsidian's attachment deduplication (space + number)
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
	
	// Use getAbstractFileByPath for synchronous check
	while (vault.getAbstractFileByPath(finalPath)) {
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

export function uint8arrayToArrayBuffer(input: Uint8Array): ArrayBuffer {
	// Slice to ensure we only return the portion of the buffer that corresponds to this view
	// Use slice which creates a new ArrayBuffer (not SharedArrayBuffer)
	return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
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
