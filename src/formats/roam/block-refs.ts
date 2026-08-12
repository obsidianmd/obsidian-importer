// Avoid lookbehind for iOS versions before 16.4.
export const blockRefRegex = /\(\(\b(.*?)\b\)\)/g;

export function extractBlockReferenceUIDs(input: string): string[] {
	return Array.from(input.matchAll(blockRefRegex), m => m[1]);
}

/** Distinguishes Roam IDs from ordinary double-parenthesized text. */
export function looksLikeBlockId(text: string): boolean {
	return /^[A-Za-z0-9_-]{9}$/.test(text);
}

export type BlockTarget = string;
