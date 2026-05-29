export interface HmxpAttachmentRef {
	source: string;
	markdownPath: string;
}

export interface HmxpTopic {
	id: string;
	title: string;
	keywords: string[];
	markdown: string;
	attachments: HmxpAttachmentRef[];
}

export interface HmxpTocNode {
	id?: string;
	caption: string;
	children: HmxpTocNode[];
}

export interface HmxpTopicConversionOptions {
	topicIds?: Set<string>;
	resolveAttachment?: (source: string) => string;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;

const IMAGE_TAGS = new Set(['img', 'image', 'picture', 'graphic', 'bitmap']);

export function convertHmxpTopicXml(
	xml: string,
	topicId: string,
	options: HmxpTopicConversionOptions = {},
): HmxpTopic {
	const doc = parseXml(xml);
	const root = doc.documentElement;
	const title = directChildText(root, 'title') || topicId;
	const keywords = getKeywords(root);
	const attachments: HmxpAttachmentRef[] = [];
	const converter = new HmxpMarkdownConverter({
		...options,
		resolveAttachment: (source: string) => {
			const markdownPath = options.resolveAttachment?.(source) || defaultAttachmentPath(source);
			attachments.push({ source, markdownPath });
			return markdownPath;
		},
	});

	const body = findDirectChild(root, 'body');
	const bodyMarkdown = body
		? converter.renderBlocks(childrenOf(body).filter(node => !isElementNamed(node, 'header')))
		: '';

	const markdown = [
		`# ${title}`,
		bodyMarkdown,
	]
		.filter(Boolean)
		.join('\n\n')
		.trimEnd() + '\n';

	return {
		id: topicId,
		title,
		keywords,
		markdown,
		attachments,
	};
}

export function parseHmxpTocXml(xml: string): HmxpTocNode[] {
	const doc = parseXml(xml);
	return childElements(doc.documentElement, 'topicref').map(parseTocNode);
}

export function renderHmxpTocMarkdown(nodes: HmxpTocNode[]): string {
	const lines = ['# Table of Contents', ''];
	appendTocLines(lines, nodes, 0);
	return lines.join('\n').trimEnd() + '\n';
}

export function renderHmxpKeywordsMarkdown(topics: HmxpTopic[]): string {
	const keywordTopics = new Map<string, HmxpTopic[]>();
	for (const topic of topics) {
		for (const keyword of topic.keywords) {
			const normalizedKeyword = keyword.trim();
			if (!normalizedKeyword) continue;
			const current = keywordTopics.get(normalizedKeyword) || [];
			current.push(topic);
			keywordTopics.set(normalizedKeyword, current);
		}
	}

	if (keywordTopics.size === 0) {
		return '';
	}

	const lines = ['# Keywords', ''];
	for (const keyword of Array.from(keywordTopics.keys()).sort((a, b) => a.localeCompare(b))) {
		lines.push(`## ${keyword}`, '');
		const linkedTopics = keywordTopics.get(keyword)!;
		linkedTopics.sort((a, b) => a.title.localeCompare(b.title));
		for (const topic of linkedTopics) {
			lines.push(`- ${formatWikiLink(topic.id, topic.title)}`);
		}
		lines.push('');
	}

	return lines.join('\n').trimEnd() + '\n';
}

function parseXml(xml: string): Document {
	const parser = new DOMParser();
	const doc = parser.parseFromString(xml.replace(/^\uFEFF/, ''), 'text/xml');
	if (doc.getElementsByTagName('parsererror').length > 0) {
		throw new Error('Unable to parse Help+Manual XML.');
	}
	return doc;
}

function parseTocNode(element: Element): HmxpTocNode {
	const href = element.getAttribute('href');
	const id = href ? normalizeTopicHref(href) : undefined;
	const caption = directChildText(element, 'caption') || id || 'Untitled';
	const node: HmxpTocNode = {
		caption,
		children: childElements(element, 'topicref').map(parseTocNode),
	};
	if (id) {
		node.id = id;
	}
	return node;
}

function appendTocLines(lines: string[], nodes: HmxpTocNode[], depth: number): void {
	const prefix = '  '.repeat(depth);
	for (const node of nodes) {
		lines.push(`${prefix}- ${node.id ? formatWikiLink(node.id, node.caption) : node.caption}`);
		appendTocLines(lines, node.children, depth + 1);
	}
}

function getKeywords(root: Element): string[] {
	const keywordsElement = findDirectChild(root, 'keywords');
	if (!keywordsElement) return [];
	return childElements(keywordsElement, 'keyword')
		.map(element => cleanText(element.textContent || ''))
		.filter(Boolean);
}

class HmxpMarkdownConverter {
	private topicIds: Set<string>;
	private resolveAttachment: (source: string) => string;

