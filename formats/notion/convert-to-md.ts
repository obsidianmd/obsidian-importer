import { htmlToMarkdown } from 'obsidian';
import { escapeHashtags, escapeRegex, getParentFolder } from '../../util';
import {
	assembleParentIds,
	extractHref,
	getAttachmentPath,
	getNotionId,
	matchAttachmentLinks,
	matchRelationLinks,
} from './notion-utils';

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
		fileInfo.body = convertInlineDatabasesToObsidian(fileInfo.body, {
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
		});

		fileInfo.body = convertLinksToObsidian(fileInfo.body, {
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
			fileInfo,
		});

		replaceNestedFormatting(fileInfo.body);
		replaceNewlinesInFormatting(fileInfo.body);
		encodeNewlines(fileInfo.body);
		stripLinkImages(fileInfo.body);
		fixNotionDates(fileInfo.body);
		fixNotionLists(fileInfo.body);
		replaceTableOfContents(fileInfo.body);
		fileInfo.body = htmlToMarkdown(fileInfo.body);
		fileInfo.body = escapeHashtags(fileInfo.body);

		if (fileInfo.properties) {
			fileInfo.yamlProperties = fileInfo.properties
				.filter((property) => property.content)
				.map((property) =>
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

const replaceNestedFormatting = (body: string) => {
	body = body
		.replace(/<strong>(<strong>)+/g, '<strong>')
		.replace(/<\/strong>(<\/strong>)+/g, '</strong>')
		.replace(/<em>(<em>)+/g, '<em>')
		.replace(/<\/em>(<\/em>)+/g, '</em>');
};

const replaceNewlinesInFormatting = (body: string) => {
	const strongs = body.matchAll(/<strong>((.|\n)*)<\/strong>/g);
	for (let strong of strongs) {
		if (strong[1].contains('\n')) {
			const strongs = strong[1].split('\n');
			body = body.replace(
				strong[0],
				strongs.map((strong) => `<strong>${strong}</strong>`).join('\n')
			);
		}
	}
	const italics = body.matchAll(/<em>((.|\n)*)<\/em>/g);
	for (let italic of italics) {
		if (italic[1].contains('\n')) {
			const italics = italic[1].split('\n');
			body = body.replace(
				italic[0],
				italics.map((italic) => `<em>${italic}</em>`).join('\n')
			);
		}
	}
};

function replaceTableOfContents(body: string) {
	const tocLinks = body.match(
		/<a class="table_of_contents\-link" href=.*?>.*?<\/a>/g
	);
	if (!tocLinks) return body;
	for (let link of tocLinks) {
		const linkTitle = link.match(/>(.*?)<\/a>/)[1];
		body = body.replace(link, `<a href="#${linkTitle}">${linkTitle}</a>`);
	}
}

const encodeNewlines = (body: string) => {
	body = body.replace(/\n/g, '<br />');
};

const stripLinkImages = (body: string) => {
	body = body.replace(/<a [^>]+>(<[^>]+>?[^>]+\/>)+([^<]+?)<\/a>/g, '$2');
};

const fixNotionDates = (body: string) => {
	body = body.replace(/@(\w+ \d\d?, \d{4})/g, '$1');
};

const fixNotionLists = (body: string) => {
	body = body
		.replace(
			/<\/li><\/ul><ul id=".*?" [^>]*><li [^>]*>/g,
			'</li><li style="list-style-type:disc">'
		)
		.replace(/<\/li><\/ol><ol [^>]*><li>/g, '</li><li>');
};

function convertInlineDatabasesToObsidian(
	body: string,
	{
		idsToFileInfo,
		pathsToAttachmentInfo,
		attachmentFolderPath,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		attachmentFolderPath: string;
	}
) {
	const DATABASE_MATCH =
		/<table class="collection-content"><thead>((.|\n)*?)<\/thead><tbody>((.|\n)*?)<\/tbody><\/table>/;
	let inlineDatabase = body.match(DATABASE_MATCH);
	while (inlineDatabase) {
		const rawDatabaseHeaders = inlineDatabase[1].match(/<th>.*?<\/th>/g);
		const headers = rawDatabaseHeaders.map((header) => {
			return header.match(/<\/span>((.|\n)*?)<\/th>/)[1];
		});
		const childRows = inlineDatabase[3].match(
			/<tr id=".*?">((.|\n)*?)<\/tr>/g
		);
		const childIds = childRows.map((row) =>
			getNotionId(row.match(/<tr id="(.*?)"/)[1])
		);

		const processedRows = childIds.map((childId, i) => {
			const childFileInfo = idsToFileInfo[childId];

			// if there's no child included in the import, just use row's basic HTML formatting as a fallback
			const childCells = childRows[i].match(/<td((.|\n)*?)<\/td>/g);
			if (!childFileInfo)
				return childCells.map(
					(cell) => cell.match(/<td.*?>(.*?)<\/td>/)?.[1] ?? ''
				);

			const processedRow: string[] = headers.map((propertyName, i) => {
				if (childCells[i].contains('class="cell-title"')) {
					return fileInfoToObsidianLink(childFileInfo, {
						idsToFileInfo,
					});
				} else {
					const property = childFileInfo.properties.find(
						(property) => property.title === propertyName
					);
					if (!property) return '';
					return convertPropertyToMarkdown(property, {
						idsToFileInfo,
						pathsToAttachmentInfo,
						fileInfo: childFileInfo,
						attachmentFolderPath,
					});
				}
			});
			return processedRow;
		});

		const formattedDatabase = `| ${headers.join(' | ')} |<br />| ${headers
			.map(() => '---')
			.join(' | ')} |<br />${processedRows
			.map((row) => `| ${row.join(' | ')} |`)
			.join('<br />')}<br />`;

		body = body.replace(inlineDatabase[0], formattedDatabase);

		inlineDatabase = body.match(DATABASE_MATCH);
	}

	return body;
}

function convertPropertyToMarkdown(
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
) {
	if (property.content === undefined) return '';

	switch (property.type) {
		case 'checkbox':
			return property.content ? 'X' : ' ';
		case 'date':
			return property.content.hour() === 0 &&
				property.content.minute() === 0
				? property.content.format('MMMM D, YYYY')
				: property.content.format('MMMM D, YYYY h:mm A');
		case 'list':
			return property.content
				.filter((content) => content)
				.map((content) =>
					convertLinksToObsidian(content, {
						idsToFileInfo,
						pathsToAttachmentInfo,
						fileInfo,
						attachmentFolderPath,
					})
				)
				.join(', ');
		case 'number':
			return String(property.content);
		case 'text':
			return convertLinksToObsidian(property.content, {
				idsToFileInfo,
				pathsToAttachmentInfo,
				fileInfo,
				attachmentFolderPath,
			});
	}
}

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
	switch (property.type) {
		case 'checkbox':
		case 'number':
		case 'date':
			content = property.content;
			break;
		case 'list':
			content = property.content.map((content) =>
				htmlToMarkdown(
					convertHtmlLinksToURLs(
						convertLinksToObsidian(content, {
							idsToFileInfo,
							pathsToAttachmentInfo,
							fileInfo,
							attachmentFolderPath,
							embedAttachments: false,
						})
					)
				)
			);
			break;
		case 'text':
			content = htmlToMarkdown(
				convertHtmlLinksToURLs(
					convertLinksToObsidian(property.content, {
						idsToFileInfo,
						pathsToAttachmentInfo,
						fileInfo,
						attachmentFolderPath,
					})
				)
			);
			break;
	}
	return {
		title: htmlToMarkdown(property.title),
		content,
	};
}

function convertHtmlLinksToURLs(content: string) {
	const links = content.match(/<a href="[^"]+"(.|\n)*?<\/a>/g);
	if (!links) return content;
	for (let link of links) {
		content = content.replace(link, extractHref(link));
	}
	return content;
}

function convertLinksToObsidian(
	body: string,
	{
		idsToFileInfo,
		pathsToAttachmentInfo,
		attachmentFolderPath,
		fileInfo,
		embedAttachments = true,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		attachmentFolderPath: string;
		fileInfo: NotionFileInfo;
		embedAttachments?: boolean;
	}
) {
	const parentFolder = getParentFolder(fileInfo.path);

	const attachmentLinks = matchAttachmentLinks(body, fileInfo.path);

	if (attachmentLinks) {
		for (let link of attachmentLinks) {
			const attachmentPath = getAttachmentPath(
				extractHref(link),
				parentFolder
			);

			const attachmentInfo = pathsToAttachmentInfo[attachmentPath];
			if (!attachmentInfo) continue;

			const obsidianLink = `${embedAttachments ? '!' : ''}[[${
				attachmentInfo.fullLinkPathNeeded && attachmentFolderPath !== ''
					? attachmentFolderPath +
					  '/' +
					  attachmentInfo.nameWithExtension +
					  '|' +
					  attachmentInfo.nameWithExtension
					: attachmentInfo.nameWithExtension
			}]]`;
			body = body.replace(
				new RegExp(escapeRegex(link), 'g'),
				obsidianLink
			);
		}
	}

	const relationLinks = matchRelationLinks(body);

	if (relationLinks) {
		for (let link of relationLinks) {
			const relationId = getNotionId(extractHref(link));
			if (!relationId) continue;
			const fileInfo = idsToFileInfo[relationId];
			if (fileInfo) {
				let obsidianLink: string = fileInfoToObsidianLink(fileInfo, {
					idsToFileInfo,
				});
				body = body.replace(
					new RegExp(escapeRegex(link)),
					obsidianLink
				);
			} else {
				const titleMatch = htmlToMarkdown(
					link.match(/>(.*?)<\/a>/)[1].replace(/<.*?\/>/g, '')
				)
					.replace(/^\s+/, '')
					.replace(/\s+$/, '');

				body = body.replace(
					new RegExp(escapeRegex(link)),
					`[[${titleMatch}]]`
				);
			}
		}
	}

	return body;
}

function fileInfoToObsidianLink(
	fileInfo: NotionFileInfo,
	{ idsToFileInfo }: { idsToFileInfo: Record<string, NotionFileInfo> }
) {
	return `[[${
		fileInfo.fullLinkPathNeeded
			? assembleParentIds(fileInfo, idsToFileInfo).join('') +
			  fileInfo.title +
			  '\\' +
			  '|' +
			  fileInfo.title
			: fileInfo.title
	}]]`;
}
