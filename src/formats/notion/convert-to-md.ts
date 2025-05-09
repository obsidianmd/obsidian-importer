import { FrontMatterCache, htmlToMarkdown, moment } from 'obsidian';
import { parseFilePath } from '../../filesystem';
import { parseHTML, serializeFrontMatter } from '../../util';
import { ZipEntryFile } from '../../zip';
import {
	NotionLink,
	NotionProperty,
	NotionPropertyType,
	NotionResolverInfo,
	YamlProperty,
	FormatTagName,
} from './notion-types';
import {
	escapeHashtags,
	getNotionId,
	hoistChildren,
	parseDate,
	stripNotionId,
	stripParentDirectories,
} from './notion-utils';

export async function readToMarkdown(info: NotionResolverInfo, file: ZipEntryFile): Promise<string> {
	const text = await file.readText();

	const dom = parseHTML(text);
	// read the files etc.
	const body = dom.find('div[class=page-body]');

	if (body === null) {
		throw new Error('page body was not found');
	}

	const notionLinks = getNotionLinks(info, body);
	convertLinksToObsidian(info, notionLinks, true);

	let frontMatter: FrontMatterCache = {};

	const rawProperties = dom.find('table[class=properties] > tbody') as HTMLTableSectionElement | undefined;
	if (rawProperties) {
		const propertyLinks = getNotionLinks(info, rawProperties);
		convertLinksToObsidian(info, propertyLinks, false);
		// YAML only takes raw URLS
		convertHtmlLinksToURLs(rawProperties);

		for (let row of Array.from(rawProperties.rows)) {
			const property = parseProperty(row);
			if (property) {
				if (property.title == 'Tags') {
					property.title = 'tags';
					if (typeof property.content === 'string') {
						property.content = property.content.replace(/ /g, '-');
					}
					else if (property.content instanceof Array) {
						property.content = property.content.map(tag => tag.replace(/ /g, '-'));
					}
				}
				frontMatter[property.title] = property.content;
			}
		}
	}

	fixFormatTags(body, ['strong', 'em', 'mark', 'del']);
	fixNotionBookmarks(body);
	// fixEquations must come before fixNotionCallouts
	fixEquations(body);
	stripLinkFormatting(body);
	fixNotionCallouts(body);
	encodeNewlinesToBr(body);
	fixNotionDates(body);

	// Some annoying elements Notion throws in as wrappers, which mess up .md
	replaceElementsWithChildren(body, 'div.indented');
	replaceElementsWithChildren(body, 'details');
	fixToggleHeadings(body);
	fixNotionLists(body, 'ul');
	fixNotionLists(body, 'ol');
	fixMermaidCodeblock(body);

	addCheckboxes(body);
	formatTableOfContents(body);
	formatDatabases(body);

	let markdownBody = htmlToMarkdown(body.innerHTML);
	if (info.singleLineBreaks) {
		// Making sure that any blockquote is preceded by an empty line (otherwise messes up formatting with consecutive blockquotes / callouts)
		markdownBody = markdownBody.replace(/\n\n(?!>)/g, '\n');
	}

	markdownBody = escapeHashtags(markdownBody);
	markdownBody = fixDoubleBackslash(markdownBody);

	const description = dom.find('p[class*=page-description]')?.textContent;
	if (description) markdownBody = description + '\n\n' + markdownBody;

	return serializeFrontMatter(frontMatter) + markdownBody;
}

const typesMap: Record<NotionProperty['type'], NotionPropertyType[]> = {
	checkbox: ['checkbox'],
	date: ['created_time', 'last_edited_time', 'date'],
	list: ['file', 'multi_select', 'relation'],
	number: ['number', 'auto_increment_id'],
	text: [
		'email',
		'person',
		'phone_number',
		'text',
		'url',
		'status',
		'select',
		'formula',
		'rollup',
		'last_edited_by',
		'created_by',
	],
};

