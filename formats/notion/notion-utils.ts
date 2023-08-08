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
			.filter((parentId) => parentId)
			// Folder names can't end in a dot or a space
			.map((folder) => folder.replace(/[\. ]+$/, '') + '/')
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
('');
export function escapeHashtags(body: string) {
	const tagExp = /#[a-z0-9\-]+/gi;

	if (!tagExp.test(body)) return body;
	const lines = body.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const hashtags = lines[i].match(tagExp);
		if (!hashtags) continue;
		let newLine = lines[i];
		for (let hashtag of hashtags) {
			// skipping any internal links [[ # ]], URLS [ # ]() or []( # ), or already escaped hashtags \#, replace all tag-like things #<word> in the document with \#<word>. Useful for programs (like Notion) that don't support #<word> tags.
			const hashtagInLink = new RegExp(
				`\\[\\[[^\\]]*${hashtag}[^\\]]*\\]\\]|\\[[^\\]]*${hashtag}[^\\]]*\\]\\([^\\)]*\\)|\\[[^\\]]*\\]\\([^\\)]*${hashtag}[^\\)]*\\)|\\\\${hashtag}`
			);

			if (hashtagInLink.test(newLine)) continue;
			newLine = newLine.replace(hashtag, '\\' + hashtag);
		}
		lines[i] = newLine;
	}
	body = lines.join('\n');
	return body;
}
