/**
 * What a OneNote section turns into: a tree the markdown writer can walk
 * without knowing anything about revision stores.
 *
 * This is the seam. Everything above it is binary format; everything below it
 * is text, and takes no vault, no network and no settings it was not handed.
 */

export interface TextRun {
	text: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	superscript?: boolean;
	subscript?: boolean;
	hyperlinkUrl?: string;
	/** OneNote marked this run as an equation rather than prose. */
	math?: boolean;
	/** The colour behind the text as `#rrggbb`, when OneNote recorded one. */
	highlight?: string;
}

/**
 * A OneNote tag: the checkbox, star or flag put beside a paragraph.
 *
 * A checkable tag is a to-do; anything else carries a label, which is written
 * in the language the notebook's author used.
 */
export interface Tag {
	label?: string;
	checkable: boolean;
	completed: boolean;
	/** The icon OneNote drew, as the NoteTagShape value in MS-ONE 2.3.86. */
	shape?: number;
}

export interface ListInfo {
	/** Indent depth, counted from zero at the outline's top level. */
	level: number;
	ordered: boolean;
	/** The bullet or number glyph OneNote recorded, when it named one. */
	format?: string;
}

export interface Paragraph {
	kind: 'paragraph';
	runs: TextRun[];
	children: Element[];
	list?: ListInfo;
	styleId?: string;
	tags?: Tag[];
}

export interface Outline {
	kind: 'outline';
	children: Element[];
	list?: ListInfo;
}

export interface TableCell {
	children: Element[];
}

export interface TableRow {
	cells: TableCell[];
}

export interface Table {
	kind: 'table';
	rows: TableRow[];
}

export interface Image {
	kind: 'image';
	fileName?: string;
	altText?: string;
	extension?: string;
	data?: Uint8Array;
}

export interface EmbeddedFile {
	kind: 'embedded-file';
	fileName?: string;
	sourcePath?: string;
	extension?: string;
	data?: Uint8Array;
}

export interface InkStroke {
	/** Points in half-inch units, ready to be drawn without further scaling. */
	points: { x: number, y: number }[];
	color: string;
	width: number;
	opacity: number;
	/** What OneNote's handwriting recognizer read this stroke as, if anything. */
	recognizedText?: string;
}

export interface Ink {
	kind: 'ink';
	strokes: InkStroke[];
	/** Every recognized word under this drawing, in the order they were written. */
	recognizedText?: string;
}

export type Element = Paragraph | Outline | Table | Image | EmbeddedFile | Ink;

export interface Page {
	/**
	 * The page's object-space identity, stable across exports of the same
	 * notebook. It is what lets a second import update a note rather than
	 * write a copy beside it.
	 */
	id: string;
	title: string;
	/** Sub-page depth: 0 for a top-level page, 1 for its first subpage. */
	level: number;
	createdUtc?: Date;
	lastModifiedUtc?: Date;
	isConflictPage: boolean;
	isDeleted: boolean;
	outlines: Outline[];
	directContent: Element[];
}

export interface Section {
	name: string;
	colorArgb?: number;
	pages: Page[];
}
