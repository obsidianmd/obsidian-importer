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
	bordersVisible: boolean;
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

export type Element = Paragraph | Outline | Table | Image | EmbeddedFile;

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
