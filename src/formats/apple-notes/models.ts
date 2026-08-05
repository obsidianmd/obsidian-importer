import { Message } from 'protobufjs';

/**
 * A file the vault holds, as far as a converter is concerned: it takes one
 * from the context and hands it back to be linked, never reading it.
 */
export interface ANFile {
	path: string;
}

/**
 * What a converter needs from outside the note it is converting: the database
 * the note came from, the settings the user chose, and the vault - fetching an
 * attachment, importing a linked note, and writing a link the way the vault
 * would.
 *
 * The importer implements this. A test can implement it over a database and a
 * directory, which is what lets the conversion run outside Obsidian.
 */
export interface ANContext<F extends ANFile = ANFile> {
	/** Notes repeat their title as the first line; whether that line is dropped. */
	omitFirstLine: boolean;
	/** Whether a drawing's transcription is kept as a callout. */
	includeHandwriting: boolean;
	database: SQLiteTagSpawned;

	/** Gunzip and decode one of the protobufs a note refers to. */
	decodeData<T extends ANConverter>(hexdata: string, converterType: ANConverterType<T>): T;
	/** Bring an attachment into the vault, or null if it cannot be read. */
	resolveAttachment(id: number, uti: string): Promise<F | null>;
	/** Import a note this one links to, so the link has something to point at. */
	resolveNote(id: number): Promise<F | null>;
	/** A link to a file, in whichever form the vault is set to write. */
	linkTo(file: F, sourcePath: string, subpath?: string, display?: string): string;
}

export abstract class ANConverter {
	ctx: ANContext;

	static protobufType: string;

	constructor(ctx: ANContext) {
		this.ctx = ctx;
	}

	abstract format(table?: boolean, parentNotePath?: string): Promise<string>;
}

export type ANConverterType<T extends ANConverter> = {
	new(ctx: ANContext, x: any): T;
	protobufType: string;
};

// SQLite types 

export type SQLiteTagSpawned = {
	get(...query: any[]): Promise<SQLiteRow>;
	all(...query: any[]): Promise<SQLiteTable>;
	close(): void;
};

type SQLiteTable = SQLiteRow[];

interface SQLiteRow extends Record<string, any> {
	[member: string]: any;
}

// A few typings for internal use

export type ANAccount = {
	name: string;
	uuid: string;
	path: string;
};

export type ANFragmentPair = {
	attr: ANAttributeRun;
	fragment: string;
};

export enum ANMultiRun {
	None,
	Monospaced,
	Alignment,
	List
}

export type ANTableUuidMapping = Record<string, number>;

// Types for protobufs, and enums to describe their int fields

export interface ANDocument extends Message {
	name: string;
	note: ANNote;
}

export interface ANNote extends Message {
	attributeRun: ANAttributeRun[];
	noteText: string;
	version: number;
}

export interface ANAttributeRun extends Message {
	[member: string]: any;

	length: number;
	paragraphStyle?: ANParagraphStyle;
	font?: ANFont;
	fontWeight?: ANFontWeight;
	underlined?: boolean;
	strikethrough?: number;
	superscript?: ANBaseline;
	link?: string;
	color?: ANColor;
	attachmentInfo?: ANAttachmentInfo;

	// internal additions, not part of the protobufs
	fragment: string;
	atLineStart: boolean;
}

export interface ANParagraphStyle extends Message {
	styleType?: ANStyleType;
	alignment?: ANAlignment;
	indentAmount?: number;
	checklist?: ANChecklist;
	blockquote?: number;
}

export enum ANStyleType {
	Default = -1,
	Title = 0,
	Heading = 1,
	Subheading = 2,
	Monospaced = 4,
	DottedList = 100,
	DashedList = 101,
	NumberedList = 102,
	Checkbox = 103
}

export enum ANAlignment {
	Left = 0,
	Centre = 1,
	Right = 2,
	Justify = 3
}

export interface ANChecklist extends Message {
	done: number;
	uuid: string;
}

export interface ANFont extends Message {
	fontName?: string;
	pointSize?: number;
	fontHints?: number;
}

export enum ANFontWeight {
	Regular = 0,
	Bold = 1,
	Italic = 2,
	BoldItalic = 3
}

export enum ANBaseline {
	Sub = -1,
	Default = 0,
	Super = 1
}

export interface ANColor extends Message {
	red: number;
	green: number;
	blue: number;
	alpha: number;
}

export enum ANFolderType {
	Default = 0,
	Trash = 1,
	Smart = 3
}

export interface ANAttachmentInfo extends Message {
	attachmentIdentifier: string;
	typeUti: string | ANAttachment;
}

export enum ANAttachment {
	Drawing = 'com.apple.paper',
	DrawingLegacy = 'com.apple.drawing',
	DrawingLegacy2 = 'com.apple.drawing.2',
	Hashtag = 'com.apple.notes.inlinetextattachment.hashtag',
	Mention = 'com.apple.notes.inlinetextattachment.mention',
	InternalLink = 'com.apple.notes.inlinetextattachment.link',
	ModifiedScan = 'com.apple.paper.doc.scan',
	Scan = 'com.apple.notes.gallery',
	Table = 'com.apple.notes.table',
	UrlCard = 'public.url'
}

export interface ANMergableDataProto extends Message {
	mergableDataObject: ANMergeableDataObject;
}

export interface ANMergeableDataObject extends Message {
	mergeableDataObjectData: ANDataStore;
}

export interface ANDataStore extends Message {
	mergeableDataObjectKeyItem: ANTableKey[];
	mergeableDataObjectTypeItem: ANTableType[];
	mergeableDataObjectUuidItem: Uint8Array[];
	mergeableDataObjectEntry: ANTableObject[];
}

export interface ANTableObject extends Message {
	customMap: any;
	dictionary: any;
	orderedSet: any;
	note: ANNote;
}

export enum ANTableKey {
	Identity = 'identity',
	Direction = 'crTableColumnDirection',
	Self = 'self',
	Rows = 'crRows',
	UUIDIndex = 'UUIDIndex',
	Columns = 'crColumns',
	CellColumns = 'cellColumns'
}

export enum ANTableType {
	Number = 'com.apple.CRDT.NSNumber',
	String = 'com.apple.CRDT.NSString',
	Uuid = 'com.apple.CRDT.NSUUID',
	Tuple = 'com.apple.CRDT.CRTuple',
	MultiValueLeast = 'com.apple.CRDT.CRRegisterMultiValueLeast',
	MultiValue = 'com.apple.CRDT.CRRegisterMultiValue',
	Tree = 'com.apple.CRDT.CRTree',
	Node = 'com.apple.CRDT.CRTreeNode',
	Table = 'com.apple.notes.CRTable',
	ICTable = 'com.apple.notes.ICTable'
}
