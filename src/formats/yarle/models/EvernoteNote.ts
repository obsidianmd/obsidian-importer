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

export interface EvernoteNote {
	title?: string;
	/** Joined by the caller when xml-flow splits it across several chunks */
	content?: string | string[];
	created?: string;
	updated?: string;
	tag?: string | string[];
	// Resource contents vary by attachment type and are read through helpers
	// that predate this interface.
	resource?: any;
	'note-attributes'?: EvernoteNoteAttributes;
}
