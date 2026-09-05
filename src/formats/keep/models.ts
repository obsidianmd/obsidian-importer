export interface KeepListItem {
	text?: string;
	textHtml?: string;
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

export interface KeepTask {
	id: string;
}

export interface KeepAnnotation {
	description?: string;
	source?: string;
	title?: string;
	url?: string;
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
	textContentHtml?: string;
	listContent?: KeepListItem[];
	attachments?: KeepAttachment[];
	//
	color?: string;
	labels?: KeepLabel[];
	sharees?: KeepSharee[];
	tasks?: KeepTask[];
	annotations?: KeepAnnotation[];
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function hasValidKeepTimestamps(value: unknown): value is KeepJson {
	if (typeof value !== 'object' || value === null) return false;

	const note = value as Partial<KeepJson>;
	return isFiniteNumber(note.createdTimestampUsec)
		&& note.createdTimestampUsec > 0
		&& isFiniteNumber(note.userEditedTimestampUsec)
		&& note.userEditedTimestampUsec >= 0;
}
