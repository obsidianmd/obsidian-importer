import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import {
	getFileExtension,
	getParentFolder,
	matchFilename,
	sanitizeFileName,
} from '../../util';
import { getNotionId } from './notion-utils';
import { htmlToMarkdown } from 'obsidian';
import { PickedFile } from 'filesystem';
import { BlobWriter, Entry, TextWriter } from '@zip.js/zip.js';

export async function parseFiles(
	files: PickedFile[],
	{
		idsToFileInfo,
		pathsToAttachmentInfo,
		results,
	}: {
		idsToFileInfo: Record<string, NotionFileInfo>;
		pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
		results: ImportResult;
	}
) {
	const parser = new DOMParser();

	for (let zip of files) {
		await zip.readZip(async (zip) => {
			const entries = await zip.getEntries();

			for (let file of entries.filter((file) =>
				file.filename.endsWith('.html')
			)) {
				console.log('getting text', file.filename);

				// Stuck on this line which throws a failed GET request to app://obsidian.md/undefined
				const text = await file.getData(new TextWriter('utf-8'));

				console.log('got text', text);

				const { id, fileInfo } = parseFileInfo({
					text,
					file,
					parser,
				});

				for (let link of fileInfo.notionLinks) {
					if (
						link.type !== 'attachment' ||
						pathsToAttachmentInfo[link.path]
					)
						continue;
					const basicFileName = matchFilename(link.path);
					const attachmentInfo: NotionAttachmentInfo = {
						nameWithExtension: sanitizeFileName(
							`${basicFileName || 'Untitled'}.${getFileExtension(
								link.path
							)}`
						),
						parentFolderPath: '',
						fullLinkPathNeeded: false,
						parentIds: fileInfo.parentIds,
						path: link.path,
					};
					pathsToAttachmentInfo[link.path] = attachmentInfo;
				}

				idsToFileInfo[id] = fileInfo;
			}
		});
	}
}

const parseFileInfo = ({
	text,
	file,
	parser,
}: {
	text: string;
	file: Entry;
	parser: DOMParser;
}) => {
	const filePath = file.filename;

	console.log(text, file.filename);

	const parentIds = getParentFolder(file.filename)
		.split('/')
		.map((parentNote) => getNotionId(parentNote))
		.filter((id) => id);

	const document = parser.parseFromString(text, 'text/html');
	const id = getNotionId(
		document.querySelector('article').getAttribute('id')
	);
	if (!id) throw new Error('no id found for: ' + file.filename);
	const parsedTitle =
		document.querySelector('title').textContent || 'Untitled';

	let title = sanitizeFileName(
		parsedTitle
			.replace(/\n/g, ' ')
			.replace(/:/g, '-')
			.replace(/#/g, '')
			.replace(/\n/g, ' ')
			.replace(/^\s+/, '')
			.replace(/\s+$/, '')
	);

	// just in case title names are too long
	while (title.length > 100) {
		const wordList = title.split(' ');
		title = wordList.slice(0, wordList.length - 1).join(' ') + '...';
	}

	const description = document.querySelector(
		`p[class*=page-description]`
	).innerHTML;
	const rawProperties = document
		.querySelector(`table[class=properties]`)
		?.querySelector('tbody').children;

	const properties: NotionProperty[] = [];

	if (rawProperties) {
		for (let i = 0; i < rawProperties.length; i++) {
			const row = rawProperties.item(i) as HTMLTableRowElement;
			const property = getProperty(row, filePath);
			if (property.body.textContent) properties.push(property);
		}
	}

	const body = document.querySelector(
		`div[class=page-body]`
	) as HTMLDivElement;

	const notionLinks = getNotionLinks(body, filePath);
	const fileInfo: NotionFileInfo = {
		path: filePath,
		parentIds,
		body,
		title,
		properties,
		description,
		fullLinkPathNeeded: false,
		notionLinks,
	};

	return {
		id,
		fileInfo,
	};
};

const getProperty = (property: HTMLTableRowElement, filePath: string) => {
	const notionType = property.className.match(
		/property-row-(.*)/
	)?.[1] as NotionPropertyType;
	if (!notionType)
		throw new Error('property type not found for: ' + property);

	const title = property.cells[0].textContent;

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

	let obsidianType = Object.keys(typesMap).find(
		(type: keyof typeof typesMap) => typesMap[type].includes(notionType)
	) as NotionProperty['type'];

	if (!obsidianType) throw new Error('type not found for: ' + body);

	const parsedProperty: NotionProperty = {
		title,
		type: obsidianType,
		notionType,
		body,
		links: getNotionLinks(body, filePath),
	};

	return parsedProperty;
};

export const getNotionLinks = (body: HTMLElement, filePath: string) => {
	const thisFileHref = matchFilename(filePath);
	const links: NotionLink[] = [];
	const parentFolder = getParentFolder(filePath);

	body.querySelectorAll('a').forEach((a) => {
		const decodedURI = decodeURI(a.getAttribute('href'));
		const id = getNotionId(decodedURI);
		if (
			decodedURI.includes(thisFileHref) &&
			!decodedURI.endsWith('.html')
		) {
			links.push({
				type: 'attachment',
				a,
				path: parentFolder + decodedURI,
			});
		} else if (id && decodedURI.endsWith('.html')) {
			links.push({ type: 'relation', a, id });
		}
	});

	console.log('links', links);

	return links;
};