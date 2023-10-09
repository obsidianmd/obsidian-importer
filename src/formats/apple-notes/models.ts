import { Message } from 'protobufjs';
export { descriptor } from './descriptor';

//A few typings for internal use

export type ANAccount = {
	name: string;
	uuid: string;
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

//Types for protobufs, and enums to describe their int fields

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
	attachmentInfo: ANAttachmentInfo;
	
	//internal additions, not part of the protobufs
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
	Hashtag = 'com.apple.notes.inlinetextattachment.hashtag',
	Mention = 'com.apple.notes.inlinetextattachment.mention',
	InternalLink = 'com.apple.notes.inlinetextattachment.link',
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
	mergeableDataObjectKeyItem: string[];
	mergeableDataObjectTypeItem: string[];
	mergeableDataObjectUuidItem: Uint8Array[];
	mergeableDataObjectEntry: ANMergeableObjectEntry[];
}

export interface ANMergeableObjectEntry extends Message {
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