function parseProperty(property: HTMLTableRowElement): YamlProperty | undefined {
	const notionType = property.className.match(/property-row-(.*)/)?.[1] as NotionPropertyType;
	if (!notionType) {
		throw new Error('property type not found for: ' + property);
	}

	const title = htmlToMarkdown(property.cells[0].textContent ?? '');

	const body = property.cells[1];

	let type = Object.keys(typesMap).find((type: keyof typeof typesMap) =>
		typesMap[type].includes(notionType)
	) as NotionProperty['type'];

	if (!type) throw new Error('type not found for: ' + body);

	let content: YamlProperty['content'] = '';

	switch (type) {
		case 'checkbox':
			// checkbox-on: checked, checkbox-off: unchecked.
			content = body.innerHTML.includes('checkbox-on');
			break;
		case 'number':
			content = Number(body.textContent);
			if (isNaN(content)) return;
			break;
		case 'date':
			fixNotionDates(body);
			const dates = body.getElementsByTagName('time');
			if (dates.length === 0) {
				content = '';
			}
			else if (dates.length === 1) {
				content = parseDate(moment(dates.item(0)?.textContent));
			}
			else {
				const dateList = [];
				for (let i = 0; i < dates.length; i++) {
					dateList.push(
						parseDate(moment(dates.item(i)?.textContent))
					);
				}
				content = dateList.join(' - ');
			}
			if (content.length === 0) return;
			break;
		case 'list':
			const children = body.children;
			const childList: string[] = [];
			for (let i = 0; i < children.length; i++) {
				const itemContent = children.item(i)?.textContent;
				if (!itemContent) continue;
				childList.push(itemContent);
			}
			content = childList;
			if (content.length === 0) return;
			break;
		case 'text':
			content = body.textContent ?? '';
			if (content.length === 0) return;
			break;
	}

	return {
		title,
		content,
	};
}

function getNotionLinks(info: NotionResolverInfo, body: HTMLElement) {
	const links: NotionLink[] = [];

	for (const a of body.findAll('a') as HTMLAnchorElement[]) {
		const decodedURI = stripParentDirectories(
			decodeURI(a.getAttribute('href') ?? '')
		);
		const id = getNotionId(decodedURI);

		const attachmentPath = Object.keys(info.pathsToAttachmentInfo)
			.find(filename => filename.includes(decodedURI));
		if (id && decodedURI.endsWith('.html')) {
			links.push({ type: 'relation', a, id });
		}
		else if (attachmentPath) {
			links.push({ type: 'attachment', a, path: attachmentPath });
		}
		else if (
			id &&
			decodedURI.startsWith('#') &&
			a.parentElement?.classList.contains('table_of_contents-item')
		) {
			links.push({ type: 'toc-item', a, id });
		}
	}

	return links;
}

function fixDoubleBackslash(markdownBody: string) {
	// Persistent error during conversion where backslashes in full-path links written as '\\|' become double-slashes \\| in the markdown.
	// In tables, we have to use \| in internal links. This corrects the erroneous \\| in markdown.

	const slashSearch = /\[\[[^\]]*(\\\\)\|[^\]]*\]\]/;
	const doubleSlashes = markdownBody.match(new RegExp(slashSearch, 'g'));
	doubleSlashes?.forEach((slash) => {
		markdownBody = markdownBody.replace(
			slash,
			slash.replace(/\\\\\|/g, '\u005C|')
		);
	});

	return markdownBody;
}

function fixEquations(body: HTMLElement) {
	// Style tags before equations mess up formatting
	removeTags(body, 'style');
	// Notion adds an extra <br> if there is math just after a linebreak
	stripLeadingBr(body, 'span.notion-text-equation-token');
	const dom = body.ownerDocument;
	// Display Equations
	const figEqnEls = body.findAll('figure.equation');
	for (const figEqn of figEqnEls) {
		const annotation = figEqn.find('annotation');
		if (!annotation) continue;
		// Turn into <div> for reliable Markdown conversion
		const mathDiv = dom.createElement('div');
		mathDiv.className = 'annotation';
		// Put in <div> to aid stability of htmlToMarkdown conversion
		mathDiv.appendText(`$$${formatMath(annotation.textContent)}$$`);
		figEqn.replaceWith(mathDiv);
	}
	// Inline Equations
	const spanEqnEls = body.findAll('span.notion-text-equation-token');
	for (const spanEqn of spanEqnEls) {
		const annotation = spanEqn.find('annotation');
		if (!annotation) continue;
		spanEqn.replaceWith(`$${formatMath(annotation.textContent, true)}$`);
	}
}

