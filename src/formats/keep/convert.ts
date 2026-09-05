import { FrontMatterCache, htmlToMarkdown } from 'obsidian';
import { outsideMarkdownFences } from '../../markdown';
import { parseHTML, serializeFrontMatter } from '../../util';
import { KeepAnnotation, KeepJson } from './models';
import { sanitizeTag, sanitizeTags, toSentenceCase } from './util';

export interface ConvertedKeepNote {
	content: string;
	// Keep stores microseconds; the vault expects milliseconds.
	ctime: number;
	mtime: number;
}

const UNDERLINE_START = '\uE000KEEP-UNDERLINE-START\uE001';
const UNDERLINE_END = '\uE000KEEP-UNDERLINE-END\uE001';
const BOLD_ELEMENTS = 'b, strong, h1, h2, h3, h4, h5, h6';
const ITALIC_ELEMENTS = 'i, em';
const STRUCK_ELEMENTS = 's, strike, del';

function wrapsStyle(style: CSSStyleDeclaration, property: 'fontWeight' | 'fontStyle' | 'textDecoration'): boolean {
	switch (property) {
		case 'fontWeight':
			return style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
		case 'fontStyle':
			return style.fontStyle === 'italic' || style.fontStyle === 'oblique';
		case 'textDecoration':
			return style.textDecoration.includes('line-through');
	}
}

function wrapContents(element: Element, tag: keyof HTMLElementTagNameMap): void {
	const children = Array.from(element.childNodes);
	if (children.length === 0) return;

	const wrapper = element.createEl(tag);
	wrapper.append(...children);
}

function hasSemanticAncestor(element: Element, selector: string): boolean {
	return element.closest(selector) !== null;
}

/** Convert the inline CSS used by Keep's JSON export into semantic HTML. */
function normalizeKeepFormatting(root: HTMLElement): void {
	for (const element of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
		const { style } = element;
		const underline = style.textDecoration.includes('underline');

		if (wrapsStyle(style, 'fontWeight') && !hasSemanticAncestor(element, BOLD_ELEMENTS)) {
			wrapContents(element, 'strong');
		}
		if (wrapsStyle(style, 'fontStyle') && !hasSemanticAncestor(element, ITALIC_ELEMENTS)) {
			wrapContents(element, 'em');
		}
		if (wrapsStyle(style, 'textDecoration') && !hasSemanticAncestor(element, STRUCK_ELEMENTS)) {
			wrapContents(element, 'del');
		}
		if (underline && !hasSemanticAncestor(element, 'u')) wrapContents(element, 'u');

		element.removeAttribute('style');
	}

	// Markdown has no underline syntax, but Obsidian renders this small HTML
	// subset. Markers carry the element through htmlToMarkdown without keeping
	// any attributes from the export.
	const underlines = Array.from(root.querySelectorAll('u'));
	const nestedUnderlines = new Set(underlines.filter(element => element.parentElement?.closest('u')));
	for (const element of underlines) {
		if (nestedUnderlines.has(element)) continue;
		element.prepend(UNDERLINE_START);
		element.append(UNDERLINE_END);
		element.replaceWith(...Array.from(element.childNodes));
	}
}

function hasKeepFormatting(root: HTMLElement): boolean {
	if (root.querySelector([
		'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
		'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark',
		'blockquote', 'ul', 'ol', 'pre', 'code', 'table', 'hr', 'img[src]',
	].join(', '))) return true;

	// Keep wraps bare URLs in anchors. The plain-text version is preferable in
	// that case because Obsidian already autolinks it; named links still need
	// the HTML path so their destination is not lost.
	if (Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).some(anchor =>
		anchor.textContent !== anchor.getAttribute('href'))) return true;

	return Array.from(root.querySelectorAll<HTMLElement>('[style]')).some(({ style }) =>
		wrapsStyle(style, 'fontWeight')
		|| wrapsStyle(style, 'fontStyle')
		|| wrapsStyle(style, 'textDecoration')
		|| style.textDecoration.includes('underline'));
}

function formatKeepHtml(
	html: string,
	plainText: string | undefined,
	transform?: (root: HTMLElement) => void,
): string {
	// Takeout stores a fragment rather than a complete document. Wrapping it
	// keeps every top-level paragraph when parsed by Obsidian and the test DOM.
	const root = parseHTML(`<html><body>${html}</body></html>`);
	if (plainText?.trim() && !hasKeepFormatting(root)) return plainText;
	transform?.(root);
	normalizeKeepFormatting(root);

	const markdown = htmlToMarkdown(root.querySelector('body') ?? root)
		.trim()
		.split(UNDERLINE_START).join('<u>')
		.split(UNDERLINE_END).join('</u>');

	return markdown || plainText || '';
}

function formatKeepText(keepJson: KeepJson): string {
	return keepJson.textContentHtml
		? formatKeepHtml(keepJson.textContentHtml, keepJson.textContent)
		: keepJson.textContent ?? '';
}

function flattenKeepListItem(markdown: string): string {
	return markdown.replace(/\r?\n(?:[ \t]*\r?\n)*/g, '<br>');
}

