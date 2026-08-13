import { sanitizeTag } from '../keep/util';
import { sanitizeFileName } from '../../util';
import { ProseMirrorNode, ProseMirrorMark } from './models';

export interface ConvertResult {
	markdown: string;
	tags: Set<string>;
	attachments: AttachmentInfo[];
}

export interface AttachmentInfo {
	url: string;
	fileName: string;
	placeholder: string;
	// Whether Obsidian can render this attachment as an embed (![[...]]);
	// non-embeddable files get a plain link instead.
	embed: boolean;
}

// File formats Obsidian renders as embeds: https://help.obsidian.md/file-formats
const EMBEDDABLE_EXTENSIONS = /\.(avif|bmp|gif|jpe?g|png|svg|webp|mp3|wav|m4a|3gp|flac|ogg|oga|opus|mp4|webm|ogv|mov|mkv|pdf)$/i;

export interface ConvertOptions {
	stripInlineTags?: boolean;
}

export function convertDocument(
	documentJson: string,
	idToSubject: Map<string, string>,
	subject?: string,
	options?: ConvertOptions,
): ConvertResult {
	const doc: ProseMirrorNode = JSON.parse(documentJson);
	const tags = new Set<string>();
	const attachments: AttachmentInfo[] = [];
	const ctx: ConvertContext = { idToSubject, tags, attachments, stripInlineTags: options?.stripInlineTags ?? false };

	let nodes = doc.content || [];

	// Strip leading H1 if it matches the note subject (avoids title duplication)
	if (subject && nodes.length > 0) {
		const first = nodes[0];
		if (first.type === 'heading' && first.attrs?.level === 1) {
			const h1Text = (first.content || [])
				.filter(n => n.type === 'text')
				.map(n => n.text || '')
				.join('');
			if (h1Text === subject) {
				nodes = nodes.slice(1);
			}
		}
	}

	const markdown = convertNodes(nodes, ctx).trim();
	return { markdown, tags, attachments };
}

interface ConvertContext {
	idToSubject: Map<string, string>;
	tags: Set<string>;
	attachments: AttachmentInfo[];
	stripInlineTags: boolean;
}

function convertNodes(nodes: ProseMirrorNode[], ctx: ConvertContext): string {
	let result = '';
	let orderedIndex = 0;
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (node.type === 'list') {
			// Each legacy `list` node is a single list item; consecutive ones form
			// one list, so only end the run with a blank line, not every item.
			if (node.attrs?.kind === 'ordered') {
				orderedIndex++;
			}
			else {
				orderedIndex = 0;
			}
			result += convertLegacyList(node, ctx, 0, orderedIndex || 1);
			if (nodes[i + 1]?.type !== 'list') {
				result += '\n';
			}
		}
		else {
			orderedIndex = 0;
			result += convertNode(node, ctx);
		}
	}
	return result;
}

function convertNode(node: ProseMirrorNode, ctx: ConvertContext): string {
	switch (node.type) {
		case 'heading': {
			const level = node.attrs?.level || 1;
			const text = convertInline(node.content || [], ctx);
			return '#'.repeat(level) + ' ' + text + '\n\n';
		}
		case 'paragraph': {
			const text = convertInline(node.content || [], ctx);
			return text + '\n\n';
		}
		case 'hardBreak':
			return '<br>\n';
		case 'horizontalRule':
			return '---\n\n';
		case 'blockquote': {
			const inner = convertNodes(node.content || [], ctx).trim();
			return inner.split('\n').map(line => '> ' + line).join('\n') + '\n\n';
		}
		case 'codeBlock': {
			const language = node.attrs?.language || '';
			const text = (node.content || [])
				.map(n => n.text || '')
				.join('');
			return '```' + language + '\n' + text + '\n```\n\n';
		}
		case 'iframe': {
			const src = node.attrs?.src || '';
			const type = node.attrs?.type;
			const label = type === 'youtube' ? 'YouTube' : 'Embed';
			return `[${label}](${src})\n\n`;
		}
		case 'list': {
			return convertLegacyList(node, ctx);
		}
		case 'bulletList':
		case 'taskList': {
			return convertItemList(node, ctx);
		}
		case 'image':
		case 'file': {
			return convertAttachment(node, ctx);
		}
		default:
			// Fallback: try to convert children
			if (node.content) {
				return convertNodes(node.content, ctx);
			}
			return '';
	}
}

