// Pure, side-effect-free text transforms for the Logseq -> Obsidian importer.
// Each function takes the full multi-line file content and returns it transformed.

const HIGHLIGHT_RE = /\^\^(.+?)\^\^/g;

/** Replace Logseq highlights `^^text^^` with Obsidian `==text==`, skipping code. */
export function convertHighlights(content: string): string {
	// Issue 5: also match bullet-opened fences `- ``` `
	const fenceRe = /^(?:\s*- )?\s*```/;
	let inFence = false;
	return content
		.split('\n')
		.map(line => {
			if (fenceRe.test(line)) {
				inFence = !inFence;
				return line;
			}
			if (inFence) return line;
			return replaceHighlightsOutsideInlineCode(line);
		})
		.join('\n');
}

function replaceHighlightsOutsideInlineCode(line: string): string {
	const inlineCodeRe = /`[^`]*`/g;
	let result = '';
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = inlineCodeRe.exec(line)) !== null) {
		result += line.slice(last, m.index).replace(HIGHLIGHT_RE, '==$1==');
		result += m[0];
		last = inlineCodeRe.lastIndex;
	}
	result += line.slice(last).replace(HIGHLIGHT_RE, '==$1==');
	return result;
}

/** Convert Logseq `logseq.order-list-type:: number` bullets into `1.`, `2.`, ... */
export function convertNumberedLists(content: string): string {
	const lines = content.split('\n');
	const bulletRe = /^(\s*)-\s+(.*)$/;
	const propRe = /^(\s*)logseq\.order-list-type::\s*number\s*$/;
	const out: string[] = [];
	const counters = new Map<number, number>();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (propRe.test(line)) continue; // drop the hidden property line

		const m = bulletRe.exec(line);
		if (!m) {
			out.push(line);
			continue;
		}

		const indent = m[1];
		const indentLen = indent.length;
		const item = m[2];

		// Moving to a (new) bullet at this level resets any deeper-level counters.
		for (const level of Array.from(counters.keys())) {
			if (level > indentLen) counters.delete(level);
		}

		const next = lines[i + 1];
		const numbered =
			next !== undefined && (() => {
				const pm = propRe.exec(next);
				return pm !== null && pm[1].length > indentLen;
			})();

		if (numbered) {
			const count = (counters.get(indentLen) ?? 0) + 1;
			counters.set(indentLen, count);
			out.push(`${indent}${count}. ${item}`);
		}
		else {
			counters.set(indentLen, 0); // non-numbered sibling resets the counter
			out.push(line);
		}
	}

	return out.join('\n');
}

// Named Obsidian callouts. Other org types (CENTER/VERSE/PINNED, etc.) fall back to [!note].
const CALLOUT_TYPES = new Set(['NOTE', 'TIP', 'WARNING', 'IMPORTANT', 'CAUTION', 'EXAMPLE']);

/** Convert Logseq org-mode `#+BEGIN_*`/`#+END_*` blocks into Obsidian syntax. */
export function convertOrgBlocks(content: string): string {
	return processOrgLines(content.split('\n')).join('\n');
}

const BEGIN_RE = /^(\s*)(?:- )?#\+BEGIN_(\w+)/i;
const END_RE = /^(\s*)(?:- )?#\+END_\w+/i;

function processOrgLines(lines: string[]): string[] {
	const out: string[] = [];
	let i = 0;
	let inFence = false;
	while (i < lines.length) {
		const line = lines[i];

		// Issue 3: skip begin/end markers inside fenced code blocks.
		if (/^\s*```/.test(line) || /^\s*- ```/.test(line)) {
			inFence = !inFence;
			out.push(line);
			i++;
			continue;
		}
		if (inFence) {
			out.push(line);
			i++;
			continue;
		}

		const begin = BEGIN_RE.exec(line);
		if (!begin) {
			out.push(line);
			i++;
			continue;
		}

		const type = begin[2].toUpperCase();
		const hasBullet = /^\s*- /.test(line);

		// Issue 4: #+BEGIN_QUERY → fenced ```query block (lossless).
		if (type === 'QUERY') {
			let qend = -1;
			for (let j = i + 1; j < lines.length; j++) {
				if (END_RE.test(lines[j])) { qend = j; break; }
			}
			if (qend >= 0) {
				const indent = begin[1];
				const inner = lines.slice(i + 1, qend);
				if (hasBullet) {
					out.push(`${indent}- \`\`\`query`);
					out.push(...inner.map(l => `${indent}  ${l.replace(/^\s*/, '')}`));
					out.push(`${indent}  \`\`\``);
				}
				else {
					out.push(`${indent}\`\`\`query`);
					out.push(...inner.map(l => stripIndent(l, indent.length)));
					out.push(`${indent}\`\`\``);
				}
				i = qend + 1;
				continue;
			}
			out.push(line);
			i++;
			continue;
		}

		// Find the matching #+END, accounting for nested blocks.
		let depth = 1;
		let end = -1;
		for (let j = i + 1; j < lines.length; j++) {
			if (BEGIN_RE.test(lines[j])) depth++;
			else if (END_RE.test(lines[j])) {
				depth--;
				if (depth === 0) {
					end = j;
					break;
				}
			}
		}

		if (end === -1) {
			// No matching end: leave the line unchanged and continue.
			out.push(line);
			i++;
			continue;
		}

		const indent = begin[1];
		const inner = processOrgLines(lines.slice(i + 1, end));
		out.push(...renderOrgBlock(type, indent, inner, hasBullet));
		i = end + 1;
	}
	return out;
}

