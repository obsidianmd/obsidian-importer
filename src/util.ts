import { FrontMatterCache, stringifyYaml } from 'obsidian';

export { sanitizeFileName } from './sanitize-file-name';

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
