import { App, FrontMatterCache, parseYaml, stringifyYaml, Vault, normalizePath } from 'obsidian';

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

/**
 * The longest a single file or folder name may be, in UTF-8 bytes.
 *
 * macOS and Linux cap a path component at 255 bytes, Windows at 255 UTF-16
 * units - and 240 UTF-8 bytes is at most 240 UTF-16 units, so one budget
 * covers all three. The 15 left over are for what gets added after a name is
 * sanitized: an extension, and the ` 1` a collision appends.
 *
 * A source that has no title of its own gives the first line of the note
 * instead, which is how a paragraph ends up being asked for as a file name.
 */
const MAX_NAME_BYTES = 240;

const encoder = new TextEncoder();

function limitNameLength(name: string): string {
	if (encoder.encode(name).length <= MAX_NAME_BYTES) return name;

	// Iterating a string yields code points, so a surrogate pair is never cut
	// in half - and counting each one's own encoding keeps the byte budget
	// exact for scripts that spend more than one byte per character.
	let truncated = '';
	let bytes = 0;

	for (const character of name) {
		const size = encoder.encode(character).length;
		if (bytes + size > MAX_NAME_BYTES) break;
		truncated += character;
		bytes += size;
	}

	// End on a word rather than mid-word, but not at the cost of most of the
	// name: a title with no spaces near the cut keeps the hard truncation.
	const lastSpace = truncated.lastIndexOf(' ');
	if (lastSpace > truncated.length / 2) truncated = truncated.slice(0, lastSpace);

	return truncated;
}

export function sanitizeFileName(name: string | undefined | null) {
	const sanitized = limitNameLength(stripControlCharacters(
		(name ?? '')
			.replace(slashesRe, '-') // Replace slashes with dash
			.replace(illegalRe, ''))
		.replace(reservedRe, '')
		.replace(windowsTrailingRe, '')
		.replace(windowsReservedRe, '')
		.replace(badLinkRe, '')
		.replace(startsWithDotRe, ''))
		// Truncating can uncover a trailing dot or space, which Windows refuses
		.replace(windowsTrailingRe, '');

	// If the result is empty or only whitespace after sanitization, return a default name
	// This prevents creating files like ".md" (no name) or folders with only spaces
	const trimmed = sanitized.trim();
	return trimmed || 'Untitled';
}

export function sanitizeFilePath(path: string): string {
	// Sanitize each segment without flattening the folder structure.
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

/** Whatever an importer passed as a reason, as something a person can read. */
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