function renderOrgBlock(type: string, indent: string, inner: string[], hasBullet: boolean): string[] {
	// Issue 1: when bullet-prefixed, content is indented `indent + '  '` under the bullet.
	const stripN = hasBullet ? indent.length + 2 : indent.length;
	const stripped = inner.map(line => stripIndent(line, stripN));

	if (type === 'COMMENT') {
		return [`${indent}%%`, ...stripped.map(line => indent + line), `${indent}%%`];
	}

	if (type === 'QUOTE') {
		if (hasBullet) {
			// Issue 1: bullet-opened QUOTE — first line uses `- > `, rest use `  > `.
			if (stripped.length === 0) return [`${indent}- >`];
			return [
				`${indent}- > ${stripped[0]}`,
				...stripped.slice(1).map(line => line === '' ? `${indent}  >` : `${indent}  > ${line}`),
			];
		}
		return stripped.map(line => quoteLine(indent, line));
	}

	// Named callouts keep their type; everything else (incl. fallback types) is a note.
	const calloutType = CALLOUT_TYPES.has(type) ? type.toLowerCase() : 'note';

	let body = stripped;
	let title = '';
	const titleMatch = body.length > 0 ? /^\*\*(.+)\*\*\s*$/.exec(body[0]) : null;
	if (titleMatch) {
		title = titleMatch[1];
		body = body.slice(1);
	}

	if (hasBullet) {
		// Issue 1: bullet-opened callout — keep the bullet, render callout as child content.
		const header = title
			? `${indent}- > [!${calloutType}] ${title}`
			: `${indent}- > [!${calloutType}]`;
		return [header, ...body.map(line => line === '' ? `${indent}  >` : `${indent}  > ${line}`)];
	}
	const header = title
		? `${indent}> [!${calloutType}] ${title}`
		: `${indent}> [!${calloutType}]`;
	return [header, ...body.map(line => quoteLine(indent, line))];
}

function quoteLine(indent: string, line: string): string {
	return line === '' ? `${indent}>` : `${indent}> ${line}`;
}

function stripIndent(line: string, n: number): string {
	let i = 0;
	while (i < n && i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
	return line.slice(i);
}

/**
 * A bare Markdown heading at column 0 that is immediately followed by an
 * indented list reads as a "child list" in Logseq's outline. Obsidian would
 * render the indented bullets oddly, so prefix the heading with `- ` to make
 * the heading own the nested list.
 */
export function fixHeadingChildLists(content: string): string {
	const lines = content.split('\n');
	const headingRe = /^#{1,6}\s+\S/;
	const indentedListRe = /^[\t ]+[-*+]\s/;
	return lines
		.map((line, i) => {
			if (headingRe.test(line) && indentedListRe.test(lines[i + 1] ?? '')) {
				return `- ${line}`;
			}
			return line;
		})
		.join('\n');
}

/**
 * Convert Logseq media embeds `{{video URL}}`, `{{youtube URL}}`, `{{tweet URL}}`
 * into Obsidian's markdown image/embed syntax `![](URL)`.
 */
export function convertMediaEmbeds(content: string): string {
	// Issue 5: also match bullet-opened fences `- ``` `
	const fenceRe = /^(?:\s*- )?\s*```/;
	let inFence = false;
	return content
		.split('\n')
		.map(line => {
			if (fenceRe.test(line)) {
				inFence = !inFence;
				return line;
			}
			if (inFence) return line;
			return line.replace(/\{\{(?:video|youtube|tweet)\s+([^}]+?)\s*\}\}/g, '![]($1)');
		})
		.join('\n');
}

/** Align a list-nested fenced code block's closing fence with its opening fence. */
export function fixCodeBlocksInLists(content: string): string {
	const lines = content.split('\n');
	// Issue 2: capture prefix + bullet separately to compute content indent (tab-safe).
	const openRe = /^([ \t]*)([-*+]\s+)?```/;
	const closeRe = /^[ \t]*```[ \t]*$/;
	let inFence = false;
	let fenceIndent = '';

	return lines
		.map(line => {
			if (!inFence) {
				const m = openRe.exec(line);
				if (m) {
					inFence = true;
					const prefix = m[1]; // whitespace before the bullet (or fence)
					const bullet = m[2]; // e.g. '- ' or undefined
					// Content (and closing fence) indent = prefix + bullet-width spaces.
					fenceIndent = bullet ? prefix + ' '.repeat(bullet.length) : prefix;
				}
				return line;
			}
			if (closeRe.test(line)) {
				inFence = false;
				// Only correct if there's a meaningful indent; leave top-level fences unchanged.
				return fenceIndent ? fenceIndent + '```' : line;
			}
			return line;
		})
		.join('\n');
}
