import { App, FrontMatterCache, parseYaml, Platform, stringifyYaml, Vault, normalizePath } from 'obsidian';

const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontMatterBlock(content: string): { frontMatter: FrontMatterCache, body: string } | null {
	const match = FRONT_MATTER_PATTERN.exec(content);
	if (!match) {
		return null;
	}

	try {
		const parsed = parseYaml(match[1]);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null;
		}
		return { frontMatter: parsed as FrontMatterCache, body: content.slice(match[0].length) };
	}
	catch {
		return null;
	}
}

let slashesRe = /[/\\]/g;
let illegalRe = /[?<>:*|"]/g;
let reservedRe = /^\.+$/;
let windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
let windowsTrailingRe = /[. ]+$/;
let startsWithDotRe = /^[.\s]+/;
let badLinkRe = /[[\]#|^]/g; // Regular expression to match characters that interferes with links: [ ] # | ^

export function stripControlCharacters(name: string): string {
	// Remove C0 and C1 control characters from filesystem names.
	let out = '';
	for (const ch of name) {
		const code = ch.charCodeAt(0);
		if (code <= 0x1f || (code >= 0x80 && code <= 0x9f)) continue;
		out += ch;
	}
	return out;
}

// Leave room below common 255-byte/unit limits for extensions and collision suffixes.
const MAX_NAME_BYTES = 240;

// Reserve 100 characters of Windows' path limit for the vault's location.
const WINDOWS_PATH_CHARS = 160;

// Leave room for `.md` and collision suffixes such as ` 99`.
const NAME_TAIL_CHARS = 8;

// Keep names readable when the parent path already exceeds the budget.
const MIN_NAME_CHARS = 24;

const encoder = new TextEncoder();

function charsAvailable(parentPath: string | undefined): number {
	if (!Platform.isWin) return Infinity;

	const used = parentPath ? parentPath.length + 1 : 0;
	return Math.max(MIN_NAME_CHARS, WINDOWS_PATH_CHARS - used - NAME_TAIL_CHARS);
}

function limitNameLength(name: string, maxChars: number): string {
	// UTF-8 needs at most three bytes per UTF-16 unit.
	if (name.length <= maxChars
		&& (name.length * 3 <= MAX_NAME_BYTES || encoder.encode(name).length <= MAX_NAME_BYTES)) return name;

	// Iteration by code point keeps surrogate pairs intact.
	let truncated = '';
	let bytes = 0;

	for (const character of name) {
		const size = encoder.encode(character).length;
		if (bytes + size > MAX_NAME_BYTES) break;
		if (truncated.length + character.length > maxChars) break;
		truncated += character;
		bytes += size;
	}

	const lastSpace = truncated.lastIndexOf(' ');
	if (lastSpace > truncated.length / 2) truncated = truncated.slice(0, lastSpace);

	return truncated;
}

function tidyName(name: string): string {
	return name
		.replace(reservedRe, '')
		.replace(windowsTrailingRe, '')
		.replace(windowsReservedRe, '')
		.replace(badLinkRe, '')
		.replace(startsWithDotRe, '');
}

/** @param parentPath Vault-relative parent folder. */
export function sanitizeFileName(name: string | undefined | null, parentPath?: string) {
	// Match the vault's NFC form before measuring or comparing the name.
	const cleaned = tidyName(stripControlCharacters(
		(name ?? '')
			.normalize('NFC')
			.replace(slashesRe, '-') // Replace slashes with dash
			.replace(illegalRe, '')));

	// Reapply trailing-space and reserved-name rules after truncation.
	const limited = limitNameLength(cleaned, charsAvailable(parentPath));
	const sanitized = limited === cleaned ? cleaned : tidyName(limited);

	// If the result is empty or only whitespace after sanitization, return a default name
	// This prevents creating files like ".md" (no name) or folders with only spaces
	const trimmed = sanitized.trim();
	return trimmed || 'Untitled';
}

/** parentPath counts toward Windows' limit but is not sanitized or returned. */
export function sanitizeFilePath(path: string, parentPath = ''): string {
	// Apply Windows' whole-path budget cumulatively.
	let built = parentPath;
	let sanitized = '';

	for (const segment of path.split('/')) {
		if (!segment.trim()) continue;
		const name = sanitizeFileName(segment, built);
		built = built ? `${built}/${name}` : name;
		sanitized = sanitized ? `${sanitized}/${name}` : name;
	}

	return sanitized;
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

export function availableFileName(fileName: string, isTaken: (candidate: string) => boolean): string {
	const lastDotIndex = fileName.lastIndexOf('.');
	const hasExtension = lastDotIndex > 0;
	const base = hasExtension ? fileName.slice(0, lastDotIndex) : fileName;
	const extension = hasExtension ? fileName.slice(lastDotIndex) : '';

	for (let index = 0; ; index++) {
		const candidate = index === 0 ? fileName : `${base} ${index}${extension}`;
		if (!isTaken(candidate)) return candidate;
	}
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

// Obsidian rejects these punctuation ranges; tags may use any script.
export const ILLEGAL_TAG_CHARS = '\\u2000-\\u206f\\u2e00-\\u2e7f\'!"#$%&()*+,.:;<=>?@^`{|}~[\\]\\\\';

const illegalTagRe = new RegExp(`[${ILLEGAL_TAG_CHARS}]`, 'gu');

export function sanitizeTag(name: string, replacement = ''): string {
	return name.replace(/^#/, '').replace(illegalTagRe, replacement);
}

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

export function uint8arrayToArrayBuffer(input: Uint8Array<ArrayBuffer>): ArrayBuffer {
	// Slice to ensure we only return the portion of the buffer that corresponds to this view
	// Use slice which creates a new ArrayBuffer (not SharedArrayBuffer)
	return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
}

export function stringToUtf8(text: string): ArrayBuffer {
	return uint8arrayToArrayBuffer(encoder.encode(text));
}

export function serializeFrontMatter(frontMatter: FrontMatterCache): string {
	if (!Object.isEmpty(frontMatter)) {
		return '---\n' + stringifyYaml(frontMatter) + '---\n';
	}

	return '';
}

export function describeReason(reason: unknown): string {
	if (typeof reason === 'string') return reason;

	const message = extractErrorMessage(reason);
	if (message !== undefined) return message;

	try {
		return JSON.stringify(reason) ?? String(reason);
	}
	catch {
		return String(reason);
	}
}

export function extractErrorMessage(error: unknown): string | undefined {
	if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
		return error.message;
	}
	return undefined;
}

export function extensionFromBytes(bytes: Uint8Array): string | null {
	const magic = (offset: number, ...signature: number[]) =>
		signature.every((byte, i) => bytes[offset + i] === byte);

	const tag = (offset: number) =>
		String.fromCharCode(...bytes.subarray(offset, offset + 4));

	if (magic(0, 0x89, 0x50, 0x4e, 0x47)) return 'png';
	if (magic(0, 0xff, 0xd8, 0xff)) return 'jpg';
	if (magic(0, 0x47, 0x49, 0x46, 0x38)) return 'gif';
	if (magic(0, 0x25, 0x50, 0x44, 0x46)) return 'pdf';
	if (magic(0, 0x49, 0x49, 0x2a, 0x00) || magic(0, 0x4d, 0x4d, 0x00, 0x2a)) return 'tiff';
	if (magic(0, 0x42, 0x4d)) return 'bmp';
	if (magic(0, 0x1f, 0x8b)) return 'gz';
	if (magic(0, 0x49, 0x44, 0x33)) return 'mp3';

	if (tag(0) === 'RIFF') {
		if (tag(8) === 'WEBP') return 'webp';
		if (tag(8) === 'WAVE') return 'wav';
	}

	if (tag(4) === 'ftyp') {
		// ISO base media files identify their format with a brand after ftyp.
		const brand = tag(8);
		if (brand.startsWith('avi')) return 'avif';
		if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1') return 'heic';
		if (brand.startsWith('qt')) return 'mov';
		return 'mp4';
	}

	if (magic(0, 0x50, 0x4b, 0x03, 0x04)) return 'zip';

	return null;
}
