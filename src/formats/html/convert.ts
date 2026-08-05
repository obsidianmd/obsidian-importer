/**
 * An HTML document converted to markdown, separate from the importer that
 * writes it.
 *
 * Resolving an attachment - fetching it, deciding whether to keep it, and
 * choosing where it lands - is the caller's, passed in as resolveAttachment.
 * Everything else here is the conversion: rewriting what the document points
 * at, turning audio and video into something markdown can carry, and the
 * markdown itself.
 *
 * What it deliberately does not do is the importer's last step, rewriting
 * embed links into the user's preferred link format. That reads vault
 * settings and Obsidian's metadata cache, so it stays with the importer.
 */
import { htmlToMarkdown } from 'obsidian';
import { parseHTML } from '../../util';

/** An attachment that was kept, as the document should now refer to it. */
export interface ResolvedAttachment {
	/** Vault path to point the document at. */
	path: string;
	/** File name, for reporting. */
	name: string;
}

export interface HtmlConversionOptions {
	/**
	 * Fetch and store one attachment, or return null to leave the element as
	 * it is. Path traversal checks and size limits belong here.
	 */
	resolveAttachment: (url: URL, el: HTMLElement) => Promise<ResolvedAttachment | null>;
	/** The document's own location, for resolving relative references. */
	baseUrl?: URL;
	onAttachment?: (attachment: ResolvedAttachment) => void;
	onSkipped?: (src: string) => void;
	onFailed?: (src: string, error: unknown) => void;
	isCancelled?: () => boolean;
}

export interface ConvertedHtml {
	markdown: string;
	/** Everything kept, by the vault path the markdown now points at. */
	attachments: Map<string, ResolvedAttachment>;
}

/** Turn a document's file:// and relative references into resolvable URLs. */
function fixDocumentUrls(el: Element) {
	fixElementRef(el, 'src');
	fixElementRef(el, 'href');
}

function fixElementRef(element: Element, attribute: string) {
	for (let el of Array.from(element.querySelectorAll(`[${attribute}]`))) {
		let value = el.getAttribute(attribute);
		// Wrongly encoded URLs, e.g. from Windows paths
		if (value?.startsWith('file:///') === false && value?.contains('\\')) {
			el.setAttribute(attribute, value.replace(/\\/g, '/'));
		}
	}
}

export async function convertHtmlDocument(htmlContent: string, options: HtmlConversionOptions): Promise<ConvertedHtml> {
	const { resolveAttachment, baseUrl, onAttachment, onSkipped, onFailed, isCancelled } = options;

	const dom = parseHTML(htmlContent);
	fixDocumentUrls(dom);

	// Keyed by the source URL, so a document referring to the same file twice
	// resolves it once.
	const seen = new Map<string, ResolvedAttachment | null>();
	const attachments = new Map<string, ResolvedAttachment>();

	for (let el of dom.findAll('img, audio, video')) {
		if (isCancelled?.()) break;

		let src = el.getAttribute('src');
		if (!src) continue;

		try {
			const url = new URL(src.startsWith('//') ? `https:${src}` : src, baseUrl);

			// Already inline; there is nothing to fetch.
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

			// Point at the vault copy
			el.setAttribute('src', attachment.path.replace(/ /g, '%20'));

			// audio and video become img, which is the only embed
			// htmlToMarkdown carries through. Tag name rather than
			// instanceOf, so this holds for any DOM implementation.
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