	constructor(options: HmxpTopicConversionOptions) {
		this.topicIds = options.topicIds || new Set();
		this.resolveAttachment = options.resolveAttachment || defaultAttachmentPath;
	}

	renderBlocks(nodes: Node[]): string {
		const blocks: string[] = [];

		for (const node of nodes) {
			const block = this.renderBlock(node);
			if (!block) continue;
			blocks.push(block);
		}

		return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
	}

	private renderBlock(node: Node): string {
		if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) {
			const text = cleanText(node.textContent || '');
			return text;
		}

		if (node.nodeType !== ELEMENT_NODE) return '';

		const element = node as Element;
		const name = elementName(element);
		switch (name) {
			case 'header':
				return '';
			case 'para':
				return this.renderParagraph(element);
			case 'list':
				return this.renderList(element, 0);
			case 'table':
				return this.renderTable(element);
			case 'conditional-text':
				return this.renderConditional(element);
			default:
				return this.renderBlocks(childrenOf(element));
		}
	}

	private renderParagraph(element: Element): string {
		const parts: string[] = [];
		let inline = '';

		const flushInline = () => {
			const trimmed = inline.trim();
			if (trimmed) {
				parts.push(this.applyHeading(element, trimmed));
			}
			inline = '';
		};

		for (const child of childrenOf(element)) {
			if (isElementNamed(child, 'table')) {
				flushInline();
				parts.push(this.renderTable(child as Element));
			}
			else if (isElementNamed(child, 'list')) {
				flushInline();
				parts.push(this.renderList(child as Element, 0));
			}
			else {
				inline += this.renderInline(child);
			}
		}

		flushInline();
		return parts.join('\n\n').trim();
	}

	private applyHeading(element: Element, text: string): string {
		const level = headingLevel(element);
		if (!level) return text;
		return `${'#'.repeat(level)} ${text.replace(/^#+\s*/, '')}`;
	}

	private renderInline(node: Node): string {
		if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) {
			return cleanFormattingText(node.textContent || '');
		}

		if (node.nodeType !== ELEMENT_NODE) return '';

		const element = node as Element;
		const name = elementName(element);
		switch (name) {
			case 'br':
				return '\n';
			case 'link':
				return this.renderLink(element);
			case 'conditional-text':
				return this.renderConditional(element);
			case 'list':
				return '\n' + this.renderList(element, 0);
			case 'table':
				return '\n' + this.renderTable(element);
		}

		if (IMAGE_TAGS.has(name)) {
			return this.renderImage(element);
		}

