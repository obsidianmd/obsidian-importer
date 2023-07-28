import moment from 'moment';
import {
	getParentFolder,
	pathToFilename,
	stripFileExtension,
} from '../../util';
import {
	getAttachmentPath,
	getNotionId,
	matchAttachmentLinks,
} from './notion-utils';

/**
 * @param {{
 * text: string,
 * filePath: string,
 * targetPath: string
 * }} config - targetPath is missing the target folder and file extension. It will be manipulated until it reaches the final obsidian form (without Notion IDs)
 */
export const parseFileInfo = ({
	text,
	filePath,
	normalizedFilePath,
}: {
	text: string;
	filePath: string;
	normalizedFilePath: string;
}) => {
	const id = getNotionId(text.match(/<article id="(.*?)"/)[1]);
	const parentFolder = getParentFolder(filePath);
	const parentIds = getParentFolder(normalizedFilePath)
		.split('/')
		.map((parentNote) => getNotionId(parentNote))
		.filter((id) => id);

	const title = text.match(/<h1 class="page-title">(.*?)<\/h1>/)?.[1];
	const description = text.match(
		/<p class="page-description">((.|\n)*?)<\/p>/
	)?.[1];
	const rawProperties = text.match(
		/<table class="properties"><tbody>((.|\n)*?)<\/tbody><\/table>/
	)?.[1];

	const properties: ObsidianProperty[] = [];
	const attachments = new Set<string>();

	if (rawProperties) {
		const rawPropertyList = rawProperties.match(/<tr.*?<\/tr>/g);
		for (let rawProperty of rawPropertyList) {
			const property = parseProperty(rawProperty);

			if (property.notionType === 'file' && property.type === 'list') {
				for (let href of property.content) {
					const path = getAttachmentPath(href, parentFolder);
					attachments.add(path);
				}
			}

			if (property.content) properties.push(property);
		}
	}

	const body =
		text.match(
			/<div class="page-body">((.|\n)*)<\/div><\/article><\/body><\/html>/
		)?.[1] ?? '';

	const attachmentLinks = matchAttachmentLinks(body, filePath)?.map(
		(attachment) => attachment.match(/href="(.*?)"/)[1]
	);
	if (attachmentLinks) {
		for (let attachment of attachmentLinks) {
			const path = getAttachmentPath(attachment, parentFolder);
			attachments.add(path);
		}
	}

	return {
		id,
		fileInfo: {
			path: filePath,
			parentIds,
			body,
			title,
			properties,
			description,
			htmlToMarkdown: false,
			fullLinkPathNeeded: false,
		},
		attachments,
	};
};

// just map file paths to link text, then transfer.
const parseProperty = (property: string) => {
	const notionType = property.match(
		/<tr class="property-row property-row-(.*?)"/
	)?.[1] as NotionPropertyType;
	if (!notionType)
		throw new Error('property type not found for: ' + property);

	const title = property.match(/<th>.*<\/span>(.*?)<\/th>/)?.[1];

	let content;
	const htmlContent = property.match(/<td>(.*?)<\/td>/)?.[1];

	const typesMap: Record<ObsidianProperty['type'], NotionPropertyType[]> = {
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

	const obsidianType = Object.entries(typesMap).find(([_, notionTypes]) =>
		notionTypes.includes(notionType)
	)?.[0] as ObsidianProperty['type'];

	if (!obsidianType) throw new Error('type not found for: ' + htmlContent);

	switch (notionType) {
		case 'checkbox':
			content = /checkbox-on/.test(htmlContent);
			break;
		case 'created_time':
		case 'last_edited_time':
		case 'date':
			const dateContent = htmlContent.match(/<time>@(.*)<\/time>/)?.[1];
			if (!dateContent) {
				content = undefined;
			} else content = moment(dateContent);
			break;
		case 'email':
		case 'phone_number':
			content = htmlContent.match(/<a.*?>(.*?)<\/a>/)?.[1];
			break;
		case 'created_by':
		case 'last_edited_by':
		case 'person':
			content = htmlContent.match(
				/class="icon user-icon"\/>(.*)<\/span>/
			)?.[1];
			break;
		case 'select':
			content = htmlContent.match(/<span.*?>(.*?)<\/span>/)?.[1];
			break;
		case 'status':
			content = htmlContent.match(
				/<span.*?><div class="status-dot.*?<\/div>(.*?)<\/span>/
			)?.[1];
			break;
		case 'url':
		case 'text':
		case 'formula':
		case 'rollup':
			content = htmlContent;
			break;
		case 'file':
		case 'relation':
			const linkList = htmlContent.match(/<a href=".*?<\/a>/g);
			content = linkList.flat();
			break;
		case 'multi_select':
			const allSelects = htmlContent.match(/<span.*?>.*?<\/span>/g);
			content = allSelects?.map(
				(selectHtml) => selectHtml.match(/<span.*?>(.*?)<\/span>/)?.[1]
			);
			break;
		case 'number':
		case 'auto_increment_id':
			content = Number(htmlContent);
			break;
	}

	const parsedProperty = {
		title,
		type: obsidianType,
		notionType,
		content,
	} as ObsidianProperty;

	return parsedProperty;
};
