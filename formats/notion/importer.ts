import moment from 'moment';
import {
	getParentFolder,
	pathToFilename,
	stripFileExtension,
} from '../../util';
import { getNotionId } from './utils/notion-ids';

/**
 * @param {{
 * text: string,
 * filePath: string,
 * targetPath: string
 * }} config - targetPath is missing the target folder and file extension. It will be manipulated until it reaches the final obsidian form (without Notion IDs)
 */
export const processFile = ({
	text,
	filePath,
	normalizedFilePath,
}: {
	text: string;
	filePath: string;
	normalizedFilePath: string;
}) => {
	const id = text.match(/<article id="(.*?)"/)?.[1];
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
	const attachments: Record<string, NotionAttachmentInfo> = {};

	if (rawProperties) {
		const rawPropertyList = rawProperties.match(/<tr.*?<\/tr>/g);
		for (let rawProperty of rawPropertyList) {
			const property = parseProperty(rawProperty);

			if (property.notionType === 'file' && property.type === 'list') {
				for (let href of property.content) {
					attachments[href] = parseAttachmentInfo(href, parentFolder);
				}
			}

			if (property.content) properties.push(property);
		}
	}

	const body =
		text.match(
			/<div class="page-body">((.|\n)*)<\/div><\/article><\/body><\/html>/
		)?.[1] ?? '';

	console.log(
		`${encodeURIComponent(stripFileExtension(pathToFilename(filePath)))}`
	);

	const thisFileHref = encodeURIComponent(
		stripFileExtension(pathToFilename(filePath))
	);
	const attachmentLinks = body
		.match(new RegExp(`<a href="${thisFileHref}\\/.*?"`, 'g'))
		?.map((attachment) => attachment.match(/"(.*?)"/)[0]);
	for (let attachment of attachmentLinks) {
		attachments[attachment] = parseAttachmentInfo(attachment, parentFolder);
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

const parseAttachmentInfo = (
	href: string,
	parentFolder: string
): NotionAttachmentInfo => {
	const linkText = stripFileExtension(decodeURI(href));
	const path = parentFolder + '/' + linkText;
	return { linkText, path };
};

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
			const fileList = htmlContent.match(/<a href=".*?"/g);
			content = fileList?.map((linkHtml) => {
				const linkHref = linkHtml.match(/<a href="(.*?)"/)[1];
				return linkHref;
			});
			break;
		case 'relation':
			const relationList = htmlContent.match(/<a href=".*?"/g);
			content = relationList?.map((linkHtml) => {
				const linkHref = linkHtml.match(/<a href="(.*?)"/)[1];
				const linkText = stripFileExtension(decodeURI(linkHref));
				return getNotionId(linkText);
			});
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
