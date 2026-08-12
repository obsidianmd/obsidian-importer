// iOS < 16.4 does not support regex lookbehinds. Use a capture group plus
// matchAll() to extract the inner UID instead of `(?<=\(\()...(?=\)\))`.
export const blockRefRegex = /\(\(\b(.*?)\b\)\)/g;

export function extractBlockReferenceUIDs(input: string): string[] {
	return Array.from(input.matchAll(blockRefRegex), m => m[1]);
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
