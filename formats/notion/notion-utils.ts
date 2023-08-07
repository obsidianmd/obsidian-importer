import { parseFilePath } from 'filesystem';

export const isNotionId = (id: string) =>
	/ ?[a-z0-9]{32}(\.(md|csv))?$/.test(id);

export const stripNotionId = (id: string) => {
	return id.replace(/-/g, '').replace(/[ -]?[a-z0-9]{32}(\.|$)/, '$1');
};

// Notion UUIDs come at the end of filenames/URL paths and are always 32 characters long.
export const getNotionId = (id: string) => {
	return id.replace(/-/g, '').match(/([a-z0-9]{32})(\?|\.|$)/)?.[1];
};

export const parseParentIds = (filename: string) => {
	const { parent } = parseFilePath(filename);
	return parent
		.split('/')
		.map((parentNote) => getNotionId(parentNote))
		.filter((id) => id) as string[];
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

export function parseAttachmentFolderPath(attachmentFolderPath: string) {
	const attachmentsInCurrentFolder = /^\.\//.test(attachmentFolderPath);
	// Obsidian formatting for attachments in subfolders is ./<folder>
	const attachmentSubfolder = attachmentFolderPath.match(/\.\/(.*)/)?.[1];
	return { attachmentsInCurrentFolder, attachmentSubfolder };
}

export function stripParentDirectories(relativeURI: string) {
	return relativeURI.replace(/^(\.\.\/)+/, '');
}
