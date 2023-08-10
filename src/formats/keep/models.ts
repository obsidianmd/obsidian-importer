export interface KeepListItem {
	text: string;
	isChecked: boolean;
}

export interface KeepAttachment {
	filePath: string;
	mimetype: string;
}

export interface KeepSharee {
	isOwner: boolean;
	type: string;
	email: string;
}

export interface KeepLabel {
	name: string;
}

export interface KeepJson {
	createdTimestampUsec: number;
	userEditedTimestampUsec: number;
	//
	isArchived?: boolean;
	isPinned?: boolean;
	isTrashed?: boolean;
	//
	title?: string;
	textContent?: string;
	listContent?: KeepListItem[];
	attachments?: KeepAttachment[];
	//
	color?: string;
	labels?: KeepLabel[];
	sharees?: KeepSharee[];
}