/**
 * 1. Trims lead/trailing whitespace in LaTeX math experessions.
 * 2. Removes empty lines which can cause equations to break.
 *
 * NOTE: "\\" and "\ " are the escapes for line-breaks and white-space,
 * matched by "\\\\" and "\s" in the regex.
 */
function formatMath(math: string | null | undefined, inline: boolean = false): string {
	let regex = new RegExp(/^(?:\s|\\\\|\\\s)*(.*?)[\s\\]*$/, 's');
	return math?.replace(regex, '$1').replace(/[\r\n]+/g, (inline ? ' ' : '\n')) ?? '';
}

function stripToSentence(paragraph: string) {
	const firstSentence = paragraph.match(/^[^\.\?\!\n]*[\.\?\!]?/)?.[0];
	return firstSentence ?? '';
}

function isCallout(element: Element) {
	return !!(/callout|bookmark/.test(element.getAttribute('class') ?? ''));
}

function fixNotionCallouts(body: HTMLElement) {
	const dom = body.ownerDocument;
	for (let callout of body.findAll('figure.callout')) {
		// Can have 1–2 children; we always want .lastElementChild for callout content.
		const content = callout.lastElementChild?.childNodes;
		if (!content) continue;
		// Reformat as blockquote; HTMLtoMarkdown will convert automatically
		const calloutBlock = dom.createElement('blockquote');
		calloutBlock.append(...Array.from(content));
		// Add & format callout title element
		quoteToCallout(calloutBlock);
		callout.replaceWith(calloutBlock);
	}
}

/**
 * Converts a blockquote into an Obsidian-style callout
 *
 * Checks if calloutBlock.firstChild is a valid title
 * Forces title into <p>, to avoid #text node concatenating with other elements
 * Blockquote formatting enables htmlToMarkdown to deal with nesting
 *
 * If the callout is empty, an empty callout will still be created
*/
function quoteToCallout(quoteBlock: HTMLQuoteElement): void {
	const node: ChildNode | null = quoteBlock.firstChild;
	const name = node?.nodeName ?? '';
	const titlePar = quoteBlock.ownerDocument.createElement('p');
	let titleTxt = '';
	if (name == '#text') titleTxt = node?.textContent ?? '';
	else if (name == 'P') titleTxt = (<Element>node).innerHTML;
	else if (['EM', 'STRONG', 'DEL', 'MARK'].includes(name)) titleTxt = (<Element>node).outerHTML;
	else (quoteBlock.prepend(titlePar));
	// callout title must fit on one line in the MD file
	titleTxt = titleTxt.replace(/<br>/g, '&lt;br&gt;');
	titlePar.innerHTML = `[!important] ${titleTxt}`;
	quoteBlock.firstChild?.replaceWith(titlePar);
}

function fixNotionBookmarks(body: HTMLElement) {
	// Notion bookmarks are a box with images and description, we simplify for Obsidian.
	for (let bookmark of body.findAll('a.bookmark.source')) {
		const link = bookmark.getAttribute('href');
		const title = bookmark.find('div.bookmark-title')?.textContent;
		const description = stripToSentence(bookmark.find('div.bookmark-description')?.textContent ?? '');
		let calloutBlock = `> [!info] ${title}\n` + `> ${description}\n` + `> [${link}](${link})\n`;
		if (bookmark.nextElementSibling && isCallout(bookmark.nextElementSibling)) {
			// separate callouts with spaces
			calloutBlock += '\n';
		}
		bookmark.replaceWith(calloutBlock);
	}
}

