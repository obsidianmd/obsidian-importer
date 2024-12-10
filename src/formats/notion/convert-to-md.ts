import { FrontMatterCache, htmlToMarkdown, moment } from 'obsidian';
import { parseFilePath } from '../../filesystem';
import { parseHTML, serializeFrontMatter } from '../../util';
import { ZipEntryFile } from '../../zip';
import { NotionLink, NotionProperty, NotionPropertyType, NotionResolverInfo, YamlProperty } from './notion-types';
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

	replaceNestedTags(body, 'strong');
	replaceNestedTags(body, 'em');
	fixNotionEmbeds(body);
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

	addCheckboxes(body);
	replaceTableOfContents(body);
	formatDatabases(body);

	let htmlString = body.innerHTML;

	// Simpler to just use the HTML string for this replacement
	splitBrsInFormatting(htmlString, 'strong');
	splitBrsInFormatting(htmlString, 'em');


	let markdownBody = htmlToMarkdown(htmlString);
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
			links.push({
				type: 'attachment',
				a,
				path: attachmentPath,
			});
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
	// Display Equations
	const figEqnEls = body.findAll('figure.equation');
	for (const figEqn of figEqnEls) {
		const annotation = figEqn.find('annotation');
		if (!annotation) continue;
		figEqn.replaceWith(`$$${formatMath(annotation.textContent)}$$`);
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
function formatMath(math: string | null | undefined, inline: boolean=false): string {
	let regex = new RegExp(/^(?:[\s\r\n]|\\\\|\\\s)*(.*?)[\s\r\n\\]*$/, 's');
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
	for (let callout of body.findAll('figure.callout')) {
		// Can have 1–2 children; we always want .lastElementChild for callout content.
		const description = callout.lastElementChild?.textContent;
		let calloutBlock = `> [!important]\n> ${description}\n`;
		if (callout.nextElementSibling && isCallout(callout.nextElementSibling)) {
			calloutBlock += '\n';
		}
		callout.replaceWith(calloutBlock);
	}
}

function fixNotionEmbeds(body: HTMLElement) {
	// Notion embeds are a box with images and description, we simplify for Obsidian.
	for (let embed of body.findAll('a.bookmark.source')) {
		const link = embed.getAttribute('href');
		const title = embed.find('div.bookmark-title')?.textContent;
		const description = stripToSentence(embed.find('div.bookmark-description')?.textContent ?? '');
		let calloutBlock = `> [!info] ${title}\n` + `> ${description}\n` + `> [${link}](${link})\n`;
		if (embed.nextElementSibling && isCallout(embed.nextElementSibling)) {
			// separate callouts with spaces
			calloutBlock += '\n';
		}
		embed.replaceWith(calloutBlock);
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

function replaceNestedTags(body: HTMLElement, tag: 'strong' | 'em') {
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

function splitBrsInFormatting(htmlString: string, tag: 'strong' | 'em') {
	const tags = htmlString.match(new RegExp(`<${tag}>(.|\n)*</${tag}>`));
	if (!tags) return;
	for (let tag of tags.filter((tag) => tag.contains('<br />'))) {
		htmlString = htmlString.replace(
			tag,
			tag.split('<br />').join(`</${tag}><br /><${tag}>`)
		);
	}
}

function replaceTableOfContents(body: HTMLElement) {
	const tocLinks = body.findAll('a[href*=\\#]') as HTMLAnchorElement[];
	for (const link of tocLinks) {
		if (link.getAttribute('href')?.startsWith('#')) {
			link.setAttribute('href', '#' + link.textContent);
		}
	}
}

function encodeNewlinesToBr(body: HTMLElement) {
	body.innerHTML = body.innerHTML.replace(/\n/g, '<br />');
	// Since <br /> is ignored in codeblocks, we replace with newlines
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
		let linkContent: string;

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
		}

		obsidianLink.setText(linkContent);
		link.a.replaceWith(obsidianLink);
	}
}
