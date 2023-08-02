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
		// fileInfo.body = convertInlineDatabasesToObsidian(fileInfo.body, {
		// 	idsToFileInfo,
		// 	pathsToAttachmentInfo,
		// 	attachmentFolderPath,
		// });

		convertLinksToObsidian(fileInfo.notionLinks, {
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
			fileInfo,
		});

		replaceNestedTags(fileInfo.body, 'strong');
		replaceNestedTags(fileInfo.body, 'em');
		stripLinkFormatting(fileInfo.body);
		encodeNewlinesToBr(fileInfo.body);
		splitBrsInFormatting(fileInfo.body, 'strong');
		splitBrsInFormatting(fileInfo.body, 'em');
		fixNotionDates(fileInfo.body);
		fixNotionLists(fileInfo.body);
		replaceTableOfContents(fileInfo.body);

		fileInfo.markdownBody = htmlToMarkdown(fileInfo.body.innerHTML);
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
		const nestedEls = el.querySelectorAll(tag);
		if (nestedEls.length === 0) return;
		const textContent = el.textContent;
		nestedEls.forEach((nestedEl) => nestedEl.remove());
		el.setText(textContent);
	});
};

const splitBrsInFormatting = (body: HTMLDivElement, tag: 'strong' | 'em') => {
	body.querySelectorAll(tag).forEach((el) => {
		// TODO: check to see if newlines are stripped in textContent
		if (!/<br \/>/g.test(el.textContent)) return;
		el.innerHTML = el.innerHTML.replace(
			/<br \/>/g,
			`</${tag}><br /><${tag}>`
		);
	});
};

function replaceTableOfContents(body: HTMLDivElement) {
	const tocLinks = body.querySelectorAll(
		'a[href*=#]'
	) as NodeListOf<HTMLAnchorElement>;
	if (tocLinks.length === 0) return body;
	tocLinks.forEach((link) => {
		if (link.href.startsWith('#')) {
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

// function convertInlineDatabasesToObsidian(
// 	body: HTMLDivElement,
// 	{
// 		idsToFileInfo,
// 		pathsToAttachmentInfo,
// 		attachmentFolderPath,
// 	}: {
// 		idsToFileInfo: Record<string, NotionFileInfo>;
// 		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
// 		attachmentFolderPath: string;
// 	}
// ) {
// 	let inlineDatabases = body.querySelectorAll(
// 		`table[class="collection-content"]`
// 	) as NodeListOf<HTMLTableElement>;

// 	inlineDatabases.forEach((database) => {
// 		const rawDatabaseHeaders = database.querySelectorAll(
// 			'th'
// 		) as NodeListOf<HTMLTableCellElement>;
// 		const headers: string[] = [];
// 		rawDatabaseHeaders.forEach((header) => {
// 			headers.push(header.textContent);
// 		});
// 		const childRows = database.querySelectorAll('tr');
// 		const childIds: string[] = [];
// 		childRows.forEach((row) => {
// 			const id = getNotionId(row.getAttribute('id'))

// 			headers.forEach(header => {

// 			})
// 		});

// 		const processedRows = childIds.map((childId, i) => {
// 			const childFileInfo = idsToFileInfo[childId];

// 			// if there's no child included in the import, just use row's basic HTML formatting as a fallback
// 			const childCells = childRows[i].match(/<td((.|\n)*?)<\/td>/g);
// 			if (!childFileInfo)
// 				return childCells.map(
// 					(cell) => cell.match(/<td.*?>(.*?)<\/td>/)?.[1] ?? ''
// 				);

// 			const processedRow: string[] = headers.map((propertyName, i) => {
// 				if (childCells[i].contains('class="cell-title"')) {
// 					return fileInfoToObsidianLink(childFileInfo, {
// 						idsToFileInfo,
// 					});
// 				} else {
// 					const property = childFileInfo.properties.find(
// 						(property) => property.title === propertyName
// 					);
// 					if (!property) return '';
// 					return convertPropertyToMarkdown(property, {
// 						idsToFileInfo,
// 						pathsToAttachmentInfo,
// 						fileInfo: childFileInfo,
// 						attachmentFolderPath,
// 					});
// 				}
// 			});
// 			return processedRow;
// 		});

// 		const formattedDatabase = `| ${headers.join(' | ')} |<br />| ${headers
// 			.map(() => '---')
// 			.join(' | ')} |<br />${processedRows
// 			.map((row) => `| ${row.join(' | ')} |`)
// 			.join('<br />')}<br />`;

// 		body = body.replace(inlineDatabase[0], formattedDatabase);

// 		inlineDatabase = body.match(DATABASE_MATCH);
// 	});

// 	return body;
// }

// function convertPropertyToMarkdown(
// 	property: NotionFileInfo['properties'][number],
// 	{
// 		idsToFileInfo,
// 		pathsToAttachmentInfo,
// 		fileInfo,
// 		attachmentFolderPath,
// 	}: {
// 		idsToFileInfo: Record<string, NotionFileInfo>;
// 		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
// 		fileInfo: NotionFileInfo;
// 		attachmentFolderPath: string;
// 	}
// ) {
// 	if (property.body === undefined) return '';

// 	switch (property.type) {
// 		case 'checkbox':
// 			return property.body ? 'X' : ' ';
// 		case 'date':
// 			return property.body.hour() === 0 && property.body.minute() === 0
// 				? property.body.format('MMMM D, YYYY')
// 				: property.body.format('MMMM D, YYYY h:mm A');
// 		case 'list':
// 			return property.body
// 				.filter((content) => content)
// 				.map((content) =>
// 					convertLinksToObsidian(content, {
// 						idsToFileInfo,
// 						pathsToAttachmentInfo,
// 						fileInfo,
// 						attachmentFolderPath,
// 					})
// 				)
// 				.join(', ');
// 		case 'number':
// 			return String(property.body);
// 		case 'text':
// 			return convertLinksToObsidian(property.body, {
// 				idsToFileInfo,
// 				pathsToAttachmentInfo,
// 				fileInfo,
// 				attachmentFolderPath,
// 			});
// 	}
// }

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
			attachmentFolderPath,
			embedAttachments: false,
			fileInfo,
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
		span.setText(link.href);
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
		attachmentFolderPath,
		embedAttachments = true,
		fileInfo,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		attachmentFolderPath: string;
		embedAttachments?: boolean;
		fileInfo: NotionFileInfo;
	}
) {
	const parentFolder = getParentFolder(fileInfo.path);

	for (let link of notionLinks) {
		let obsidianLink = document.createElement('span');
		let linkContent: string;

		switch (link.type) {
			case 'relation':
				const linkInfo = idsToFileInfo[link.id];
				if (!linkInfo) {
					console.warn('missing relation data for id: ' + link.id);
					const extractedFilename = matchFilename(
						decodeURI(link.a.href)
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