function formatDatabases(body: HTMLElement) {
	// Notion includes user SVGs which aren't relevant to Markdown, so change them to pure text.
	for (const user of body.findAll('span[class=user]')) {
		user.innerText = user.textContent ?? '';
	}

	for (const checkbox of body.findAll('td div[class*=checkbox]')) {
		const newCheckbox = createSpan();
		newCheckbox.setText(checkbox.hasClass('checkbox-on') ? 'X' : '');
		checkbox.replaceWith(newCheckbox);
	}

	for (const select of body.findAll('table span[class*=selected-value]')) {
		const lastChild = select.parentElement?.lastElementChild;
		if (lastChild === select) continue;
		select.setText(select.textContent + ', ');
	}

	for (const a of body.findAll('a[href]') as HTMLAnchorElement[]) {
		// Strip URLs which aren't valid, changing them to normal text.
		if (!/^(https?:\/\/|www\.)/.test(a.href)) {
			const strippedURL = createSpan();
			strippedURL.setText(a.textContent ?? '');
			a.replaceWith(strippedURL);
		}
	}
}

function removeTags(body: HTMLElement, tag: string) {
	for (let el of body.findAll(tag)) {
		el.remove();
	}
}

/**
 * Fixes issues with formatting tags in Notion HTML export
 *
 * This includes:
 * - reducing nested tags
 * - merging adjacent tags
 * - stripping leading <br> artificats
 * - splitting tags at nested <br> points
 */
function fixFormatTags(body: HTMLElement, tagNames: FormatTagName[]) {
	// must occur in the order shown
	for (const t of tagNames) replaceNestedTags(body, t);
	for (const t of tagNames) mergeAdjacentTags(body, t);
	for (const t of tagNames) stripLeadingBr(body, t);
	for (const t of tagNames) splitBrsInFormatting(body, t);
}

function replaceNestedTags(body: HTMLElement, tag: FormatTagName) {
	for (const el of body.findAll(tag)) {
		if (!el.parentElement || el.parentElement.tagName === tag.toUpperCase()) {
			continue;
		}
		let firstNested = el.find(tag);
		while (firstNested) {
			hoistChildren(firstNested);
			firstNested = el.find(tag);
		}
	}
}

/**
 * Merges tags if identical tags are placed next to each other.
 */
function mergeAdjacentTags(body: HTMLElement, tagName: FormatTagName) {
	const tags = body.findAll(tagName);
	if (!tags) return;
	const regex = new RegExp(`</${tagName}>( *)<${tagName}>`, 'g');
	for (const tag of tags) {
		if (!tag || !tag.parentElement) continue;
		const parent = tag.parentElement;
		let parentHTML = parent?.innerHTML;
		parent.innerHTML = parentHTML?.replace(regex, '$1');
	}
}

/**
 * Strips leading <br> artificats created by Notion
 * These often occur before strong | em | mark | del tags
 */
function stripLeadingBr(body: HTMLElement, tagName: FormatTagName) {
	const tags = body.findAll(tagName);
	if (!tags) return;
	for (const tag of tags) {
		const prevNode = tag.previousSibling;
		prevNode?.nodeName == 'BR' && prevNode?.remove();
	}
}

function splitBrsInFormatting(body: HTMLElement, tagName: FormatTagName) {
	// Simpler to just use the HTML string for this replacement
	let htmlString = body.innerHTML;
	const tags = htmlString.match(new RegExp(`<${tagName}>.*?</${tagName}>`, 'sg'));
	if (!tags) return;
	for (let tag of tags.filter((tag) => tag.includes('<br>'))) {
		htmlString = htmlString.replace(
			tag,
			tag.split('<br>').join(`</${tagName}><br><${tagName}>`)
		);
	}
	body.innerHTML = htmlString;
}


function getTOCIndent(tocItem: Element | null): Number {
	return Number(tocItem?.classList[1].slice(-1) ?? -1);
}

/**
 * Recursively append new ToC `<li>` element after previous, based on relative indentation levels.
 *
 * @param itemNew the new ToC `<li>` item
 * @param itemPre previous ToC `<li>` item.  NOTE: `itemPre.children` is either: `[<span>]` or `[<span>, <ul>]`, where `<span>` is the item heading and `<ul>` contains nested ToC items.
 */
