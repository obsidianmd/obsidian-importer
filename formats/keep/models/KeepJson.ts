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
	listContent?: Array<KeepListItem>;
	attachments?: Array<KeepAttachment>;
    //
	color?: string;
	labels?: Array<KeepLabel>;
	sharees?: Array<KeepSharee>;
}

/**
 * Accepts a string and attempts to parse it into a valid Google Keep JSON
 */
export function convertStringToKeepJson(rawContent: string): KeepJson | null {
	const keepJson = JSON.parse(rawContent);

	// Check file matches expected mandatory items in Keep interface
	if(typeof keepJson.userEditedTimestampUsec === 'undefined') return null;
	if(typeof keepJson.createdTimestampUsec === 'undefined') return null;

	return keepJson;
}
