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
	extractMainContent?: boolean;
	onAttachment?: (attachment: ResolvedAttachment) => void;
	onSkipped?: (src: string) => void;
	onFailed?: (src: string, error: unknown) => void;
	isCancelled?: () => boolean;
}

export interface ConvertedHtml {
	markdown: string;
	attachments: Map<string, ResolvedAttachment>;
}

export interface PreparedHtml {
	content: string;
	title: string;
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

export function prepareHtmlDocument(
	htmlContent: string,
	baseUrl?: URL,
	extractMainContent = true,
): PreparedHtml {
	const dom = parseHTML(htmlContent);
	fixDocumentUrls(dom);
	rewriteHeadingFragments(dom);

	const url = baseUrl ?? new URL('https://localhost/');
	const original = dom.outerHTML;
	const originalTitle = dom.ownerDocument?.title.trim() ?? '';
	const references = protectReferences(dom);
	try {
		const result = new Defuddle(dom.ownerDocument!, {
			url: url.href,
			useAsync: false,
			removeSmallImages: false,
			standardize: false,
		}).parse();
		const extracted = extractMainContent
			&& hasContent(result.content)
			&& keepsTableText(original, result.content)
			&& keepsMedia(original, result.content)
			? result.content
			: original;
		const content = restoreReferences(extracted, references);

		return {
			content: restoreDocumentFragments(content, url),
			title: result.title.trim() || originalTitle,
		};
	}
	catch {
		return { content: original, title: originalTitle };
	}
}

export async function convertHtmlDocument(htmlContent: string, options: HtmlConversionOptions): Promise<ConvertedHtml> {
	return await convertPreparedHtml(
		prepareHtmlDocument(htmlContent, options.baseUrl, options.extractMainContent), options);
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

	return {
		markdown: htmlToMarkdown(dom.querySelector('body') ?? dom),
		attachments,
	};
}

function protectReferences(dom: Element): Map<string, string> {
	const references = new Map<string, string>();
	let index = 0;
	for (const attribute of ['href', 'src']) {
		for (const el of dom.findAll(`[${attribute}]`)) {
			const value = el.getAttribute(attribute);
			if (value === null) continue;

			const token = `https://obsidian-importer.invalid/reference/${index++}`;
			references.set(token, value);
			el.setAttribute(attribute, token);
		}
	}
	return references;
}

function restoreReferences(content: string, references: Map<string, string>): string {
	const dom = parseHTML(content);
	for (const attribute of ['href', 'src']) {
		for (const el of dom.findAll(`[${attribute}]`)) {
			const value = el.getAttribute(attribute);
			const original = value === null ? undefined : references.get(value);
			if (original !== undefined) el.setAttribute(attribute, original);
		}
	}
	return dom.outerHTML;
}

function hasContent(content: string): boolean {
	const dom = parseHTML(content);
	const body = dom.querySelector('body') ?? dom;
	return !!body.textContent?.trim()
		|| !!body.querySelector('img, audio, video, iframe, table, pre, hr');
}

function keepsTableText(original: string, extracted: string): boolean {
	const output = normalizedText(parseHTML(extracted).textContent ?? '');
	for (const cell of parseHTML(original).findAll('th, td')) {
		const text = normalizedText(cell.textContent ?? '');
		if (text && !output.includes(text)) return false;
	}
	return true;
}

function keepsMedia(original: string, extracted: string): boolean {
	const selector = 'img, audio, video';
	return parseHTML(extracted).findAll(selector).length >= parseHTML(original).findAll(selector).length;
}

function normalizedText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function restoreDocumentFragments(content: string, page: URL): string {
	const dom = parseHTML(content);
	for (const link of dom.findAll('a[href]')) {
		const href = link.getAttribute('href');
		if (!href) continue;

		try {
			const target = new URL(href, page);
			if (target.origin === page.origin && target.pathname === page.pathname && target.search === page.search
				&& target.hash) link.setAttribute('href', target.hash);
		}
		catch {
			continue;
		}
	}

	return dom.outerHTML;
}

function rewriteHeadingFragments(dom: Element): void {
	const headings = new Map<string, string>();
	for (const heading of dom.findAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')) {
		const id = heading.getAttribute('id');
		const text = heading.textContent?.trim().replace(/\s+/g, ' ');
		if (id && text) headings.set(id, text);
	}

	for (const link of dom.findAll('a[href^="#"]')) {
		const href = link.getAttribute('href');
		if (!href || href === '#') continue;

		const id = safeDecode(href.slice(1));
		const heading = headings.get(id);
		if (heading) link.setAttribute('href', `#${encodeURIComponent(heading)}`);
	}
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	}
	catch {
		return value;
	}
}