function appendTOCItem(itemNew: Element, itemPre: Element) {
	const indentNew = getTOCIndent(itemNew);
	const indentPre = getTOCIndent(itemPre);
	if (indentNew > indentPre && itemPre.childElementCount == 1) {
		const ulistNew = createEl('ul');
		ulistNew.append(itemNew);
		itemPre.append(ulistNew);
	}
	else if (indentNew > indentPre && itemPre.childElementCount == 2) {
		const ulistPre = itemPre.lastElementChild;
		ulistPre?.append(itemNew);
	}
	else if (indentNew == indentPre) {
		const ulistPre = itemPre.parentElement;
		ulistPre?.append(itemNew);
	}
	else if (indentNew < indentPre) {
		// the parent ToC item is 2 parentElements away
		const ulistPre = <HTMLElement>itemPre.parentElement;
		itemPre = <HTMLElement>ulistPre.parentElement;
		// recurse through parents until (indentNew == indentPre)
		appendTOCItem(itemNew, itemPre);
	}
}

/**
 * Creates new ToC <li> item from Notion ToC <div> item.
 *
 * Retains `className` for ToC indentation reference.
 *
 * @param item the original ToC <div> item
 * @returns the ToC <li> item
 */
function newTOCItem(item: Element) {
	const itemNew = createEl('li');
	itemNew.className = item.className;
	// inserts the nested ToC <span> element
	itemNew.append(item.firstElementChild ?? '');
	return itemNew;
}

/**
 * Reformats ToC into a list.
 *
 */
function formatTableOfContents(body: HTMLElement) {
	// het ToC <nav> element
	const tocNavEl = body.find('.table_of_contents');
	const toc = tocNavEl?.children;
	if (!tocNavEl || toc.length == 0) return;

	// create empty ToC list & append first item
	const tocNew = createEl('ul');
	let itemNew = newTOCItem(toc[0]);
	tocNew.append(itemNew);

	let itemPre = itemNew;
	for (let i = 1; i < toc.length; i++) {
		// create list item <li>
		itemNew = newTOCItem(toc[i]);
		appendTOCItem(itemNew, itemPre);
		// keep track of previous TOC item
		itemPre = itemNew;
	}
	tocNavEl.replaceWith(tocNew);
}

function encodeNewlinesToBr(body: HTMLElement) {
	body.innerHTML = body.innerHTML.replace(/(?:\n|<br ?\/>)/g, '<br>');
	// Since <br> is ignored in codeblocks, we replace with newlines
	for (const block of body.findAll('code')) {
		for (const br of block.findAll('br')) {
			br.replaceWith('\n');
		}
	}
}

function stripLinkFormatting(body: HTMLElement) {
	for (const link of body.findAll('link')) {
		link.innerText = link.textContent ?? '';
	}
}

function fixNotionDates(body: HTMLElement) {
	// Notion dates always start with @
	for (const time of body.findAll('time')) {
		time.textContent = time.textContent?.replace(/@/g, '') ?? '';
	}
}

const fontSizeToHeadings: Record<string, 'h1' | 'h2' | 'h3'> = {
	'1.875em': 'h1',
	'1.5em': 'h2',
	'1.25em': 'h3',
};

function fixToggleHeadings(body: HTMLElement) {
	const toggleHeadings = body.findAll('summary');
	for (const heading of toggleHeadings) {
		const style = heading.getAttribute('style');
		if (!style) continue;

		for (const key of Object.keys(fontSizeToHeadings)) {
			if (style.includes(key)) {
				heading.replaceWith(createEl(fontSizeToHeadings[key], { text: heading.textContent ?? '' }));
				break;
			}
		}
	}
}

function replaceElementsWithChildren(body: HTMLElement, selector: string) {
	let els = body.findAll(selector);
	for (const el of els) {
		hoistChildren(el);
	}
}

