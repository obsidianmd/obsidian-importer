import { FrontMatterCache, htmlToMarkdown, moment } from 'obsidian';
import { parseFilePath } from '../../filesystem';
import { parseHTML, serializeFrontMatter } from '../../util';
import { ZipEntryFile } from '../../zip';
import { NotionLink, NotionResolverInfo, NotionProperty, NotionPropertyType, YamlProperty } from './notion-types';
import { escapeHashtags, getNotionId, parseDate, stripNotionId, stripParentDirectories } from './notion-utils';

export async function readToMarkdown(info: NotionResolverInfo, file: ZipEntryFile): Promise<string> {
	const text = await file.readText();

	const dom = parseHTML(text);
	// read the files etc.
	const body = dom.find('div[class=page-body]');

	const notionLinks = getNotionLinks(info, body);

	convertLinksToObsidian(info, notionLinks, true);

	let frontMatter: FrontMatterCache = {};

	const rawProperties = dom.find('table[class=properties] > tbody') as HTMLTableSectionElement;
	if (rawProperties) {
		const propertyLinks = getNotionLinks(info, rawProperties);
		convertLinksToObsidian(info, propertyLinks, false);
		// YAML only takes raw URLS
		convertHtmlLinksToURLs(rawProperties);

		for (let row of Array.from(rawProperties.rows)) {
			const property = parseProperty(row);
			if (property) {
				frontMatter[property.title] = property.content;
			}
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

const parseProperty = (property: HTMLTableRowElement): YamlProperty | undefined => {
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
};

const getNotionLinks = (info: NotionResolverInfo, body: HTMLElement) => {
	const links: NotionLink[] = [];

	body.findAll('a').forEach((a: HTMLAnchorElement) => {
		const decodedURI = stripParentDirectories(
			decodeURI(a.getAttribute('href') ?? '')
		);
		const id = getNotionId(decodedURI);

		const attachmentPath = Object.keys(info.pathsToAttachmentInfo).find((filename) =>
			filename.includes(decodedURI)
		);
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
	const users = body.findAll('span[class=user]') as HTMLSpanElement[];
	users.forEach((user) => {
		user.innerText = user.textContent ?? '';
	});

	const checkboxes = body.findAll('td div[class*=checkbox]');
	checkboxes.forEach((checkbox) => {
		const newCheckbox = createSpan();
		newCheckbox.setText(
			checkbox.className.contains('checkbox-on') ? 'X' : ''
		);
		checkbox.replaceWith(newCheckbox);
	});

	const selectedValues = body.findAll('table span[class*=selected-value]');
	selectedValues.forEach((select) => {
		const lastChild = select.parentElement?.lastElementChild;
		if (lastChild === select) return;
		select.setText(select.textContent + ', ');
	});

	const linkValues = body.findAll('a[href]') as HTMLAnchorElement[];
	linkValues.forEach((a) => {
		// Strip URLs which aren't valid, changing them to normal text.
		if (!/^(https?:\/\/|www\.)/.test(a.href)) {
			const strippedURL = createSpan();
			strippedURL.setText(a.textContent ?? '');
			a.replaceWith(strippedURL);
		}
	});
};

const replaceNestedTags = (body: HTMLElement, tag: 'strong' | 'em') => {
	body.findAll(tag).forEach((el) => {
		if (!el.parentElement || el.parentElement.tagName === tag.toUpperCase()) {
			return;
		}
		let firstNested = el.querySelector(tag);
		while (firstNested) {
			const childrenOfNested = firstNested.childNodes;
			const hoistedChildren = createFragment();
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

function replaceTableOfContents(body: HTMLElement) {
	const tocLinks = body.findAll('a[href*=\\#]') as HTMLAnchorElement[];
	if (tocLinks.length === 0) return body;
	tocLinks.forEach((link) => {
		if (link.getAttribute('href')?.startsWith('#')) {
			link.setAttribute('href', '#' + link.textContent);
		}
	});
}

const encodeNewlinesToBr = (body: HTMLElement) => {
	body.innerHTML = body.innerHTML.replace(/\n/g, '<br />');
};

const stripLinkFormatting = (body: HTMLElement) => {
	body.findAll('link').forEach((link) => {
		link.innerText = link.textContent ?? '';
	});
};

const fixNotionDates = (body: HTMLElement) => {
	// Notion dates always start with @
	body.findAll('time').forEach((time) => {
		time.textContent = time.textContent?.replace(/@/g, '') ?? '';
	});
};

const fixNotionLists = (body: HTMLElement) => {
	// Notion encodes lists as strings of <ul>s or <ol>s (because of its block structure), which results in newlines between all list items.
	body.innerHTML = body.innerHTML
		.replace(
			/<\/li><\/ul><ul id=".*?" [^>]*><li [^>]*>/g,
			'</li><li style="list-style-type:disc">'
		)
		.replace(/<\/li><\/ol><ol [^>]*><li>/g, '</li><li>');
};

function convertHtmlLinksToURLs(content: HTMLElement) {
	const links = content.findAll('a') as HTMLAnchorElement[];

	if (links.length === 0) return content;
	links.forEach((link) => {
		const span = createSpan();
		span.setText(link.getAttribute('href') ?? '');
		link.replaceWith(span);
	});
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
					linkContent = `[[${
						linkInfo.fullLinkPathNeeded
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
