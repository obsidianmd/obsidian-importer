// iOS < 16.4 does not support regex lookbehinds. Use a capture group plus
// matchAll() to extract the inner UID instead of `(?<=\(\()...(?=\)\))`.
export const blockRefRegex = /\(\(\b(.*?)\b\)\)/g;

export function extractBlockReferenceUIDs(input: string): string[] {
	return Array.from(input.matchAll(blockRefRegex), m => m[1]);
}
