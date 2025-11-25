import { parseFilePath } from '../../filesystem';

export type NotionPropertyType =
	| 'text'
	| 'number'
	| 'select'
	| 'multi_select'
	| 'status'
	| 'date'
	| 'person'
	| 'file'
	| 'checkbox'
	| 'url'
	| 'email'
	| 'phone_number'
	| 'formula'
	| 'relation'
	| 'rollup'
	| 'created_time'
	| 'created_by'
	| 'last_edited_time'
	| 'last_edited_by'
	| 'auto_increment_id';

export type NotionProperty = {
	type: 'text' | 'date' | 'number' | 'list' | 'checkbox';
	title: string;
	notionType: NotionPropertyType;
	links: NotionLink[];
	body: HTMLTableCellElement;
};

export type YamlProperty = {
	content: string | number | string[] | boolean;
	title: string;
};

export type FormatTagName = 'strong' | 'em' | 'mark' | 'del' | string;

export type NotionLink =
	{
		type: 'relation';
		id: string;
		a: HTMLAnchorElement;
	}
	|
	{
		type: 'attachment';
		path: string;
		a: HTMLAnchorElement;
	}
	|
	{
		type: 'toc-item';
		id: string;
		a: HTMLAnchorElement;
	};


export interface NotionFileInfo {
	title: string;
	parentIds: string[];
	path: string;
	fullLinkPathNeeded: boolean;
	ctime: Date | null;
	mtime: Date | null;
}

export interface NotionAttachmentInfo {
	path: string;
	parentIds: string[];
	nameWithExtension: string;
	targetParentFolder: string;
	fullLinkPathNeeded: boolean;
}

export class NotionResolverInfo {
	idsToFileInfo: Record<string, NotionFileInfo> = {};
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo> = {};
	attachmentPath: string;
	singleLineBreaks: boolean;

	constructor(attachmentPath: string, singleLineBreaks: boolean) {
		this.attachmentPath = attachmentPath;
		this.singleLineBreaks = singleLineBreaks;
	}

	getPathForFile(fileInfo: NotionFileInfo | NotionAttachmentInfo) {
		let { idsToFileInfo } = this;
		const pathNames = fileInfo.path.split('/');

		// If we have parentIds, use them to build the path
		if (fileInfo.parentIds.length > 0) {
			const mappedPathParts = fileInfo.parentIds
				.map(
					(parentId) =>
						idsToFileInfo[parentId]?.title ??
						pathNames.find((pathSegment) => pathSegment.contains(parentId))?.replace(` ${parentId}`, '')
				)
				// Notion inline databases have no .html file and aren't a note, so we just filter them out of the folder structure.
				.filter((parentId) => parentId)
				// Folder names can't end in a dot or a space
				.map((folder) => folder.replace(/[\. ]+$/, ''));

			// In newer Notion exports, all files have one parent ID, but it does not
			// map to anything in our idsToFileInfo.
			if (mappedPathParts.length > 0) {
				return mappedPathParts.join('/') + '/';
			}
		}

		// If no parentIds, use the original folder structure from the file path
		// Extract parent path and remove IDs from folder names
		const { parent } = parseFilePath(fileInfo.path);
		if (!parent) {
			return '';
		}

		const pathSegments = parent.split('/').filter((seg) => seg.length > 0);
		const folderPath = pathSegments
			.map((segment) => {
				// Remove ID from folder name if present (format: "FolderName <id>")
				return segment.replace(/\s+[a-z0-9]{32}$/, '').trim();
			})
			.filter((seg) => seg.length > 0)
			// Folder names can't end in a dot or a space
			.map((folder) => folder.replace(/[\. ]+$/, ''))
			.join('/');

		return folderPath ? folderPath + '/' : '';
	}
}
