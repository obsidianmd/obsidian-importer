// Whitespace cleanup for imported Logseq content. Obsidian-free and pure so it
// stays unit-testable. Source graphs accumulate trailing whitespace, lone empty
// bullets, and non-breaking spaces (from Confluence/Word paste); this removes
// them while leaving fenced code blocks and intentional blank lines untouched.

// A lone bullet with nothing but optional whitespace after the dash.
const EMPTY_BULLET = /^\s*-\s*$/;
// An empty bullet that still carries a block anchor, e.g. `- ^abc123` — kept
// because the anchor may be referenced elsewhere.
const ANCHOR_BULLET = /^\s*-\s+\^[A-Za-z0-9_-]+\s*$/;

export function normalizeWhitespace(content: string): string {
	const out: string[] = [];
	let inFence = false;
	for (const line of content.split('\n')) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			out.push(line);
			continue;
		}
		if (inFence) {
			out.push(line);
			continue;
		}
		// Drop lone empty bullets, but keep ones that carry a block anchor.
		if (EMPTY_BULLET.test(line) && !ANCHOR_BULLET.test(line)) {
			continue;
		}
		// Normalize non-breaking spaces, then strip trailing whitespace.
		out.push(line.replace(/\u00A0/g, ' ').replace(/[ \t]+$/, ''));
	}
	return out.join('\n');
}
