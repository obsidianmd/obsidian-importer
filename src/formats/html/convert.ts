import { htmlToMarkdown } from 'obsidian';
import { parseHTML } from '../../util';

export interface ResolvedAttachment {
	path: string;
	name: string;
}

export interface HtmlConversionOptions {
	resolveAttachment: (url: URL, el: HTMLElement) => Promise<ResolvedAttachment | null>;
	baseUrl?: URL;
	onAttachment?: (attachment: ResolvedAttachment) => void;
	onSkipped?: (src: string) => void;
	onFailed?: (src: string, error: unknown) => void;
	isCancelled?: () => boolean;
}

export interface ConvertedHtml {
	markdown: string;
	attachments: Map<string, ResolvedAttachment>;
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

export async function convertHtmlDocument(htmlContent: string, options: HtmlConversionOptions): Promise<ConvertedHtml> {
	const { resolveAttachment, baseUrl, onAttachment, onSkipped, onFailed, isCancelled } = options;

	const dom = parseHTML(htmlContent);
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
				attachment = await resolveAttachment(url, el);
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

	return { markdown: htmlToMarkdown(dom), attachments };
}