		let rendered = childrenOf(element).map(child => this.renderInline(child)).join('');
		if (!rendered && element.childNodes.length === 0) {
			rendered = cleanFormattingText(element.textContent || '');
		}
		return applyInlineFormatting(element, rendered);
	}

	private renderLink(element: Element): string {
		const href = element.getAttribute('href') || '';
		const label = this.renderInlineChildren(element).trim() || href;
		if (!href) return label;

		const type = (element.getAttribute('type') || '').toLowerCase();
		if (type === 'topiclink' || this.topicIds.has(normalizeTopicHref(href))) {
			return formatWikiLink(normalizeTopicHref(href), label);
		}

		return `[${escapeMarkdownLinkText(label)}](${href})`;
	}

	private renderImage(element: Element): string {
		const source = element.getAttribute('src')
			|| element.getAttribute('href')
			|| element.getAttribute('file')
			|| element.getAttribute('filename')
			|| '';
		if (!source) {
			return this.renderInlineChildren(element);
		}

		const alt = element.getAttribute('alt') || element.getAttribute('title') || '';
		if (isExternalUrl(source)) {
			return `![${escapeMarkdownLinkText(alt)}](${source})`;
		}

		return `![[${this.resolveAttachment(source)}]]`;
	}

	private renderInlineChildren(element: Element): string {
		return childrenOf(element).map(child => this.renderInline(child)).join('');
	}

	private renderConditional(element: Element): string {
		const type = element.getAttribute('type') || 'IF';
		const value = element.getAttribute('value');
		return value ? `<${type} ${value}>` : `<${type}>`;
	}

	private renderList(element: Element, depth: number): string {
		const items = childElements(element, 'li');
		const ordered = isOrderedList(element);
		return items
			.map((item, index) => this.renderListItem(item, ordered, index + 1, depth))
			.filter(Boolean)
			.join('\n');
	}

	private renderListItem(element: Element, ordered: boolean, index: number, depth: number): string {
		const prefix = `${'  '.repeat(depth)}${ordered ? `${index}.` : '-'} `;
		const content = this.renderBlocks(childrenOf(element)).trim();
		if (!content) return '';

		const lines = content.split('\n');
		const continuation = '  '.repeat(depth + 1);
		return prefix + lines.map((line, lineIndex) => {
			if (lineIndex === 0) return line;
			return continuation + line;
		}).join('\n');
	}

	private renderTable(element: Element): string {
		const rows = descendantElements(element, 'tr')
			.map(row => childElements(row).filter(cell => ['td', 'th'].includes(elementName(cell))))
			.filter(row => row.length > 0);

		if (rows.length === 0) return '';

		const renderedRows = rows.map(row => row.map(cell => this.renderTableCell(cell)));
		const columnCount = Math.max(...renderedRows.map(row => row.length));
		const normalizedRows = renderedRows.map(row => normalizeTableRow(row, columnCount));
		const header = normalizedRows[0];
		const body = normalizedRows.slice(1);

		return [
			`| ${header.join(' | ')} |`,
			`| ${Array(columnCount).fill('---').join(' | ')} |`,
			...body.map(row => `| ${row.join(' | ')} |`),
		].join('\n');
	}

	private renderTableCell(element: Element): string {
		const blockContent = this.renderBlocks(childrenOf(element)).trim();
		return escapeMarkdownTableCell(blockContent);
	}
}

function headingLevel(element: Element): number | null {
	const signature = formatSignature(element);
	if (!signature.includes('heading')) return null;
	const match = signature.match(/heading\s*([1-6])/);
	const sourceLevel = match ? Number(match[1]) : 1;
	return Math.min(sourceLevel + 1, 6);
}

function isOrderedList(element: Element): boolean {
	const type = (element.getAttribute('type') || element.getAttribute('listtype') || '').toLowerCase();
	return type === 'ol' || type === 'ordered' || type === 'number';
}

