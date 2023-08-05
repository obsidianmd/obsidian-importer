import { Entry, TextWriter } from '@zip.js/zip.js';
import { parseFilePath } from 'filesystem';
import { htmlToMarkdown, moment } from 'obsidian';
import { escapeHashtags } from '../../util';
import {
	assembleParentIds,
	getNotionId,
	parseDate,
	stripNotionId,
} from './notion-utils';

export async function readToMarkdown(
	file: Entry,
	{
		attachmentPaths,
		idsToFileInfo,
		pathsToAttachmentInfo,
		parser,
	}: {
		attachmentPaths: string[];
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		parser: DOMParser;
	}
): Promise<{ markdownBody: string; properties: YamlProperty[] }> {
	if (!file.getData)
		throw new Error("can't get data in file, " + file.filename);
	const filePath = file.filename;

	const text = await file.getData(new TextWriter());

	const document = parser.parseFromString(text, 'text/html');
	// read the files etc.
	const body = document.querySelector(
		`div[class=page-body]`
	) as HTMLDivElement;

	const notionLinks = getNotionLinks(body, {
		attachmentPaths,
	});

	convertLinksToObsidian(notionLinks, {
		idsToFileInfo,
		pathsToAttachmentInfo,
	});

	const rawProperties = document.querySelector(
		`table[class=properties] > tbody`
	) as HTMLTableSectionElement | null;

	if (rawProperties) {
		const propertyLinks = getNotionLinks(rawProperties, {
			attachmentPaths,
		});
		convertLinksToObsidian(propertyLinks, {
			idsToFileInfo,
			pathsToAttachmentInfo,
			embedAttachments: false,
		});
		// YAML only takes raw URLS
		convertHtmlLinksToURLs(rawProperties);
	}

	const properties: YamlProperty[] = [];

	if (rawProperties) {
		for (let i = 0; i < rawProperties.children.length; i++) {
			const row = rawProperties.children.item(i) as HTMLTableRowElement;
			const property = parseProperty(row);
			if (property) properties.push(property);
		}
	}

	replaceNestedTags(body, 'strong');
	replaceNestedTags(body, 'em');
	stripLinkFormatting(body);
	encodeNewlinesToBr(body);
	fixNotionDates(body);
	fixNotionLists(body);
	replaceTableOfContents(body);
	formatDatabases(body);

	let htmlString = body.innerHTML;
	// Simpler to just use the HTML string for this replacement
	splitBrsInFormatting(htmlString, 'strong');
	splitBrsInFormatting(htmlString, 'em');

	let markdownBody = htmlToMarkdown(htmlString);
	markdownBody = escapeHashtags(markdownBody);
	markdownBody = fixDoubleBackslash(markdownBody);

	const description = document.querySelector(
		`p[class*=page-description]`
	)?.textContent;
	if (description) markdownBody = description + '\n' + markdownBody;

	return { markdownBody, properties };
}

const parseProperty = (
	property: HTMLTableRowElement
): YamlProperty | undefined => {
	const notionType = property.className.match(
		/property-row-(.*)/
	)?.[1] as NotionPropertyType;
	if (!notionType)
		throw new Error('property type not found for: ' + property);

	const title = htmlToMarkdown(property.cells[0].textContent ?? '');

	const body = property.cells[1];

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
			} else if (dates.length === 1) {
				content = parseDate(moment(dates.item(0)?.textContent));
			} else {
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
};

const getNotionLinks = (
	body: HTMLElement,
	{
		attachmentPaths,
	}: {
		attachmentPaths: string[];
	}
) => {
	const links: NotionLink[] = [];

	body.querySelectorAll('a').forEach((a) => {
		const decodedURI = decodeURI(a.getAttribute('href') ?? '');
		const id = getNotionId(decodedURI);

		const attachmentPath = attachmentPaths.find((filename) =>
			filename.includes(decodedURI)
		);
		if (attachmentPath) {
			links.push({
				type: 'attachment',
				a,
				path: attachmentPath,
			});
		} else if (id && decodedURI.endsWith('.html')) {
			links.push({ type: 'relation', a, id });
		}
	});

	return links;
};

const fixDoubleBackslash = (markdownBody: string) => {
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
};

const formatDatabases = (body: HTMLElement) => {
	// Notion includes user SVGs which aren't relevant to Markdown, so change them to pure text.
	const users = body.querySelectorAll(
		'span[class=user]'
	) as NodeListOf<HTMLSpanElement>;
	users.forEach((user) => {
		user.innerText = user.textContent ?? '';
	});

	const checkboxes = body.querySelectorAll('td div[class*=checkbox]');
	checkboxes.forEach((checkbox) => {
		const newCheckbox = document.createElement('span');
		newCheckbox.setText(
			checkbox.className.contains('checkbox-on') ? 'X' : ''
		);
		checkbox.replaceWith(newCheckbox);
	});

	const selectedValues = body.querySelectorAll(
		'table span[class*=selected-value]'
	);
	selectedValues.forEach((select) => {
		const lastChild = select.parentElement?.lastElementChild;
		if (lastChild === select) return;
		select.setText(select.textContent + ', ');
	});

	const linkValues = body.querySelectorAll(
		'a[href]'
	) as NodeListOf<HTMLAnchorElement>;
	linkValues.forEach((a) => {
		// Any <a> with an email, phone number, or non-URL value registers as an internal link in Obsidian. [email@gmail.com](email@gmail.com) will create a new note when clicked. This strips these erroneous links.
		if (a.href.startsWith('app://obsidian.md')) {
			const strippedURL = document.createElement('span');
			strippedURL.setText(a.textContent ?? '');
			a.replaceWith(strippedURL);
		}
	});
};

