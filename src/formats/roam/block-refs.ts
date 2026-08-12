// iOS < 16.4 does not support regex lookbehinds. Use a capture group plus
// matchAll() to extract the inner UID instead of `(?<=\(\()...(?=\)\))`.
export const blockRefRegex = /\(\(\b(.*?)\b\)\)/g;

export function extractBlockReferenceUIDs(input: string): string[] {
	return Array.from(input.matchAll(blockRefRegex), m => m[1]);
}

/**
 * Whether what stands in the double parentheses is a block id at all.
 *
 * Roam writes one as nine characters of its own alphabet, and `((...))` around
 * anything else is somebody's parenthesis: a whole clause, a URL, an aside. In
 * a graph of 1,107 pages thirteen of the thirty-one that resolved to nothing
 * were of that kind, so treating them as references and dropping the ones that
 * do not resolve would take a sentence out of the middle of a note.
 */
export function looksLikeBlockId(text: string): boolean {
	return /^[A-Za-z0-9_-]{9}$/.test(text);
}

/**
 * Where a block sits, for a reference or an embed that has to reach it: the
 * note and the anchor on it, as Obsidian writes a link target.
 *
 * Only the target, never a copy of what the block says. Roam shows a
 * referenced block's text in place of the reference, and the importer used to
 * copy that text into the link's alias to match - but a copy goes stale the
 * first time the block is edited, cannot hold a block of more than one line,
 * and ends the link early on any `]]` in it (#246, #247).
 */
export type BlockTarget = string;
