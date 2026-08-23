import { outsideMarkdownFences } from '../../markdown';

const EMPTY_BULLET = /^\s*-\s*$/;
// An otherwise empty bullet may still be a reference target.
const ANCHOR_BULLET = /^\s*-\s+\^[A-Za-z0-9_-]+\s*$/;

export function normalizeWhitespace(content: string): string {
	return outsideMarkdownFences(content, normalizeWhitespaceSegment);
}

function normalizeWhitespaceSegment(content: string): string {
	const lines = content.split('\n');
	const out: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (EMPTY_BULLET.test(line) && !ANCHOR_BULLET.test(line)) {
			const parentIndent = line.match(/^\s*/)?.[0].length ?? 0;
			const next = lines.slice(index + 1).find(candidate => candidate.trim() !== '');
			const child = next?.match(/^(\s*)[-*+]\s/);
			if (!child || child[1].length <= parentIndent) continue;
		}
		out.push(line.replace(/\u00A0/g, ' ').replace(/[ \t]+$/, ''));
	}
	return out.join('\n');
}