function applyInlineFormatting(element: Element, text: string): string {
	if (!text.trim()) return text;

	const signature = formatSignature(element);
	const code = signature.includes('courier')
		|| signature.includes('consolas')
		|| signature.includes('monospace')
		|| signature.includes('code')
		|| signature.includes('t_entry');
	const bold = signature.includes('font-weight:bold')
		|| signature.includes('font-weight: bold')
		|| signature.includes('bold')
		|| signature.includes('strong');
	const italic = signature.includes('font-style:italic')
		|| signature.includes('font-style: italic')
		|| signature.includes('italic')
		|| signature.includes('emphasis');

	if (code) {
		return wrapPreservingWhitespace(text, '`', '`', value => value.replace(/`/g, '\\`'));
	}
	if (bold && italic) {
		return wrapPreservingWhitespace(text, '***', '***');
	}
	if (bold) {
		return wrapPreservingWhitespace(text, '**', '**');
	}
	if (italic) {
		return wrapPreservingWhitespace(text, '*', '*');
	}
	return text;
}

function formatSignature(element: Element): string {
	return [
		element.getAttribute('styleclass') || '',
		element.getAttribute('style') || '',
		element.getAttribute('class') || '',
	].join(';').toLowerCase().replace(/\s+/g, ' ');
}

function wrapPreservingWhitespace(
	value: string,
	open: string,
	close: string,
	mapCore: (value: string) => string = value => value,
): string {
	const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
	if (!match) return value;
	const [, leading, core, trailing] = match;
	if (!core) return value;
	return `${leading}${open}${mapCore(core)}${close}${trailing}`;
}

function cleanFormattingText(text: string): string {
	if (/^[\s\r\n\t]+$/.test(text) && /[\r\n\t]/.test(text)) {
		return '';
	}
	return decodeXmlWhitespace(text);
}

function cleanText(text: string): string {
	return decodeXmlWhitespace(text).replace(/\s+/g, ' ').trim();
}

function decodeXmlWhitespace(text: string): string {
	return text.replace(/\u00a0/g, ' ');
}

function defaultAttachmentPath(source: string): string {
	return `Attachments/${attachmentFileName(source)}`;
}

function attachmentFileName(source: string): string {
	const cleanSource = source.split(/[?#]/)[0].replace(/\\/g, '/');
	const parts = cleanSource.split('/').filter(Boolean);
	return parts[parts.length - 1] || 'image';
}

function normalizeTopicHref(href: string): string {
	const withoutHash = href.split('#')[0].split('?')[0].replace(/\\/g, '/');
	const parts = withoutHash.split('/').filter(Boolean);
	const lastPart = parts[parts.length - 1] || withoutHash || 'Untitled';
	return lastPart.replace(/\.xml$/i, '');
}

function formatWikiLink(topicId: string, label: string): string {
	const cleanId = normalizeTopicHref(topicId);
	if (!label || label === cleanId) {
		return `[[${cleanId}]]`;
	}
	return `[[${cleanId}|${label.replace(/\|/g, '\\|')}]]`;
}

function isExternalUrl(href: string): boolean {
	return /^[a-z][a-z\d+.-]*:/i.test(href);
}

function escapeMarkdownLinkText(text: string): string {
	return text.replace(/]/g, '\\]');
}

function escapeMarkdownTableCell(text: string): string {
	return text
		.replace(/\|/g, '\\|')
		.replace(/\n+/g, '<br>')
		.trim();
}

function normalizeTableRow(row: string[], columnCount: number): string[] {
	const normalized = [...row];
	while (normalized.length < columnCount) {
		normalized.push('');
	}
	return normalized;
}

function directChildText(element: Element, tagName: string): string {
	const child = findDirectChild(element, tagName);
	return child ? cleanText(child.textContent || '') : '';
}

function findDirectChild(element: Element, tagName: string): Element | null {
	return childElements(element, tagName)[0] || null;
}

function childElements(element: Element, tagName?: string): Element[] {
	return childrenOf(element)
		.filter((node): node is Element => node.nodeType === ELEMENT_NODE)
		.filter(element => !tagName || elementName(element) === tagName.toLowerCase());
}

function descendantElements(element: Element, tagName: string): Element[] {
	const results: Element[] = [];
	for (const child of childElements(element)) {
		if (elementName(child) === tagName.toLowerCase()) {
			results.push(child);
		}
		results.push(...descendantElements(child, tagName));
	}
	return results;
}

function childrenOf(node: Node): Node[] {
	const children: Node[] = [];
	for (let i = 0; i < node.childNodes.length; i++) {
		children.push(node.childNodes.item(i)!);
	}
	return children;
}

function isElementNamed(node: Node, tagName: string): boolean {
	return node.nodeType === ELEMENT_NODE && elementName(node as Element) === tagName;
}

function elementName(element: Element): string {
	return (element.localName || element.nodeName).toLowerCase();
}
