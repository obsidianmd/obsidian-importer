import { BLOCK_ANCHOR_PATTERN, outsideMarkdownCode, outsideMarkdownFences } from '../../markdown';

const HIGHLIGHT_RE = /\^\^(.+?)\^\^/g;

export function convertHighlights(content: string): string {
	return outsideMarkdownCode(content, segment => segment.replace(HIGHLIGHT_RE, '==$1=='));
}

export function convertNumberedLists(content: string): string {
	return outsideMarkdownFences(content, convertNumberedListSegment);
}

function convertNumberedListSegment(content: string): string {
	const lines = content.split('\n');
	const bulletRe = /^(\s*)-\s+(.*)$/;
	const propRe = /^(\s*)logseq\.order-list-type::\s*number\s*$/;
	const out: string[] = [];
	const counters = new Map<number, number>();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (propRe.test(line)) continue;

		const m = bulletRe.exec(line);
		if (!m) {
			out.push(line);
			continue;
		}

		const indent = m[1];
		const indentLen = indent.length;
		const item = m[2];

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
			counters.set(indentLen, 0);
			out.push(line);
		}
	}

	return out.join('\n');
}

const CALLOUT_TYPES = new Set(['NOTE', 'TIP', 'WARNING', 'IMPORTANT', 'CAUTION', 'EXAMPLE']);

export interface ConvertOrgBlocksOptions {
	dropQueries?: boolean;
}

export function convertOrgBlocks(content: string, options: ConvertOrgBlocksOptions = {}): string {
	return outsideMarkdownFences(content, segment => processOrgLines(segment.split('\n'), options).join('\n'));
}

const BEGIN_RE = /^(\s*)(?:- )?#\+BEGIN_(\w+)[ \t]*(.*)$/i;
const END_RE = /^(\s*)(?:- )?#\+END_\w+/i;

// Callouts flatten indentation, so code-bearing org blocks need fences.
const FENCED_TYPES = new Set(['QUERY', 'SRC', 'EXPORT']);

function fenceLanguage(type: string, argument: string): string {
	if (type === 'QUERY') return 'query';
	const first = argument.trim().split(/\s+/)[0] ?? '';
	return /^[\w+#.-]+$/.test(first) ? first.toLowerCase() : '';
}

function fenceFor(body: string[]): string {
	let longest = 0;
	for (const line of body) {
		for (const run of line.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
	}
	return '`'.repeat(Math.max(3, longest + 1));
}

function appendOrgBlock(out: string[], rendered: string[], separated: boolean, followedByContent: boolean): void {
	if (rendered.length === 0) return;
	if (separated && out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
	out.push(...rendered);
	if (separated && followedByContent) out.push('');
}

function processOrgLines(lines: string[], options: ConvertOrgBlocksOptions, separateBlocks = true): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		const begin = BEGIN_RE.exec(line);
		if (!begin) {
			out.push(line);
			i++;
			continue;
		}

		const type = begin[2].toUpperCase();
		const hasBullet = /^\s*- /.test(line);

		if (FENCED_TYPES.has(type)) {
			let qend = -1;
			for (let j = i + 1; j < lines.length; j++) {
				if (END_RE.test(lines[j])) {
					qend = j;
					break;
				}
			}
			if (qend >= 0) {
				if (type === 'QUERY') {
					if (options.dropQueries) {
						i = qend + 1;
						continue;
					}
				}
				const indent = begin[1];
				// Preserve indentation within the block; it may be syntax.
				const body = lines.slice(i + 1, qend)
					.map(l => stripIndent(l, hasBullet ? indent.length + 2 : indent.length));
				const fence = fenceFor(body) + fenceLanguage(type, begin[3]);
				const close = fenceFor(body);
				const rendered = hasBullet
					? [`${indent}- ${fence}`, ...body.map(l => l === '' ? '' : `${indent}  ${l}`), `${indent}  ${close}`]
					: [`${indent}${fence}`, ...body, `${indent}${close}`];
				appendOrgBlock(out, rendered, separateBlocks && !hasBullet && indent === '', qend + 1 < lines.length && lines[qend + 1].trim() !== '');
				i = qend + 1;
				continue;
			}
			out.push(line);
			i++;
			continue;
		}

		// Org blocks may nest.
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
			out.push(line);
			i++;
			continue;
		}

		const indent = begin[1];
		const inner = processOrgLines(lines.slice(i + 1, end), options, false);
		appendOrgBlock(
			out,
			renderOrgBlock(type, indent, inner, hasBullet),
			separateBlocks && !hasBullet && indent === '',
			end + 1 < lines.length && lines[end + 1].trim() !== '',
		);
		i = end + 1;
	}
	return out;
}

