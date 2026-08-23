// Whitespace cleanup for imported Logseq content. Obsidian-free and pure so it
// stays unit-testable. Source graphs accumulate trailing whitespace, lone empty
// bullets, and non-breaking spaces (from Confluence/Word paste); this removes
// them while leaving fenced code blocks and intentional blank lines untouched.

import { outsideMarkdownFences } from '../../markdown';

// A lone bullet with nothing but optional whitespace after the dash.
const EMPTY_BULLET = /^\s*-\s*$/;
// An empty bullet that still carries a block anchor, e.g. `- ^abc123` — kept
// because the anchor may be referenced elsewhere.
const ANCHOR_BULLET = /^\s*-\s+\^[A-Za-z0-9_-]+\s*$/;

export function normalizeWhitespace(content: string): string {
	return outsideMarkdownFences(content, normalizeWhitespaceSegment);
}

function normalizeWhitespaceSegment(content: string): string {
	const lines = content.split('\n');
	const out: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		// Drop lone empty bullets, but keep ones that carry a block anchor.
		if (EMPTY_BULLET.test(line) && !ANCHOR_BULLET.test(line)) {
			const parentIndent = line.match(/^\s*/)?.[0].length ?? 0;
			const next = lines.slice(index + 1).find(candidate => candidate.trim() !== '');
			const child = next?.match(/^(\s*)[-*+]\s/);
			if (!child || child[1].length <= parentIndent) continue;
		}
		// Normalize non-breaking spaces, then strip trailing whitespace.
		out.push(line.replace(/\u00A0/g, ' ').replace(/[ \t]+$/, ''));
	}
	return out.join('\n');
}