function fixMermaidCodeblock(body: HTMLElement) {
	for (const codeblock of body.findAll('.language-Mermaid')) {
		codeblock.removeClass('language-Mermaid');
		codeblock.addClass('language-mermaid');
	}
}

function fixNotionLists(body: HTMLElement, tagName: 'ul' | 'ol') {
	// Notion creates each list item within its own <ol> or <ul>, messing up newlines in the converted Markdown.
	// Iterate all adjacent <ul>s or <ol>s and replace each string of adjacent lists with a single <ul> or <ol>.
	for (const htmlList of body.findAll(tagName)) {
		const htmlLists: HTMLElement[] = [];
		const listItems: HTMLElement[] = [];
		let nextAdjacentList: HTMLElement = htmlList;

		while (nextAdjacentList.tagName === tagName.toUpperCase()) {
			htmlLists.push(nextAdjacentList);
			for (let i = 0; i < nextAdjacentList.children.length; i++) {
				listItems.push(nextAdjacentList.children[i] as HTMLElement);
			}
			// classes are always "to-do-list, bulleted-list, or numbered-list"
			if (!nextAdjacentList.nextElementSibling || nextAdjacentList.getAttribute('class') !== nextAdjacentList.nextElementSibling.getAttribute('class')) break;
			nextAdjacentList = nextAdjacentList.nextElementSibling as HTMLElement;
		}

		const joinedList = body.createEl(tagName);
		for (const li of listItems) {
			joinedList.appendChild(li);
		}

		htmlLists[0].replaceWith(joinedList);
		htmlLists.slice(1).forEach(htmlList => htmlList.remove());
	}
}

function addCheckboxes(body: HTMLElement) {
	for (let checkboxEl of body.findAll('.checkbox.checkbox-on')) {
		checkboxEl.replaceWith('[x] ');
	}
	for (let checkboxEl of body.findAll('.checkbox.checkbox-off')) {
		checkboxEl.replaceWith('[ ] ');
	}
}

function convertHtmlLinksToURLs(content: HTMLElement) {
	const links = content.findAll('a') as HTMLAnchorElement[];

	if (links.length === 0) return content;
	for (const link of links) {
		const span = createSpan();
		span.setText(link.getAttribute('href') ?? '');
		link.replaceWith(span);
	}
}

function convertLinksToObsidian(info: NotionResolverInfo, notionLinks: NotionLink[], embedAttachments: boolean) {
	for (let link of notionLinks) {
		let obsidianLink = createSpan();
		let linkContent: string = '';

		switch (link.type) {
			case 'relation':
				const linkInfo = info.idsToFileInfo[link.id];
				if (!linkInfo) {
					console.warn('missing relation data for id: ' + link.id);
					const { basename } = parseFilePath(
						decodeURI(link.a.getAttribute('href') ?? '')
					);

					linkContent = `[[${stripNotionId(basename)}]]`;
				}
				else {
					const isInTable = link.a.closest('table');
					linkContent = `[[${linkInfo.fullLinkPathNeeded
						? `${info.getPathForFile(linkInfo)}${linkInfo.title}${isInTable ? '\u005C' : ''}|${linkInfo.title}`
						: linkInfo.title
					}]]`;
				}
				break;
			case 'attachment':
				const attachmentInfo = info.pathsToAttachmentInfo[link.path];
				if (!attachmentInfo) {
					console.warn('missing attachment data for: ' + link.path);
					continue;
				}
				linkContent = `${embedAttachments ? '!' : ''}[[${attachmentInfo.fullLinkPathNeeded
					? attachmentInfo.targetParentFolder +
					attachmentInfo.nameWithExtension +
					'|' +
					attachmentInfo.nameWithExtension
					: attachmentInfo.nameWithExtension
				}]]`;
				break;
			case 'toc-item':
				// trailing space required in case link ends with ']'
				linkContent = link.a.textContent ?? '';
				const endBracket = linkContent.endsWith(']') ?? false;
				linkContent = `[[#${linkContent + (endBracket ? ' ' : '')}]]`;
		}

		obsidianLink.setText(linkContent);
		link.a.replaceWith(obsidianLink);
	}
}
