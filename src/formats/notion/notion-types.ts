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
		return fileInfo.parentIds
			.map((parentId) =>
				idsToFileInfo[parentId]?.title ??
				pathNames.find((pathSegment) => pathSegment.contains(parentId))?.replace(` ${parentId}`, '')
			)
			// Notion inline databases have no .html file and aren't a note, so we just filter them out of the folder structure.
			.filter((parentId) => parentId)
			// Folder names can't end in a dot or a space
			.map((folder) => folder.replace(/[\. ]+$/, ''))
			.join('/') + '/';
	}
}
