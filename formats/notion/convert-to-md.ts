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
	app,
}: {
	idsToFileInfo: Record<string, NotionFileInfo>;
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
	attachmentFolderPath: string;
	app: App;
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
					fileInfo,
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
			return property.content.format('YYYY-MM-DDTHH:mm');
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

function convertLinksToObsidian(
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
	const parentFolder = getParentFolder(fileInfo.path);

	const attachmentLinks = matchAttachmentLinks(body, fileInfo.path);

	if (attachmentLinks) {
		for (let link of attachmentLinks) {
			const attachmentPath = getAttachmentPath(
				extractHref(link),
				parentFolder
			);
			const attachmentInfo = pathsToAttachmentInfo[attachmentPath];
			const obsidianLink = `![[${
				attachmentInfo.fullLinkPathNeeded
					? attachmentFolderPath +
					  '/' +
					  fileInfo.title +
					  '|' +
					  fileInfo.title
					: fileInfo.title
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
			const relationId = getNotionId(
				decodeURIComponent(extractHref(link))
			);
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
