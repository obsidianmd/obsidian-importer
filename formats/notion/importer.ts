import moment from 'moment';

export const processFile = ({
	text,
	filePath,
	destinationPath,
}: {
	text: string;
	filePath: string;
	destinationPath: string;
}): [string, NotionFileInfo] => {
	const id = text.match(/<article id="(.*?)"/)?.[1];
	const title = text.match(/<h1 class="page-title">(.*?)<\/h1>/)?.[1];
	const description = text.match(
		/<p class="page-description">((.|\n)*?)<\/p>/
	)?.[1];
	const rawProperties = text.match(
		/<table class="properties"><tbody>((.|\n)*?)<\/tbody><\/table>/
	)?.[1];

	let properties: ObsidianProperty[] | undefined;
	if (rawProperties) {
		const propertyList = rawProperties.match(/<tr.*?<\/tr>/g);
		if (propertyList?.length > 0) {
			properties = propertyList
				.map((property) => parseProperty(property))
				.filter((property) => property.content);
			if (properties.length === 0) properties = undefined;
		}
	}

	const body =
		text.match(
			/<div class="page-body">((.|\n)*)<\/div><\/article><\/body><\/html>/
		)?.[1] ?? '';

	return [
		id,
		{
			path: filePath,
			destinationPath,
			body,
			title,
			properties,
			description,
			htmlToMarkdown: false,
		},
	];
};

const parseProperty = (property: string): ObsidianProperty => {
	const type = property.match(
		/<tr class="property-row property-row-(.*?)"/
	)?.[1] as NotionPropertyType;
	if (!type) throw new Error('property type not found for: ' + property);

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
		notionTypes.includes(type)
	)?.[0] as ObsidianProperty['type'];

	if (!obsidianType) throw new Error('type not found for: ' + htmlContent);

	switch (type) {
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
			const allFiles = htmlContent.match(/<a href=".*"/g);
			content = allFiles?.map((fileHtml) =>
				decodeURI(fileHtml.match(/<a href="(.*)"/)[1])
			);
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
		content,
	} as ObsidianProperty;

	return parsedProperty;
};
