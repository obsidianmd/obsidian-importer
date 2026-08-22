import Defuddle from 'defuddle';
import { htmlToMarkdown } from 'obsidian';
import { parseHTML } from '../../util';

export interface ResolvedAttachment {
	path: string;
	name: string;
}

export interface HtmlConversionOptions {
	resolveAttachment: (url: URL, el: HTMLElement, source: string) => Promise<ResolvedAttachment | null>;
	baseUrl?: URL;
	onAttachment?: (attachment: ResolvedAttachment) => void;
	onSkipped?: (src: string) => void;
	onFailed?: (src: string, error: unknown) => void;
	isCancelled?: () => boolean;
}

export interface HtmlPreparationOptions {
	baseUrl?: URL;
	extractMainContent?: boolean;
	resolveFragment?: (href: string) => string | null;
}

export interface HtmlDocumentConversionOptions extends HtmlConversionOptions, HtmlPreparationOptions {}

export interface ConvertedHtml {
	markdown: string;
	attachments: Map<string, ResolvedAttachment>;
	variables: Record<string, unknown>;
}

export interface PreparedHtml {
	content: string;
	title: string;
	variables: Record<string, unknown>;
}

export interface HtmlDocumentMetadata {
	title: string;
	headings: Map<string, string>;
}

function fixDocumentUrls(el: Element) {
	fixElementRef(el, 'src');
	fixElementRef(el, 'href');
}

function fixElementRef(element: Element, attribute: string) {
	for (let el of Array.from(element.querySelectorAll(`[${attribute}]`))) {
		let value = el.getAttribute(attribute);
		if (value?.startsWith('file:///') === false && value?.contains('\\')) {
			el.setAttribute(attribute, value.replace(/\\/g, '/'));
		}
	}
}

export function inspectHtmlDocument(htmlContent: string, baseUrl?: URL): HtmlDocumentMetadata {
	const dom = parseHTML(htmlContent);
	fixDocumentUrls(dom);
	const originalTitle = dom.ownerDocument?.querySelector('title')?.textContent?.trim() ?? '';
	const headings = headingFragments(dom);
	const fallbackUrl = baseUrl ?? new URL('https://localhost/');
	const url = extractionUrl(dom, fallbackUrl);
	let title = originalTitle;
	try {
		protectUnsafeIds(dom);
		title = extractWithDefuddle(dom, url).title.trim() || originalTitle;
	}
	catch {
		title = originalTitle;
	}

	return {
		title,
		headings,
	};
}

export function prepareHtmlDocument(htmlContent: string, {
	baseUrl,
	extractMainContent = true,
	resolveFragment,
}: HtmlPreparationOptions = {}): PreparedHtml {
	const dom = parseHTML(htmlContent);
	fixDocumentUrls(dom);

	const url = baseUrl ?? new URL('https://localhost/');
	const sourceUrl = extractionUrl(dom, url);
	const original = dom.outerHTML;
	const originalTitle = dom.ownerDocument?.querySelector('title')?.textContent?.trim() ?? '';
	const headings = headingFragments(dom);
	const tables = dom.findAll('table').map(table => table.cloneNode(true) as Element);
	const figures = dom.findAll('figure').map(figure => figure.cloneNode(true) as Element);
	const references = protectReferences(dom);
	const ids = protectUnsafeIds(dom);
	try {
		const result = extractWithDefuddle(dom, sourceUrl);
		const extracted = extractMainContent
			? restoreContent(result.content, references, ids, url, headings, resolveFragment, tables, figures)
			: null;
		const content = extracted?.usable
			? extracted.content
			: restoreContent(original, new Map(), new Map(), url, headings, resolveFragment)!.content;

		return {
			content,
			title: result.title.trim() || originalTitle,
			variables: {
				title: result.title.trim() || originalTitle,
				author: result.author,
				contentHtml: content,
				description: result.description,
				domain: result.domain,
				favicon: result.favicon,
				fullHtml: original,
				image: result.image,
				language: result.language,
				published: result.published,
				site: result.site,
				url: sourceUrl.href,
				words: result.wordCount,
				...result.variables,
			},
		};
	}
	catch {
		const restored = restoreContent(original, new Map(), new Map(), url, headings, resolveFragment);
		const content = restored?.content ?? original;
		return {
			content,
			title: originalTitle,
			variables: { title: originalTitle, contentHtml: content, fullHtml: original, url: sourceUrl.href },
		};
	}
}

