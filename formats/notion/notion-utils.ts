import { escapeRegex, pathToFilename } from '../../util';

export const isNotionId = (id: string) =>
	/ ?[a-z0-9]{32}(\.(md|csv))?$/.test(id);

export const stripNotionId = (id: string) => {
	return id.replace(/ ?[a-z0-9]{32}(\.(md|csv))?$/, '');
};

export const getNotionId = (id: string) => {
	return id.replace(/-/g, '').match(/([a-z0-9]{32})(\?|\.|$)/)?.[1];
};

export const matchAttachmentLinks = (body: string, filePath: string) => {
	const thisFileHref = encodeURIComponent(pathToFilename(filePath));
	return body.match(
		new RegExp(
			`<a href="${escapeRegex(
				thisFileHref
			)}\\/((?!html)[^"])+"(.|\n)*?<\\/a>`,
			'g'
		)
	);
};

export const matchRelationLinks = (body: string) => {
	const relations = body.match(
		/<a href="[^"]+(%20| )[a-z0-9]{32}\.html"(.|\n)*?<\/a>/g
	);
	const links = body.match(
		/<a href="https:\/\/www.notion.so\/[^"]+-[a-z0-9]{32}(\?pvs=\d+)?"(.|\n)*?<\/a>/g
	);
	return relations && links ? relations.concat(links) : relations ?? links;
};

export const extractHref = (a: string) => {
	return decodeURI(a.match(/href="(.*?)"/)?.[1]);
};

export const getAttachmentPath = (
	decodedHref: string,
	parentFolder: string
): string => {
	const path = parentFolder + '/' + decodedHref;
	return path;
};

export const assembleParentIds = (
	fileInfo: NotionFileInfo,
	idsToFileInfo: Record<string, NotionFileInfo>
) => {
	const pathNames = fileInfo.path.split('/');
	return (
		fileInfo.parentIds
			.map(
				(parentId) =>
					idsToFileInfo[parentId]?.title ??
					pathNames
						.find((pathSegment) => pathSegment.contains(parentId))
						?.replace(` ${parentId}`, '')
			)
			// Notion inline databases have no .html file and aren't a note, so we just filter them out of the folder structure.
			// .filter((parentId) => parentId)
			.map((folder) => folder + '/')
	);
};