function formatKeepListHtml(html: string, plainText: string | undefined): string {
	// Headings have no structural meaning inside a Keep checklist item. Remove
	// that semantic before Markdown rendering, where a real heading and literal
	// hash-prefixed text would otherwise be indistinguishable.
	return flattenKeepListItem(formatKeepHtml(html, plainText, root => {
		for (const heading of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
			const paragraph = createEl('p');
			paragraph.append(...Array.from(heading.childNodes));
			heading.replaceWith(paragraph);
		}
	}));
}

function collectTags(keepJson: KeepJson): string[] {
	const tags: string[] = [];

	if (keepJson.color && keepJson.color !== 'DEFAULT') {
		tags.push(`Keep/Color/${toSentenceCase(keepJson.color.toLowerCase())}`);
	}
	if (keepJson.isPinned) tags.push('Keep/Pinned');
	if (keepJson.tasks?.length) tags.push('Keep/Task');
	if (keepJson.attachments) tags.push('Keep/Attachment');
	if (keepJson.isArchived) tags.push('Keep/Archived');
	if (keepJson.isTrashed) tags.push('Keep/Deleted');

	for (const label of keepJson.labels ?? []) {
		tags.push(`Keep/Label/${label.name}`);
	}

	return tags;
}

export function keepTemplateVariables(keepJson: KeepJson): Record<string, unknown> {
	return {
		isArchived: keepJson.isArchived,
		isPinned: keepJson.isPinned,
		isTrashed: keepJson.isTrashed,
		title: keepJson.title,
		color: keepJson.color,
		labels: keepJson.labels?.map(label => label.name).filter(Boolean) ?? [],
		sharees: keepJson.sharees,
		annotations: keepJson.annotations,
	};
}

function normalizeAnnotationText(value: string | undefined): string {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeMarkdownText(text: string): string {
	return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function annotationUrl(url: string): string {
	return `<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
}

function annotationPrimaryText(annotation: KeepAnnotation): string {
	const title = normalizeAnnotationText(annotation.title);
	const url = normalizeAnnotationText(annotation.url);
	const description = normalizeAnnotationText(annotation.description);

	if (title && url) return `[${escapeMarkdownText(title)}](${annotationUrl(url)})`;
	if (url) return annotationUrl(url);
	if (title) return escapeMarkdownText(title);
	return escapeMarkdownText(description);
}

export function formatAnnotations(annotations: KeepAnnotation[] | undefined): string {
	const items: string[] = [];

	for (const annotation of annotations ?? []) {
		const primary = annotationPrimaryText(annotation);
		if (!primary) continue;

		items.push(`- ${primary}`);

		const title = normalizeAnnotationText(annotation.title);
		const description = normalizeAnnotationText(annotation.description);
		if (description && description !== title && escapeMarkdownText(description) !== primary) {
			items.push(`  ${escapeMarkdownText(description)}`);
		}
	}

	return items.length > 0 ? `## Annotations\n\n${items.join('\n')}` : '';
}

export function convertKeepNote(
	keepJson: KeepJson,
	filename: string,
	strictLineBreaks = false,
	resolveAttachment: (sourcePath: string) => string = sourcePath => sourcePath
): ConvertedKeepNote {
	const frontMatter: FrontMatterCache = {};

	if (keepJson.title) {
		const aliases = keepJson.title.split('\n').filter(alias => alias !== filename);
		if (aliases.length > 0) frontMatter['aliases'] = aliases;
	}

	const tags = collectTags(keepJson);
	if (tags.length > 0) frontMatter['tags'] = tags.map(tag => sanitizeTag(tag));
	const labelNames = keepJson.labels?.map(label => label.name).filter(Boolean) ?? [];

	const parts: string[] = [serializeFrontMatter(frontMatter)];

	const noteText = formatKeepText(keepJson);
	if (noteText) {
		let text = sanitizeTags(noteText, labelNames);
		if (strictLineBreaks) {
			text = outsideMarkdownFences(text, segment => segment.replace(/(?<! {2})\r?\n/g, '  \n'));
		}
		parts.push('\n', text);
	}

	if (keepJson.listContent) {
		const items = keepJson.listContent
			.map(item => ({
				text: item.textHtml
					? formatKeepListHtml(item.textHtml, item.text)
					: flattenKeepListItem(item.text ?? ''),
				isChecked: item.isChecked,
			}))
			.filter(item => item.text)
			.map(item => sanitizeTags(
				`- [${item.isChecked ? 'X' : ' '}] ${item.text}`,
				labelNames,
			));

		parts.push('\n\n', items.join('\n'));
	}

	if (keepJson.attachments) {
		parts.push('\n\n');
		for (const attachment of keepJson.attachments) {
			parts.push(`![[${resolveAttachment(attachment.filePath)}]]`);
		}
	}

	const annotations = formatAnnotations(keepJson.annotations);
	if (annotations) parts.push('\n\n', annotations);

	return {
		content: parts.join(''),
		ctime: keepJson.createdTimestampUsec / 1000,
		mtime: (keepJson.userEditedTimestampUsec > 0
			? keepJson.userEditedTimestampUsec
			: keepJson.createdTimestampUsec) / 1000,
	};
}