function extractWithDefuddle(dom: Element, url: URL) {
	return new Defuddle(dom.ownerDocument, {
		url: url.href,
		useAsync: false,
		removeSmallImages: false,
		standardize: true,
	}).parse();
}

function extractionUrl(dom: Element, fallback: URL): URL {
	const candidates = [
		dom.querySelector('link[rel="canonical"]')?.getAttribute('href'),
		dom.querySelector('meta[property="og:url"]')?.getAttribute('content'),
		dom.querySelector('meta[name="twitter:url"]')?.getAttribute('content'),
	];

	for (const candidate of candidates) {
		if (!candidate) continue;
		try {
			const url = new URL(candidate, fallback);
			if (url.protocol === 'http:' || url.protocol === 'https:') return url;
		}
		catch {
			continue;
		}
	}

	return fallback;
}

export async function convertHtmlDocument(
	htmlContent: string,
	options: HtmlDocumentConversionOptions,
): Promise<ConvertedHtml> {
	return await convertPreparedHtml(
		prepareHtmlDocument(htmlContent, options), options);
}

export async function convertPreparedHtml(prepared: PreparedHtml, options: HtmlConversionOptions): Promise<ConvertedHtml> {
	const { resolveAttachment, baseUrl, onAttachment, onSkipped, onFailed, isCancelled } = options;

	const dom = parseHTML(prepared.content);
	fixDocumentUrls(dom);

	const seen = new Map<string, ResolvedAttachment | null>();
	const attachments = new Map<string, ResolvedAttachment>();

	for (let el of dom.findAll('img, audio, video')) {
		if (isCancelled?.()) break;

		let src = el.getAttribute('src');
		if (!src) continue;

		try {
			const url = new URL(src.startsWith('//') ? `https:${src}` : src, baseUrl);

			if (url.protocol === 'data:') continue;

			const key = url.href;
			let attachment = seen.get(key);

			if (!seen.has(key)) {
				attachment = await resolveAttachment(url, el, src);
				seen.set(key, attachment);

				if (attachment) {
					attachments.set(attachment.path, attachment);
					onAttachment?.(attachment);
				}
				else onSkipped?.(src);
			}

			if (!attachment) continue;

			el.setAttribute('src', attachment.path.replace(/ /g, '%20'));

			// Tag names work in both Obsidian's DOM and the headless test DOM.
			if (el.tagName !== 'IMG') {
				el.replaceWith(createEl('img', {
					attr: {
						src: attachment.path.replace(/ /g, '%20'),
						alt: el.getAttr('alt'),
					},
				}));
			}
		}
		catch (e) {
			onFailed?.(src, e);
		}
	}

	const markdown = htmlToMarkdown(dom.querySelector('body') ?? dom);
	return {
		markdown,
		attachments,
		variables: { ...prepared.variables, content: markdown },
	};
}

const REFERENCE_PREFIX = 'https://obsidian-importer.invalid/reference/';
const ID_PREFIX = 'obsidian-importer-id-';

function protectReferences(dom: Element): Map<string, string> {
	const references = new Map<string, string>();
	let index = 0;
	for (const attribute of ['href', 'src']) {
		for (const el of dom.findAll(`[${attribute}]`)) {
			const value = el.getAttribute(attribute);
			if (value === null) continue;

			const token = `${REFERENCE_PREFIX}${index++}`;
			references.set(token, value);
			el.setAttribute(attribute, token);
		}
	}
	return references;
}

function protectUnsafeIds(dom: Element): Map<string, string> {
	const ids = new Map<string, string>();
	const elements = dom.findAll('[id]');
	const used = new Set(elements.map(el => el.getAttribute('id')));
	let index = 0;

	for (const el of elements) {
		const id = el.getAttribute('id');
		if (!id || /^[A-Za-z_][A-Za-z\d_-]*$/u.test(id)) continue;

		let token: string;
		do token = `${ID_PREFIX}${index++}`;
		while (used.has(token));

		used.add(token);
		ids.set(token, id);
		el.setAttribute('id', token);
	}

	return ids;
}