function renderOrgBlock(type: string, indent: string, inner: string[], hasBullet: boolean): string[] {
	const stripN = hasBullet ? indent.length + 2 : indent.length;
	const stripped = inner.map(line => stripIndent(line, stripN));

	if (type === 'COMMENT') {
		return [`${indent}%%`, ...stripped.map(line => indent + line), `${indent}%%`];
	}

	if (type === 'QUOTE') {
		if (hasBullet) {
			if (stripped.length === 0) return [`${indent}- >`];
			return [
				`${indent}- > ${stripped[0]}`,
				...stripped.slice(1).map(line => line === '' ? `${indent}  >` : `${indent}  > ${line}`),
			];
		}
		return stripped.map(line => quoteLine(indent, line));
	}

	const calloutType = CALLOUT_TYPES.has(type) ? type.toLowerCase() : 'note';

	let body = stripped;
	let title = '';
	const titleMatch = body.length > 0 ? /^\*\*(.+)\*\*\s*$/.exec(body[0]) : null;
	if (titleMatch) {
		title = titleMatch[1];
		body = body.slice(1);
	}

	if (hasBullet) {
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

/** Makes a bare heading own the indented list that follows it. */
export interface ConvertSimpleQueriesOptions {
	/** Remove the query instead of fencing it. */
	drop?: boolean;
}

const QUERY_BLOCK_RE = /^([ \t]*)(- )?(\{\{query[\s\S]*?\}\})[ \t]*$/gm;
const QUERY_INLINE_RE = /\{\{query[\s\S]*?\}\}/gi;

/**
 * `{{query ...}}` has no Obsidian equivalent, so it becomes a fenced block the
 * way an advanced query does — visibly inert rather than looking like it runs.
 */
export function convertSimpleQueries(content: string, options: ConvertSimpleQueriesOptions = {}): string {
	const { drop = false } = options;

	// Dropping leaves the bullet behind for the whitespace pass to clear, the
	// way removing any other inline markup would.
	if (drop) {
		return outsideMarkdownCode(content, segment => segment.replace(QUERY_INLINE_RE, ''));
	}

	// A query alone on its block becomes a fence; the fence then protects it
	// from the inline pass, which catches any query sitting mid-sentence.
	const fenced = outsideMarkdownFences(content, segment =>
		segment.replace(QUERY_BLOCK_RE, (whole: string, indent: string, bullet: string | undefined, query: string) => {
			const inner = query.split('\n');
			const body = bullet ? `${indent}  ` : indent;
			const fence = fenceFor(inner);
			return [`${indent}${bullet ?? ''}${fence}query`, ...inner.map(l => body + l), `${body}${fence}`].join('\n');
		}));

	return outsideMarkdownCode(fenced, segment => segment.replace(QUERY_INLINE_RE, '`$&`'));
}

export function fixHeadingChildLists(content: string): string {
	return outsideMarkdownFences(content, fixHeadingChildListSegment);
}

function fixHeadingChildListSegment(content: string): string {
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

export function convertMediaEmbeds(content: string): string {
	return outsideMarkdownCode(content,
		segment => segment.replace(/\{\{(?:video|youtube|tweet)\s+([^}]+?)\s*\}\}/g, '![]($1)'));
}

export function fixCodeBlocksInLists(content: string): string {
	const lines = content.split('\n');
	const openRe = /^([ \t]*)(?:([-*+])([ \t]+))?([`~]{3,})/;
	const closeRe = new RegExp(`^[ \\t]*([\x60~]{3,})((?:[ \\t]+${BLOCK_ANCHOR_PATTERN})?)[ \\t]*$`);
	let fence: { marker: string, length: number } | null = null;
	let fenceIndent = '';

	return lines
		.map(line => {
			if (!fence) {
				const m = openRe.exec(line);
				if (m) {
					const marker = m[4];
					fence = { marker: marker[0], length: marker.length };
					const prefix = m[1];
					const bullet = m[2];
					const separator = m[3] ?? '';
					fenceIndent = bullet
						? prefix + (separator.includes('\t') ? separator : ' '.repeat(1 + separator.length))
						: prefix;
				}
				return line;
			}
			const close = closeRe.exec(line);
			if (close && close[1][0] === fence.marker && close[1].length >= fence.length) {
				const marker = close[1];
				fence = null;
				return fenceIndent ? fenceIndent + marker + close[2] : line;
			}
			return line;
		})
		.join('\n');
}
