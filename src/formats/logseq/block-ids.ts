import { markdownCodeMask, markdownFenceLines } from '../../markdown';

export interface DefinedId {
	uuid: string;
	shortId: string;
	/** The first line of the block without its list, task, heading, or quote marker; empty for a code block. */
	text: string;
}

export interface BlockRefTarget {
	page: string;
	shortId: string;
	text?: string;
}

const MAX_LINK_TEXT = 100;
const MAX_REF_DEPTH = 4;
const BLOCK_START = /^\s*(?:[-*+]|\d+\.)\s/;
const FENCE_BLOCK_START = /^(?:\s*[-*+]\s+)?[`~]{3}/;
const ID_LINE = /^(\s*)(?:- )?id:: ?([0-9a-fA-F-]{6,})\s*$/;
// Groups: label and uuid of a labelled reference, uuid of an embed, page of an embed, uuid of a bare reference.
const REFERENCE = new RegExp([
	/\[((?:`[^`\n]*`|[^[\]`\n])+?)\]\(\(\(([^()]+?)\)\)\)/,
	/\{\{embed\s+\(\(([^()]+?)\)\)\}\}/,
	/\{\{embed\s+\[\[([^\]]+?)\]\]\}\}/,
	/\(\(([^()]+?)\)\)/,
].map(pattern => pattern.source).join('|'), 'g');

export function shortenId(uuid: string): string {
	const base = uuid.replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
	return base.length > 0 ? base : 'ref';
}

export function attachBlockIds(content: string): { content: string, ids: DefinedId[] } {
	const lines = content.split('\n');
	const fenced = markdownFenceLines(content);
	const out: string[] = [];
	const ids: DefinedId[] = [];
	const used = new Set<string>();
	let lastContentIndex = -1;
	let blockStartIndex = -1;

	const makeUnique = (candidate: string): string => {
		if (!used.has(candidate)) {
			used.add(candidate);
			return candidate;
		}
		let i = 1;
		while (used.has(`${candidate}-${i}`)) i++;
		const result = `${candidate}-${i}`;
		used.add(result);
		return result;
	};

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		if (fenced[lineIndex]) {
			if (FENCE_BLOCK_START.test(line)) blockStartIndex = out.length;
			if (line.trim() !== '') lastContentIndex = out.length;
			out.push(line);
			continue;
		}
		const m = line.match(ID_LINE);
		if (m && lastContentIndex >= 0) {
			const uuid = m[2];
			const indent = m[1];
			const shortId = makeUnique(shortenId(uuid));
			const target = out[lastContentIndex];
			ids.push({ uuid, shortId, text: blockContent(blockStartIndex >= 0 ? out[blockStartIndex] : target) });
			if (!target.trimEnd().endsWith(`^${shortId}`)) {
				// A fence anchor must follow the fence, not become part of it.
				if (/^[ \t]*(?:[-*+]\s+)?[`~]{3,}[ \t]*$/.test(target)) {
					out.push(indent + `^${shortId}`);
					lastContentIndex = out.length - 1;
				}
				// Heading anchors belong on the following line.
				else if (/^#{1,6} /.test(target.trimStart().replace(/^-\s+/, ''))) {
					const isBulletHeading = /^\s*-\s+#{1,6} /.test(target);
					if (isBulletHeading) {
						out.push(indent + `^${shortId}`);
					}
					else {
						out.push(`^${shortId}`);
					}
					lastContentIndex = out.length - 1;
				}
				else {
					out[lastContentIndex] = target.replace(/\s*$/, '') + ` ^${shortId}`;
				}
			}
			continue;
		}
		if (BLOCK_START.test(line) || /^\S/.test(line)) blockStartIndex = out.length;
		// Retained property lines can own the anchor too.
		if (line.trim() !== '') {
			lastContentIndex = out.length;
		}
		out.push(line);
	}

	return { content: out.join('\n'), ids };
}

function blockContent(line: string): string {
	const content = line
		.replace(BLOCK_START, '')
		.replace(/^\s*\[.\]\s+/, '')
		.replace(/^\s*#{1,6}\s+/, '')
		.replace(/^\s*>\s*(?:\[![\w-]+\][+-]?\s*)?/, '');
	return /^[`~]{3}/.test(content) ? '' : content;
}

export function resolveBlockRefs(
	content: string,
	index: Map<string, BlockRefTarget>,
): string {
	return replaceReferences(content, (whole, label, labelled, embedded, page, bare) => {
		if (page !== undefined) return `![[${page}]]`;
		const uuid = (labelled ?? embedded ?? bare).trim();
		const target = index.get(uuid);
		if (!target) return whole;
		if (embedded !== undefined) return `!${blockLink(target, '')}`;
		return blockLink(target, label !== undefined ? linkText(label) : blockText(uuid, index, new Set()));
	});
}

type ReferenceReplacer = (
	whole: string,
	label: string | undefined,
	labelled: string | undefined,
	embedded: string | undefined,
	page: string | undefined,
	bare: string,
) => string;

/** Only a label may hold inline code; any other code is an example and stays as written. */
function replaceReferences(text: string, replace: ReferenceReplacer): string {
	if (!text.includes('((') && !text.includes('{{embed')) return text;
	const code = markdownCodeMask(text);
	return text.replace(REFERENCE, (
		whole: string,
		label: string | undefined,
		labelled: string | undefined,
		embedded: string | undefined,
		page: string | undefined,
		bare: string,
		offset: number,
	) => {
		const end = offset + whole.length;
		const prose = label !== undefined
			? !code[offset] && !code[end - 1]
			: !code.subarray(offset, end).includes(1);
		return prose ? replace(whole, label, labelled, embedded, page, bare) : whole;
	});
}

function blockLink(target: BlockRefTarget, display: string): string {
	return `[[${target.page}#^${target.shortId}${display ? `|${display}` : ''}]]`;
}

function blockText(uuid: string, index: Map<string, BlockRefTarget>, path: Set<string>): string {
	const text = index.get(uuid)?.text;
	// The depth limit keeps blocks that each reference another several times from multiplying the work.
	if (!text || path.has(uuid) || path.size >= MAX_REF_DEPTH) return '';

	path.add(uuid);
	const expanded = replaceReferences(text, (whole, label, _labelled, embedded, page, bare) => {
		if (label !== undefined) return label;
		if (page !== undefined) return whole;
		return blockText((embedded ?? bare).trim(), index, path);
	});
	path.delete(uuid);
	return linkText(expanded);
}

/** A wikilink shows its display text literally and ends it at a bracket or pipe. */
function linkText(markdown: string): string {
	const text = markdown
		.replace(/\{\{(?:cloze|embed)\s+(.*?)\}\}/gi, '$1')
		.replace(/\{\{.*?\}\}/g, '')
		.replace(/!\[\[[^\]]*\]\]/g, '')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\*\*|==|~~|`/g, '')
		.replace(/[[\]|]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (text.length <= MAX_LINK_TEXT) return text;
	return text.slice(0, MAX_LINK_TEXT).replace(/\s+\S*$/, '') + '…';
}
