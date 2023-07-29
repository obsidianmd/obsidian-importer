import { App, htmlToMarkdown } from 'obsidian';
import { escapeRegex, getParentFolder } from '../../util';
import { getNotionId } from './notion-utils';
import {
	extractHref,
	matchAttachmentLinks,
	getAttachmentPath,
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
	for (let [id, fileInfo] of Object.entries(idsToFileInfo)) {
		fileInfo.body = convertInlineDatabasesToObsidian(fileInfo.body, {
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
			fileInfo,
		});

		fileInfo.body = convertLinksToObsidian(fileInfo.body, {
			idsToFileInfo,
			pathsToAttachmentInfo,
			attachmentFolderPath,
			fileInfo,
		});

		fileInfo.body = htmlToMarkdown(fileInfo.body);

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

function convertInlineDatabasesToObsidian(
	body: string,
	{
		idsToFileInfo,
		pathsToAttachmentInfo,
		attachmentFolderPath,
		fileInfo,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		attachmentFolderPath: string;
		fileInfo: NotionFileInfo;
	}
) {
	const DATABASE_MATCH =
		/<table class="collection-content"><thead>(.*?)<\/thead><tbody>(.*?)<\/tbody><\/table>/;
	let inlineDatabase = body.match(DATABASE_MATCH);
	while (inlineDatabase) {
		const rawDatabaseHeaders = inlineDatabase[1].match(/<th>.*?<\/th>/g);
		const headers = rawDatabaseHeaders.map((header) => {
			return header.match(/<\/span>(.*?)<\/th>/)[1];
		});
		const childRows = inlineDatabase[2].match(/<tr id=".*?">(.*?)<\/tr>/g);
		const childIds = childRows.map((row) =>
			getNotionId(row.match(/<tr id="(.*?)"/)[1])
		);

		const processedRows = childIds.map((childId) => {
			const childFileInfo = idsToFileInfo[childId];
			const processedRow: string[] = headers.map((propertyName, i) => {
				const isTitle = i === 0;
				if (isTitle) {
					return fileInfoToObsidianLink(childFileInfo, {
						idsToFileInfo,
					});
				}
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
	switch (property.type) {
		case 'checkbox':
			return property.content ? 'X' : ' ';
		case 'date':
			return property.content.format('YYYY-MM-DD HH:mm');
		case 'list':
			return property.content
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
			content = property.content;
			break;
		case 'date':
			content =
				property.content.hour() === 0 && property.content.minute() === 0
					? property.content.format('YYYY-MM-DD')
					: property.content.format('YYYY-MM-DDTHH:mm');
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
	const links = content.match(/<a href="[^"]+".*?<\/a>/);
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
			const fileInfo = idsToFileInfo[relationId];
			let obsidianLink: string = fileInfoToObsidianLink(fileInfo, {
				idsToFileInfo,
			});
			body = body.replace(
				new RegExp(escapeRegex(link), 'g'),
				obsidianLink
			);
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
			? fileInfo.parentIds
					.map((parentId) => idsToFileInfo[parentId].title)
					.join('/') +
			  fileInfo.title +
			  '|' +
			  fileInfo.title
			: fileInfo.title
	}]]`;
}
