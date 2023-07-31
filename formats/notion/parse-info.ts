import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import moment from 'moment';
import { getParentFolder, sanitizeFileName } from '../../util';
import {
	extractHref,
	getAttachmentPath,
	getNotionId,
	matchAttachmentLinks,
} from './notion-utils';

export async function parseFiles(
	filePaths: string[],
	{
		idsToFileInfo,
		pathsToAttachmentInfo,
		results,
		folderPathsReplacement,
		readPath,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		results: ImportResult;
		folderPathsReplacement: RegExp;
		readPath: FormatImporter['readPath'];
	}
) {
	await Promise.all(
		filePaths.map(
			(filePath) =>
				new Promise(async (resolve) => {
					try {
						const normalizedFilePath = filePath.replace(
							folderPathsReplacement,
							''
						);

						const text = await readPath(filePath);
						const { id, fileInfo, attachments } = parseFileInfo({
							text,
							filePath,
							normalizedFilePath,
						});

						for (let path of attachments)
							pathsToAttachmentInfo[path] = {
								nameWithExtension: sanitizeFileName(
									path.slice(path.lastIndexOf('/') + 1)
								),
								fullLinkPathNeeded: false,
							};

						idsToFileInfo[id] = fileInfo;
						resolve(true);
					} catch (e) {
						console.error(e);
						results.failed.push(filePath);
						resolve(false);
					}
				})
		)
	);
}

const parseFileInfo = ({
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

	const parsedTitle =
		text.match(/<title>((.|\n)*?)<\/title>/)?.[1] || 'Untitled';
	if (!parsedTitle) {
		throw new Error('no title for ' + normalizedFilePath);
	}
	const title = sanitizeFileName(parsedTitle.replace(/\n/g, ''))
		.replace(/^\s+/, '')
		.replace(/\s+$/, '');

	const description = text.match(
		/<p class="page-description">((.|\n)*?)<\/p>/
	)?.[1];
	const rawProperties = text.match(
		/<table class="properties"><tbody>((.|\n)*?)<\/tbody><\/table>/
	)?.[1];

	const properties: ObsidianProperty[] = [];
	const attachments = new Set<string>();

	if (rawProperties) {
		const rawPropertyList = rawProperties.match(/<tr(.|\n)*?<\/tr>/g);
		for (let rawProperty of rawPropertyList) {
			const property = parseProperty(rawProperty);

			if (property.notionType === 'file' && property.type === 'list') {
				for (let link of property.content) {
					const path = getAttachmentPath(
						extractHref(link),
						parentFolder
					);
					attachments.add(path);
				}
			}

			switch (property.type) {
				case 'checkbox':
					properties.push(property);
					break;
				case 'list':
					if (property.content && property.content.length > 0)
						properties.push(property);
					break;
				case 'number':
					if (property.content !== undefined)
						properties.push(property);
					break;
				case 'text':
				case 'date':
					if (property.content) properties.push(property);
			}

			properties.push(property);
		}
	}

	const body =
		text.match(
			/<div class="page-body">((.|\n)*)<\/div><\/article><\/body><\/html>/
		)?.[1] ?? '';

	const attachmentLinks = matchAttachmentLinks(body, filePath);
	if (attachmentLinks) {
		for (let attachment of attachmentLinks) {
			const path = getAttachmentPath(
				extractHref(attachment),
				parentFolder
			);
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

const parseProperty = (property: string) => {
	const notionType = property.match(
		/<tr class="property-row property-row-(.*?)"/
	)?.[1] as NotionPropertyType;
	if (!notionType)
		throw new Error('property type not found for: ' + property);

	const title = property.match(/<th>(.|\n)*?<\/span>((.|\n)*?)<\/th>/)?.[2];

	let content;
	const htmlContent = property.match(/<td>((.|\n)*?)<\/td>/)?.[1];

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
			content = htmlContent
				.match(/<a.*?>(.*?)<\/a>/)?.[1]
				?.replace(/\n/g, ' ');
			break;
		case 'created_by':
		case 'last_edited_by':
		case 'person':
			content = htmlContent.match(
				/class="icon user-icon"\/>((.|\n)*?)<\/span>/
			)?.[1];
			break;
		case 'select':
			content = htmlContent.match(/<span.*?>((.|\n)*?)<\/span>/)?.[1];
			break;
		case 'status':
			content = htmlContent.match(
				/<span.*?><div class="status-dot.*?<\/div>((.|\n)*?)<\/span>/
			)?.[1];
			break;
		case 'url':
			content = htmlContent.replace(/\n/g, ' ');
			break;
		case 'text':
		case 'formula':
		case 'rollup':
			content = htmlContent;
			break;
		case 'file':
		case 'relation':
			const linkList = htmlContent.match(/<a href="(.|\n)*?<\/a>/g);
			content = linkList.flat().map((link) => link.replace(/\n/g, ' '));
			break;
		case 'multi_select':
			const allSelects = htmlContent.match(/<span.*?>(.|\n)*?<\/span>/g);
			content = allSelects?.map(
				(selectHtml) =>
					selectHtml.match(/<span.*?>((.|\n)*?)<\/span>/)?.[1]
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
