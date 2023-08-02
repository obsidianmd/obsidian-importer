import { escapeRegex, matchFilename, pathToFilename } from '../../util';

export const isNotionId = (id: string) =>
	/ ?[a-z0-9]{32}(\.(md|csv))?$/.test(id);

export const stripNotionId = (id: string) => {
	return id.replace(/-/g, '').replace(/[ -]?[a-z0-9]{32}(\.|$)/, '$1');
};

export const getNotionId = (id: string) => {
	return id.replace(/-/g, '').match(/([a-z0-9]{32})(\?|\.|$)/)?.[1];
};

export const assembleParentIds = (
	fileInfo: NotionFileInfo | NotionAttachmentInfo,
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

export function parseDate(content: moment.Moment) {
	if (content.hour() === 0 && content.minute() === 0) {
		return content.format('YYYY-MM-DD');
	} else {
		return content.format('YYYY-MM-DDTHH:mm');
	}
}
