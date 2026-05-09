import { sanitizeTag } from '../keep/util';
import { sanitizeFileName } from '../../util';
import { ProseMirrorNode, ProseMirrorMark } from './models';

export interface ConvertResult {
	markdown: string;
	tags: Set<string>;
	images: ImageInfo[];
}

export interface ImageInfo {
	url: string;
	fileName: string;
	placeholder: string;
}

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
	const images: ImageInfo[] = [];
	const ctx: ConvertContext = { idToSubject, tags, images, stripInlineTags: options?.stripInlineTags ?? false };

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
	return { markdown, tags, images };
}

interface ConvertContext {
	idToSubject: Map<string, string>;
	tags: Set<string>;
	images: ImageInfo[];
	stripInlineTags: boolean;
}

function convertNodes(nodes: ProseMirrorNode[], ctx: ConvertContext): string {
	let result = '';
	let orderedIndex = 0;
	for (const node of nodes) {
		if (node.type === 'list' && node.attrs?.kind === 'ordered') {
			orderedIndex++;
			result += convertLegacyList(node, ctx, 0, orderedIndex);
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
		case 'bulletList': {
			return convertBulletList(node, ctx);
		}
		case 'taskList': {
			return convertTaskList(node, ctx);
		}
		case 'image': {
			return convertImage(node, ctx);
		}
		default:
			// Fallback: try to convert children
			if (node.content) {
				return convertNodes(node.content, ctx);
			}
			return '';
	}
}

function convertInline(nodes: ProseMirrorNode[], ctx: ConvertContext): string {
	const parts: string[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (node.type === 'text') {
			const hasLinkMark = (n: ProseMirrorNode) =>
				n.type === 'text' && n.marks?.some(m => m.type === 'link');

			// Strip trailing `[` when next node is a link (avoids `[[link](url)]` in Obsidian)
			if (node.text?.endsWith('[') && i + 1 < nodes.length && hasLinkMark(nodes[i + 1])) {
				parts.push(applyMarks(node.text.slice(0, -1), node.marks || []));
				continue;
			}
			// Strip leading `]` when previous node was a link
			if (node.text?.startsWith(']') && i > 0 && hasLinkMark(nodes[i - 1])) {
				parts.push(applyMarks(node.text.slice(1), node.marks || []));
				continue;
			}

			parts.push(applyMarks(node.text || '', node.marks || []));
		}
		else if (node.type === 'hardBreak') {
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
	}
	return parts.join('');
}

function applyMarks(text: string, marks: ProseMirrorMark[]): string {
	let result = text;
	for (const mark of marks) {
		switch (mark.type) {
			case 'bold':
				result = `**${result}**`;
				break;
			case 'italic':
				result = `*${result}*`;
				break;
			case 'code':
				result = `\`${result}\``;
				break;
			case 'strike':
				result = `~~${result}~~`;
				break;
			case 'underline':
				result = `<u>${result}</u>`;
				break;
			case 'link': {
				const href = mark.attrs?.href || '';
				result = `[${result}](${href})`;
				break;
			}
		}
	}
	return result;
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

	// Only add trailing newline at top level
	if (depth === 0) {
		result += '\n';
	}

	return result;
}

function convertBulletList(node: ProseMirrorNode, ctx: ConvertContext, depth: number = 0): string {
	const indent = '\t'.repeat(depth);
	let result = '';

	for (const item of node.content || []) {
		if (item.type === 'listItem') {
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
						result += indent + '- ' + text + '\n';
						wroteItemPrefix = true;
					}
					else {
						result += indentChildContent(text + '\n', depth);
					}
				}
				else if (child.type === 'bulletList') {
					if (!wroteItemPrefix) {
						result += indent + '- \n';
						wroteItemPrefix = true;
					}
					result += convertBulletList(child, ctx, depth + 1);
				}
				else if (child.type === 'taskList') {
					if (!wroteItemPrefix) {
						result += indent + '- \n';
						wroteItemPrefix = true;
					}
					result += convertTaskList(child, ctx, depth + 1);
				}
				else if (child.type === 'list') {
					if (!wroteItemPrefix) {
						result += indent + '- \n';
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
							result += prefixFirstLine(convertNode(child, ctx), indent, '- ', depth);
						}
						else {
							result += indent + '- \n';
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
				result += indent + '- \n';
			}
		}
	}

	if (depth === 0) {
		result += '\n';
	}
	return result;
}

function convertTaskList(node: ProseMirrorNode, ctx: ConvertContext, depth: number = 0): string {
	const indent = '\t'.repeat(depth);
	let result = '';

	for (const item of node.content || []) {
		if (item.type === 'taskListItem') {
			const checked = item.attrs?.checked;
			const checkbox = checked ? '- [x] ' : '- [ ] ';
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
						result += indent + checkbox + text + '\n';
						wroteItemPrefix = true;
					}
					else {
						result += indentChildContent(text + '\n', depth);
					}
				}
				else if (child.type === 'bulletList') {
					if (!wroteItemPrefix) {
						result += indent + checkbox + '\n';
						wroteItemPrefix = true;
					}
					result += convertBulletList(child, ctx, depth + 1);
				}
				else if (child.type === 'taskList') {
					if (!wroteItemPrefix) {
						result += indent + checkbox + '\n';
						wroteItemPrefix = true;
					}
					result += convertTaskList(child, ctx, depth + 1);
				}
				else if (child.type === 'list') {
					if (!wroteItemPrefix) {
						result += indent + checkbox + '\n';
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
						result += indent + checkbox + '\n';
						wroteItemPrefix = true;
					}
					// Preserve non-paragraph blocks (heading, blockquote, codeBlock, etc.) inside list items.
					result += indentChildContent(convertNode(child, ctx), depth);
				}
			}

			if (!wroteItemPrefix && !skippedContent) {
				result += indent + checkbox + '\n';
			}
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

function convertImage(node: ProseMirrorNode, ctx: ConvertContext): string {
	const src = node.attrs?.src || '';
	const fileName = node.attrs?.fileName || '';

	if (!src) {
		return '';
	}

	// Generate a unique placeholder
	const placeholder = `<<REFLECT_IMG_${ctx.images.length}>>`;
	ctx.images.push({ url: src, fileName, placeholder });
	return placeholder + '\n\n';
}

function isUnsafeWikiLabel(text: string): boolean {
	return /[\\|\]]/.test(text);
}

function escapeMarkdownLinkText(text: string): string {
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
