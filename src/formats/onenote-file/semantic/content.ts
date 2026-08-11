/** Format-independent content consumed by the Markdown converter. */

export interface TextRun {
	text: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	superscript?: boolean;
	subscript?: boolean;
	hyperlinkUrl?: string;
	math?: boolean;
	highlight?: string;
}

export interface Tag {
	label?: string;
	checkable: boolean;
	completed: boolean;
	shape?: number;
}

export interface ListInfo {
	level: number;
	ordered: boolean;
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
	points: { x: number, y: number }[];
	color: string;
	width: number;
	opacity: number;
	recognizedText?: string;
}

export interface Ink {
	kind: 'ink';
	strokes: InkStroke[];
	recognizedText?: string;
}

export type Element = Paragraph | Outline | Table | Image | EmbeddedFile | Ink;

export interface Page {
	/** Stable source identity used for repeat imports. */
	id: string;
	title: string;
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