function restoreContent(
	content: string,
	references: Map<string, string>,
	ids: Map<string, string>,
	page: URL,
	headings: Map<string, string>,
	resolveFragment?: (href: string) => string | null,
	originalTables: Element[] = [],
	originalFigures: Element[] = [],
): { content: string, usable: boolean } | null {
	const dom = parseHTML(content);
	restoreSelectedTables(dom, originalTables);
	restoreSelectedFigures(dom, originalFigures);
	for (const attribute of ['href', 'src']) {
		for (const el of dom.findAll(`[${attribute}]`)) {
			const value = el.getAttribute(attribute);
			const original = value === null ? undefined : references.get(value);
			if (original !== undefined) el.setAttribute(attribute, original);
			else if (references.size > 0 && value?.startsWith(REFERENCE_PREFIX)) return null;
		}
	}
	for (const el of dom.findAll('[id]')) {
		const value = el.getAttribute('id');
		const original = value === null ? undefined : ids.get(value);
		if (original !== undefined) el.setAttribute('id', original);
		else if (ids.size > 0 && value?.startsWith(ID_PREFIX)) return null;
	}
	if (!keepsLinkedHeadings(dom, page, headings)) return null;

	for (const link of dom.findAll('a[href]')) {
		const href = link.getAttribute('href');
		if (!href) continue;

		const replacement = localHeadingFragment(href, page, headings) ?? resolveFragment?.(href);
		if (replacement) link.setAttribute('href', replacement);
	}

	const body = dom.querySelector('body') ?? dom;
	return {
		content: dom.outerHTML,
		usable: !!body.textContent?.trim()
			|| !!body.querySelector('img, audio, video, iframe, table, pre, hr'),
	};
}

function restoreSelectedFigures(dom: Element, originals: Element[]): void {
	restoreSelectedElements(dom.findAll('figure'), originals, figureKey);
}

function restoreSelectedTables(dom: Element, originals: Element[]): void {
	restoreSelectedElements(dom.findAll('table'), originals, tableKey);
}

function restoreSelectedElements(
	selected: Element[],
	originals: Element[],
	keyFor: (element: Element) => string,
): void {
	const byKey = new Map<string, Element[]>();
	for (const original of originals) {
		const key = keyFor(original);
		if (!key) continue;

		const matches = byKey.get(key) ?? [];
		matches.push(original);
		byKey.set(key, matches);
	}

	for (const element of selected) {
		const key = keyFor(element);
		const original = byKey.get(key)?.shift();
		if (original) element.replaceWith(original);
	}
}

function tableKey(table: Element): string {
	return normalizedText(table.querySelector('th, td')?.textContent ?? '');
}

function figureKey(figure: Element): string {
	return normalizedText(figure.querySelector('figcaption')?.textContent ?? '')
		|| normalizedText(figure.textContent ?? '')
		|| normalizedText(figure.querySelector('img, audio, video')?.getAttribute('alt') ?? '');
}

function normalizedText(text: string): string {
	return text.replace(/\s+/gu, ' ').trim();
}

function keepsLinkedHeadings(dom: Element, page: URL, headings: Map<string, string>): boolean {
	const extracted = new Set(dom.findAll('h1, h2, h3, h4, h5, h6')
		.map(heading => normalizedText(heading.textContent ?? '')));

	for (const link of dom.findAll('a[href]')) {
		const href = link.getAttribute('href');
		const heading = href ? localHeadingText(href, page, headings) : null;
		if (heading && !extracted.has(normalizedText(heading))) return false;
	}

	return true;
}

function localHeadingFragment(href: string, page: URL, headings: Map<string, string>): string | null {
	try {
		const target = new URL(href, page);
		if (target.origin !== page.origin || target.pathname !== page.pathname || target.search !== page.search
			|| !target.hash) return null;

		const heading = localHeadingText(href, page, headings);
		return heading ? `#${encodeURIComponent(heading)}` : target.hash;
	}
	catch {
		return null;
	}
}

function localHeadingText(href: string, page: URL, headings: Map<string, string>): string | null {
	try {
		const target = new URL(href, page);
		if (target.origin !== page.origin || target.pathname !== page.pathname || target.search !== page.search
			|| !target.hash) return null;

		return headings.get(safeDecode(target.hash.slice(1))) ?? null;
	}
	catch {
		return null;
	}
}

function headingFragments(dom: Element): Map<string, string> {
	const headings = new Map<string, string>();
	for (const heading of dom.findAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')) {
		const id = heading.getAttribute('id');
		const text = heading.textContent?.trim().replace(/\s+/g, ' ');
		if (id && text) headings.set(id, text);
	}
	return headings;
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	}
	catch {
		return value;
	}
}