function convertInline(inlineNodes: ProseMirrorNode[], ctx: ConvertContext): string {
	const nodes = stripRedundantLinkBrackets(inlineNodes);
	const parts: string[] = [];
	let i = 0;
	while (i < nodes.length) {
		const node = nodes[i];
		if (node.type === 'text') {
			// Serialize whole runs of text nodes together so a mark spanning
			// several nodes gets one pair of delimiters, not one pair per node.
			let runEnd = i;
			while (runEnd < nodes.length && nodes[runEnd].type === 'text') runEnd++;
			parts.push(serializeTextRun(nodes.slice(i, runEnd)));
			i = runEnd;
			continue;
		}
		if (node.type === 'hardBreak') {
			parts.push('<br>\n');
		}
		else if (node.type === 'backlink') {
			parts.push(convertBacklink(node, ctx));
		}
		else if (node.type === 'tag') {
			parts.push(convertTag(node, ctx));
		}
		else {
			parts.push(convertNode(node, ctx));
		}
		i++;
	}
	return parts.join('');
}

// Avoids `[[link](url)]` when the note text already wraps a link in brackets.
function stripRedundantLinkBrackets(nodes: ProseMirrorNode[]): ProseMirrorNode[] {
	const hasLinkMark = (n: ProseMirrorNode | undefined) =>
		n?.type === 'text' && !!n.marks?.some(m => m.type === 'link');

	return nodes.map((node, i) => {
		if (node.type !== 'text' || !node.text || hasLinkMark(node)) {
			return node;
		}
		let text = node.text;
		if (text.endsWith('[') && hasLinkMark(nodes[i + 1])) {
			text = text.slice(0, -1);
		}
		if (text.startsWith(']') && hasLinkMark(nodes[i - 1])) {
			text = text.slice(1);
		}
		return text === node.text ? node : { ...node, text };
	});
}

// Nesting order for marks: outermost first. Code must stay innermost so
// delimiters of other marks never end up inside a code span.
const MARK_PRIORITY: Record<string, number> = {
	link: 0,
	underline: 1,
	bold: 2,
	italic: 3,
	strike: 4,
	code: 5,
};

function sortedMarks(node: ProseMirrorNode): ProseMirrorMark[] {
	return [...(node.marks || [])].sort((a, b) =>
		(MARK_PRIORITY[a.type] ?? Object.keys(MARK_PRIORITY).length) - (MARK_PRIORITY[b.type] ?? Object.keys(MARK_PRIORITY).length));
}

function markKey(mark: ProseMirrorMark): string {
	return JSON.stringify([mark.type, mark.attrs || {}]);
}

// Reflect splits a continuously marked range across several text nodes (for
// example bold text containing inline code). Wrap each maximal group of nodes
// sharing the outermost mark in a single pair of delimiters and recurse into
// the group with that mark removed.
function serializeTextRun(nodes: ProseMirrorNode[]): string {
	let result = '';
	let i = 0;
	while (i < nodes.length) {
		const marks = sortedMarks(nodes[i]);
		if (marks.length === 0) {
			result += nodes[i].text || '';
			i++;
			continue;
		}

		const outerKey = markKey(marks[0]);
		let groupEnd = i;
		while (groupEnd < nodes.length && sortedMarks(nodes[groupEnd]).some(m => markKey(m) === outerKey)) {
			groupEnd++;
		}
		const inner = nodes.slice(i, groupEnd).map(n => ({
			...n,
			marks: (n.marks || []).filter(m => markKey(m) !== outerKey),
		}));
		result += applyMark(serializeTextRun(inner), marks[0]);
		i = groupEnd;
	}
	return result;
}

function applyMark(text: string, mark: ProseMirrorMark): string {
	switch (mark.type) {
		case 'bold':
			return wrapDelimited(text, '**');
		case 'italic':
			return wrapDelimited(text, '*');
		case 'code':
			return wrapCode(text);
		case 'strike':
			return wrapDelimited(text, '~~');
		case 'underline':
			return `<u>${text}</u>`;
		case 'link': {
			const href = mark.attrs?.href || '';
			return `[${text}](${href})`;
		}
		default:
			return text;
	}
}

