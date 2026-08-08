export interface EvernoteNoteAttributes {
	latitude?: string | number;
	longitude?: string | number;
	source?: string;
	'source-url'?: string;
	'source-application'?: string;
	'reminder-time'?: string;
	'reminder-order'?: string;
	'reminder-done-time'?: string;
}

export interface EvernoteResourceAttributes {
	'file-name'?: string;
	timestamp?: string;
}

export interface EvernoteResource {
	data?: { $text?: string };
	mime?: string;
	recognition?: string;
	'resource-attributes'?: EvernoteResourceAttributes;
}

export interface EvernoteNote {
	title?: string;
	content?: string | string[];
	created?: string;
	updated?: string;
	tag?: string | string[];
	resource?: EvernoteResource | EvernoteResource[];
	'note-attributes'?: EvernoteNoteAttributes;
}

export function joinNoteContent(content: EvernoteNote['content']): string {
	if (Array.isArray(content)) return content.join('');
	return content ?? '';
}