const replaceNestedTags = (body: HTMLElement, tag: 'strong' | 'em') => {
	body.querySelectorAll(tag).forEach((el) => {
		if (!el.parentElement || el.parentElement.tagName === tag.toUpperCase())
			return;
		let firstNested = el.querySelector(tag);
		while (firstNested) {
			const childrenOfNested = firstNested.childNodes;
			const hoistedChildren = document.createDocumentFragment();
			childrenOfNested.forEach((child) =>
				hoistedChildren.appendChild(child)
			);
			firstNested.replaceWith(hoistedChildren);
			firstNested = el.querySelector(tag);
		}
	});
};

const splitBrsInFormatting = (htmlString: string, tag: 'strong' | 'em') => {
	const tags = htmlString.match(new RegExp(`<${tag}>(.|\n)*</${tag}>`));
	if (!tags) return;
	for (let tag of tags.filter((tag) => tag.contains('<br />'))) {
		htmlString = htmlString.replace(
			tag,
			tag.split('<br />').join(`</${tag}><br /><${tag}>`)
		);
	}
};

function replaceTableOfContents(body: HTMLDivElement) {
	const tocLinks = body.querySelectorAll(
		'a[href*=\\#]'
	) as NodeListOf<HTMLAnchorElement>;
	if (tocLinks.length === 0) return body;
	tocLinks.forEach((link) => {
		if (link.getAttribute('href')?.startsWith('#')) {
			link.setAttribute('href', '#' + link.textContent);
		}
	});
}

const encodeNewlinesToBr = (body: HTMLDivElement) => {
	body.innerHTML = body.innerHTML.replace(/\n/g, '<br />');
};

const stripLinkFormatting = (body: HTMLDivElement) => {
	body.querySelectorAll('link').forEach((link) => {
		link.innerText = link.textContent ?? '';
	});
};

const fixNotionDates = (body: HTMLDivElement) => {
	// Notion dates always start with @
	body.querySelectorAll('time').forEach((time) => {
		time.textContent = time.textContent?.replace(/@/g, '') ?? '';
	});
};

const fixNotionLists = (body: HTMLDivElement) => {
	// Notion encodes lists as strings of <ul>s or <ol>s (because of its block structure), which results in newlines between all list items.
	body.innerHTML = body.innerHTML
		.replace(
			/<\/li><\/ul><ul id=".*?" [^>]*><li [^>]*>/g,
			'</li><li style="list-style-type:disc">'
		)
		.replace(/<\/li><\/ol><ol [^>]*><li>/g, '</li><li>');
};

function convertHtmlLinksToURLs(content: HTMLElement) {
	const links = content.getElementsByTagName('a');
	if (links.length === 0) return content;
	for (let i = 0; i < links.length; i++) {
		const link = links.item(i);
		if (!link) continue;
		const span = document.createElement('span');
		span.setText(link.getAttribute('href') ?? '');
		link.replaceWith(span);
	}
	return content;
}

function convertLinksToObsidian(
	notionLinks: NotionLink[],
	{
		idsToFileInfo,
		pathsToAttachmentInfo,
		embedAttachments = true,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		embedAttachments?: boolean;
	}
) {
	for (let link of notionLinks) {
		let obsidianLink = document.createElement('span');
		let linkContent: string;

		switch (link.type) {
			case 'relation':
				const linkInfo = idsToFileInfo[link.id];
				if (!linkInfo) {
					console.warn('missing relation data for id: ' + link.id);
					const { basename } = parseFilePath(
						decodeURI(link.a.getAttribute('href') ?? '')
					);

					linkContent = `[[${stripNotionId(basename)}]]`;
				} else {
					const isInTable = link.a.closest('table');
					linkContent = `[[${
						linkInfo.fullLinkPathNeeded
							? `${assembleParentIds(
									linkInfo,
									idsToFileInfo
							  ).join('')}${linkInfo.title}${
									isInTable ? '\u005C' : ''
							  }|${linkInfo.title}`
							: linkInfo.title
					}]]`;
				}
				break;
			case 'attachment':
				const attachmentInfo = pathsToAttachmentInfo[link.path];
				if (!attachmentInfo) {
					console.warn('missing attachment data for: ' + link.path);
					continue;
				}
				linkContent = `${embedAttachments ? '!' : ''}[[${
					attachmentInfo.fullLinkPathNeeded
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