// A closing emphasis delimiter preceded by whitespace never closes, so marked
// text like "bold text " must keep its whitespace outside the markers.
function wrapDelimited(text: string, delimiter: string): string {
	const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
	if (!core) {
		return text;
	}
	return `${lead}${delimiter}${core}${delimiter}${trail}`;
}

function wrapCode(text: string): string {
	const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
	if (!core) {
		return text;
	}
	// A code span needs a fence longer than any backtick run it contains,
	// and padding when the content starts or ends with a backtick.
	const longestRun = (core.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
	const fence = '`'.repeat(longestRun + 1);
	const pad = core.startsWith('`') || core.endsWith('`') ? ' ' : '';
	return `${lead}${fence}${pad}${core}${pad}${fence}${trail}`;
}

function convertLegacyList(node: ProseMirrorNode, ctx: ConvertContext, depth: number = 0, ordinal: number = 1): string {
	const indent = '\t'.repeat(depth);
	const kind = node.attrs?.kind || 'bullet';
	const checked = node.attrs?.checked;
	const archived = node.attrs?.archived;

	let prefix: string;
	if (kind === 'task' || (kind === 'bullet' && checked === true)) {
		prefix = checked ? '- [x] ' : '- [ ] ';
	}
	else if (kind === 'ordered') {
		prefix = `${ordinal}. `;
	}
	else {
		prefix = '- ';
	}

	let result = '';
	const children = node.content || [];
	let wroteItemPrefix = false;
	let skippedContent = false;
	let childOrderedIndex = 0;

	for (const child of children) {
		if (child.type === 'paragraph') {
			const text = convertInline(child.content || [], ctx);
			const archivedComment = archived ? ' <!-- archived -->' : '';
			const line = text + archivedComment;
			if (line.trim() === '') {
				skippedContent = true;
				continue;
			}
			if (!wroteItemPrefix) {
				result += indent + prefix + line + '\n';
				wroteItemPrefix = true;
			}
			else {
				result += indentChildContent(line + '\n', depth);
			}
		}
		else if (child.type === 'list') {
			if (!wroteItemPrefix) {
				result += indent + prefix + '\n';
				wroteItemPrefix = true;
			}
			if (child.attrs?.kind === 'ordered') {
				childOrderedIndex++;
			}
			else {
				childOrderedIndex = 0;
			}
			result += convertLegacyList(child, ctx, depth + 1, child.attrs?.kind === 'ordered' ? childOrderedIndex : 1);
		}
		else {
			if (!wroteItemPrefix) {
				if (child.type === 'heading') {
					result += prefixFirstLine(convertNode(child, ctx), indent, prefix, depth);
				}
				else {
					result += indent + prefix + '\n';
					result += indentChildContent(convertNode(child, ctx), depth);
				}
				wroteItemPrefix = true;
			}
			else {
				result += indentChildContent(convertNode(child, ctx), depth);
			}
		}
	}

	if (!wroteItemPrefix && !skippedContent) {
		result += indent + prefix + '\n';
	}

	return result;
}

// Shared walker for the modern `bulletList` and `taskList` shapes; their items
// differ only in wrapper type and line prefix.
function convertItemList(node: ProseMirrorNode, ctx: ConvertContext, depth: number = 0): string {
	const indent = '\t'.repeat(depth);
	let result = '';

	for (const item of node.content || []) {
		if (item.type !== 'listItem' && item.type !== 'taskListItem') {
			continue;
		}
		const prefix = item.type === 'taskListItem'
			? (item.attrs?.checked ? '- [x] ' : '- [ ] ')
			: '- ';
		let wroteItemPrefix = false;
		let skippedContent = false;
		let childOrderedIndex = 0;

		for (const child of item.content || []) {
			if (child.type === 'paragraph') {
				const text = convertInline(child.content || [], ctx);
				if (text.trim() === '') {
					skippedContent = true;
					continue;
				}
				if (!wroteItemPrefix) {
					result += indent + prefix + text + '\n';
					wroteItemPrefix = true;
				}
				else {
					result += indentChildContent(text + '\n', depth);
				}
			}
			else if (child.type === 'bulletList' || child.type === 'taskList') {
				if (!wroteItemPrefix) {
					result += indent + prefix + '\n';
					wroteItemPrefix = true;
				}
				result += convertItemList(child, ctx, depth + 1);
			}
			else if (child.type === 'list') {
				if (!wroteItemPrefix) {
					result += indent + prefix + '\n';
					wroteItemPrefix = true;
				}
				if (child.attrs?.kind === 'ordered') {
					childOrderedIndex++;
				}
				else {
					childOrderedIndex = 0;
				}
				result += convertLegacyList(child, ctx, depth + 1, child.attrs?.kind === 'ordered' ? childOrderedIndex : 1);
			}
			else {
				if (!wroteItemPrefix) {
					if (child.type === 'heading') {
						result += prefixFirstLine(convertNode(child, ctx), indent, prefix, depth);
					}
					else {
						result += indent + prefix + '\n';
						result += indentChildContent(convertNode(child, ctx), depth);
					}
					wroteItemPrefix = true;
				}
				else {
					// Preserve non-paragraph blocks (heading, blockquote, codeBlock, etc.) inside list items.
					result += indentChildContent(convertNode(child, ctx), depth);
				}
			}
		}

		if (!wroteItemPrefix && !skippedContent) {
			result += indent + prefix + '\n';
		}
	}

	if (depth === 0) {
		result += '\n';
	}
	return result;
}

function convertBacklink(node: ProseMirrorNode, ctx: ConvertContext): string {
	const id = node.attrs?.id || '';
	const label = node.attrs?.label || '';
	const subject = ctx.idToSubject.get(id);

	if (!subject) {
		// Unknown reference (null graphId or missing note), fall back to sanitized label target.
		const fallbackTarget = sanitizeFileName(label);
		if (!isUnsafeWikiLabel(label) && fallbackTarget === label) {
			return `[[${fallbackTarget}]]`;
		}
		return toMarkdownInternalLink(label, fallbackTarget);
	}

	if (!isUnsafeWikiLabel(label)) {
		if (subject === label) {
			return `[[${subject}]]`;
		}
		return `[[${subject}|${label}]]`;
	}

	return toMarkdownInternalLink(label, subject);
}

function convertTag(node: ProseMirrorNode, ctx: ConvertContext): string {
	const label = node.attrs?.label || node.attrs?.id || '';
	const sanitized = sanitizeTag(label);
	ctx.tags.add(sanitized);
	if (ctx.stripInlineTags) {
		return '';
	}
	return '#' + sanitized;
}

function convertAttachment(node: ProseMirrorNode, ctx: ConvertContext): string {
	// `image` nodes carry their payload in attrs.src, `file` nodes in attrs.url.
	const url = node.attrs?.src || node.attrs?.url || '';
	const fileName = node.attrs?.fileName || '';

	if (!url) {
		return '';
	}

	const embed = node.type === 'image' || EMBEDDABLE_EXTENSIONS.test(fileName || getUrlPathname(url));

	// Generate a unique placeholder
	const placeholder = `<<REFLECT_ATTACHMENT_${ctx.attachments.length}>>`;
	ctx.attachments.push({ url, fileName, placeholder, embed });
	return placeholder + '\n\n';
}

export function getUrlPathname(url: string): string {
	try {
		return new URL(url).pathname;
	}
	catch {
		return url;
	}
}

function isUnsafeWikiLabel(text: string): boolean {
	return /[\\|\]]/.test(text);
}

export function escapeMarkdownLinkText(text: string): string {
	return text
		.replace(/\\/g, '\\\\')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]');
}

function toMarkdownInternalLink(label: string, target: string): string {
	const safeLabel = escapeMarkdownLinkText(label);
	return `[${safeLabel}](<${target}>)`;
}

function indentChildContent(content: string, depth: number): string {
	const trimmed = content.trimEnd();
	if (!trimmed) {
		return '';
	}

	const childIndent = '\t'.repeat(depth + 1);
	return trimmed
		.split('\n')
		.map(line => line ? childIndent + line : '')
		.join('\n') + '\n';
}

function prefixFirstLine(content: string, indent: string, prefix: string, depth: number): string {
	const trimmed = content.trimEnd();
	if (!trimmed) return indent + prefix + '\n';
	const lines = trimmed.split('\n');
	const first = lines[0].trimStart();
	let result = indent + prefix + first + '\n';
	if (lines.length > 1) {
		result += indentChildContent(lines.slice(1).join('\n'), depth);
	}
	return result;
}
