import { htmlToMarkdown } from 'obsidian';
import {
	escapeHashtags,
	escapeRegex,
	getParentFolder,
	matchFilename,
} from '../../util';
import {
	assembleParentIds,
	getNotionId,
	stripNotionId,
	parseDate,
} from './notion-utils';
import moment from 'moment';

export function convertNotesToMd({
	idsToFileInfo,
	pathsToAttachmentInfo,
	attachmentFolderPath,
}: {
	idsToFileInfo: Record<string, NotionFileInfo>;
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
	attachmentFolderPath: string;
}) {
	for (let fileInfo of Object.values(idsToFileInfo)) {
		convertLinksToObsidian(fileInfo.notionLinks, {
			idsToFileInfo,
			pathsToAttachmentInfo,
		});

		replaceNestedTags(fileInfo.body, 'strong');
		replaceNestedTags(fileInfo.body, 'em');
		stripLinkFormatting(fileInfo.body);
		encodeNewlinesToBr(fileInfo.body);
		fixNotionDates(fileInfo.body);
		fixNotionLists(fileInfo.body);
		replaceTableOfContents(fileInfo.body);

		let htmlString = fileInfo.body.innerHTML;
		// Simpler to just use the HTML string for this replacement
		splitBrsInFormatting(htmlString, 'strong');
		splitBrsInFormatting(htmlString, 'em');

		fileInfo.markdownBody = htmlToMarkdown(htmlString);
		fileInfo.markdownBody = escapeHashtags(fileInfo.markdownBody);

		if (fileInfo.properties) {
			fileInfo.yamlProperties = fileInfo.properties.map((property) =>
				convertPropertyToYAML(property, {
					fileInfo,
					idsToFileInfo,
					pathsToAttachmentInfo,
					attachmentFolderPath,
				})
			);
		}
	}
}

const replaceNestedTags = (body: HTMLElement, tag: 'strong' | 'em') => {
	body.querySelectorAll(tag).forEach((el) => {
		if (el.parentElement.tagName === tag.toUpperCase()) return;
		const nestedEls = el.querySelectorAll(tag);
		if (nestedEls.length === 0) return;
		for (let i = 0; i < nestedEls.length; i++) {
			const children = nestedEls[i].childNodes;
			children.forEach((child) => el.appendChild(child));
		}
		nestedEls.forEach((nestedEl) => nestedEl.remove());
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
		if (link.getAttribute('href').startsWith('#')) {
			link.setAttribute('href', '#' + link.textContent);
		}
	});
}

const encodeNewlinesToBr = (body: HTMLDivElement) => {
	body.innerHTML = body.innerHTML.replace(/\n/g, '<br />');
};

const stripLinkFormatting = (body: HTMLDivElement) => {
	body.querySelectorAll('link').forEach((link) => {
		link.innerHTML = link.textContent;
	});
};

const fixNotionDates = (body: HTMLDivElement) => {
	body.innerHTML = body.innerHTML.replace(/@(\w+ \d\d?, \d{4})/g, '$1');
};

const fixNotionLists = (body: HTMLDivElement) => {
	body.innerHTML = body.innerHTML
		.replace(
			/<\/li><\/ul><ul id=".*?" [^>]*><li [^>]*>/g,
			'</li><li style="list-style-type:disc">'
		)
		.replace(/<\/li><\/ol><ol [^>]*><li>/g, '</li><li>');
};

function convertPropertyToYAML(
	property: NotionFileInfo['properties'][number],
	{
		idsToFileInfo,
		pathsToAttachmentInfo,
		fileInfo,
		attachmentFolderPath,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		fileInfo: NotionFileInfo;
		attachmentFolderPath: string;
	}
): YamlProperty {
	let content: YamlProperty['content'];

	if (['text', 'list'].includes(property.type)) {
		convertLinksToObsidian(property.links, {
			idsToFileInfo,
			pathsToAttachmentInfo,
			embedAttachments: false,
		});
		convertHtmlLinksToURLs(property.body);
	}

	switch (property.type) {
		case 'checkbox':
			content = property.body.innerHTML.includes('checkbox-on');
			break;
		case 'number':
			content = Number(property.body.textContent);
			break;
		case 'date':
			fixNotionDates(property.body);
			const dates = property.body.getElementsByTagName('time');
			if (dates.length === 0) {
				content = '';
			} else if (dates.length === 1) {
				content = parseDate(moment(dates.item(0).textContent));
			} else {
				const dateList = [];
				for (let i = 0; i < dates.length; i++) {
					dateList.push(parseDate(moment(dates.item(i).textContent)));
				}
				content = dateList.join(' - ');
			}
			break;
		case 'list':
			const children = property.body.children;
			const childList: string[] = [];
			for (let i = 0; i < children.length; i++) {
				childList.push(children.item(i).textContent);
			}
			content = childList;
			break;
		case 'text':
			content = property.body.textContent;
			break;
	}
	return {
		title: htmlToMarkdown(property.title),
		content,
	};
}

function convertHtmlLinksToURLs(content: HTMLElement) {
	const links = content.getElementsByTagName('a');
	if (links.length === 0) return content;
	for (let i = 0; i < links.length; i++) {
		const link = links.item(i);
		const span = document.createElement('span');
		span.setText(link.getAttribute('href'));
		link.insertAdjacentElement('afterend', span);
		link.remove();
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
					const extractedFilename = matchFilename(
						decodeURI(link.a.getAttribute('href'))
					);
					linkContent = `[[${stripNotionId(extractedFilename)}]]`;
				} else {
					linkContent = `[[${
						linkInfo.fullLinkPathNeeded
							? assembleParentIds(linkInfo, idsToFileInfo).join(
									''
							  ) +
							  linkInfo.title +
							  '\\' +
							  '|' +
							  linkInfo.title
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
						? attachmentInfo.parentFolderPath +
						  attachmentInfo.nameWithExtension +
						  '|' +
						  attachmentInfo.nameWithExtension
						: attachmentInfo.nameWithExtension
				}]]`;
				break;
		}

		obsidianLink.setText(linkContent);
		link.a.insertAdjacentElement('afterend', obsidianLink);
		link.a.remove();
	}
}
