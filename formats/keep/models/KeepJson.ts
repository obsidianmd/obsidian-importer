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
export function convertStringToKeepJson(rawContent: string): KeepJson {
	const keepJson = JSON.parse(rawContent);

	// Is this this right place to check if the parsed json matches the minimum viable as a Google Keep Json
	// typeof fileContents.userEditedTimestampUsec !== 'undefined'		&&
	// typeof fileContents.createdTimestampUsec !== 'undefined';

	return keepJson;
}
