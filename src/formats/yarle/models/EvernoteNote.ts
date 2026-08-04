/**
 * A single <note> as xml-flow hands it back from an .enex export.
 *
 * Everything is optional because an .enex is only as complete as the export
 * that produced it, and xml-flow omits absent elements rather than emptying
 * them. A field that appears once is a value; one that appears several times
 * is an array, which is why tag and resource are widened.
 */
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

/** One <resource>: an attachment carried inline as base64. */
export interface EvernoteResource {
	/** xml-flow puts element text on $text */
	data?: { $text?: string };
	mime?: string;
	/** OCR text, when Evernote produced any. Searched for the resource hash. */
	recognition?: string;
	'resource-attributes'?: EvernoteResourceAttributes;
}

export interface EvernoteNote {
	title?: string;
	/** Joined by the caller when xml-flow splits it across several chunks */
	content?: string | string[];
	created?: string;
	updated?: string;
	tag?: string | string[];
	/** One resource, or several, or none - see joinNoteContent for the pattern */
	resource?: EvernoteResource | EvernoteResource[];
	'note-attributes'?: EvernoteNoteAttributes;
}

/**
 * The note body as one string.
 *
 * xml-flow hands back an array when it splits the content across chunks, and
 * omits it entirely when the note has none.
 */
export function joinNoteContent(content: EvernoteNote['content']): string {
	if (Array.isArray(content)) return content.join('');
	return content ?? '';
}
