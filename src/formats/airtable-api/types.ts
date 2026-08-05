/**
 * Type definitions for Airtable API importer
 */

/**
 * Minimal interface for status reporting
 * Used by API helpers that only need to report status messages
 */
export interface StatusReporter {
	status: (message: string) => void;
}

/**
 * Options for making Airtable API requests
 */
export interface AirtableRequestOptions {
	url: string;
	token: string;
	ctx: StatusReporter;
}

/**
 * Options for selecting records from an Airtable table
 */
export interface SelectRecordsOptions {
	/** Restrict to a view, by view ID */
	view?: string;
	/** Fields to return; pass [] for record IDs only */
	fields?: string[];
	/** Callback called when records are fetched, receives the count of fetched records */
	onProgress?: (fetchedCount: number) => void;
}

/**
 * Options for converting field values
 */
export interface ConvertFieldOptions {
	// Field value type varies (string, number, array, object, etc.)
	fieldValue: any;
	fieldSchema: AirtableFieldSchema;
	/**
	 * Whether the accompanying .base file defines a formula for this field. If it
	 * does, the note carries no value for it and the .base computes it instead.
	 */
	computedByBase: boolean;
}

/**
 * Airtable Base information from meta API
 */
export interface AirtableBaseInfo {
	id: string;
	name: string;
	permissionLevel: string;
}

/**
 * Airtable Table information from schema API
 */
export interface AirtableTableInfo {
	id: string;
	name: string;
	primaryFieldId: string;
	fields: AirtableFieldSchema[];
	views: AirtableViewInfo[];
}

/**
 * Airtable View information
 */
export interface AirtableViewInfo {
	id: string;
	name: string;
	type: string;
	/**
	 * Fields this view shows, in the order it shows them. Returned only when the
	 * schema is requested with include[]=visibleFieldIds, and only for grid
	 * views - a gallery or kanban view leaves it undefined.
	 */
	visibleFieldIds?: string[];
}

/**
 * Airtable Field schema
 */
/**
 * A field's type-specific settings.
 *
 * Airtable gives every field type its own shape here, so only the keys the
 * importer reads are named. Anything else is still reachable, as unknown,
 * which is what asks a new reader to narrow before trusting it.
 */
export interface AirtableFieldOptions {
	/** multipleRecordLinks: the table the link points at. */
	linkedTableId?: string;
	/** lookup, rollup and count: the link field they travel through. */
	recordLinkFieldId?: string;
	/** lookup and rollup: the field they read in the linked table. */
	fieldIdInLinkedTable?: string;
	/** formula and rollup: the expression Airtable computes. */
	formula?: string;
	/** formula and rollup: the type of what that expression returns. */
	result?: { type?: string };
	/** singleSelect and multipleSelects: the choices offered. */
	choices?: Array<{ name: string }>;
	[key: string]: unknown;
}

export interface AirtableFieldSchema {
	id: string;
	name: string;
	type: string;
	// Options structure varies by field type (formula, currency, rating, select, etc.)
	// See: https://airtable.com/developers/web/api/field-model
	options?: AirtableFieldOptions;
}

/**
 * Tree node for base/table/view selection
 */
export interface AirtableTreeNode {
	id: string;
	title: string;
	type: 'base' | 'table';
	parentId: string | null;
	children?: AirtableTreeNode[];
	selected: boolean;
	disabled: boolean;
	collapsed?: boolean;
	/**
	 * Base nodes only: whether this base's table schemas have been fetched.
	 * Schemas cost one API call per base, so they are loaded on demand rather
	 * than all up front.
	 */
	tablesLoaded?: boolean;
	// Additional metadata for table nodes
	metadata?: {
		baseId?: string;
		tableId?: string;
		tableName?: string;
		primaryFieldId?: string;
		fields?: AirtableFieldSchema[];
		views?: AirtableViewInfo[];
	};
}

/**
 * Attachment information from Airtable
 */
export interface AirtableAttachment {
	id: string;
	url: string;
	filename: string;
	type: string;
}

/**
 * Result of attachment download
 */
export interface AttachmentResult {
	path: string;
	isLocal: boolean;
	filename?: string;
	/** MIME type from Airtable, used to decide whether the link should be an embed */
	mimeType?: string;
}

/**
 * Airtable record with proper typing
 */
export interface AirtableRecord {
	id: string;
	// Field values vary by type (string, number, array, object, etc.)
	fields: Record<string, any>;
	createdTime: string;
}

/**
 * Prepared table data for two-phase import
 * Phase 1: Fetch all data and prepare in memory
 * Phase 2: Decide where every note goes, then write them
 */
export interface PreparedTableData {
	baseId: string;
	baseName: string;
	tableName: string;
	primaryFieldId: string;
	fields: AirtableFieldSchema[];
	views: AirtableViewInfo[];
	records: AirtableRecord[];
	// Map: recordId -> array of view references like ["[[Table.base#View1]]", "[[Table.base#View2]]"]
	recordViewMemberships: Map<string, string[]>;
}

/**
 * A record with its final path already decided.
 *
 * Every path in a base is settled before any note in it is written, which is
 * what lets a note be written once, with real links in it, rather than with
 * placeholders that a second pass reads back and rewrites.
 */
export interface PlannedRecord {
	record: AirtableRecord;
	/** Where the note goes. Nothing else in the plan may claim this path. */
	filePath: string;
	/** The file name without .md, after any rename for a collision. */
	title: string;
	/**
	 * Why no note is written, or undefined when one is. An already-imported
	 * record still holds its path and is still something links can point at; an
	 * empty one has no note at all, so links to it fall back to its title.
	 */
	skipped?: 'Empty record' | 'Already imported';
}

/** One table's records with their paths decided, and where they go. */
export interface TablePlan {
	tableData: PreparedTableData;
	tablePath: string;
	records: PlannedRecord[];
}

/**
 * Grouped base info for import processing
 */
export interface BaseGroupInfo {
	baseId: string;
	baseName: string;
	tables: Array<{
		tableId: string;
		tableName: string;
		primaryFieldId: string;
		fields: AirtableFieldSchema[];
		views: AirtableViewInfo[];
	}>;
}

/**
 * Context for creating a record file
 */
export interface RecordFileContext {
	baseId: string;
	primaryFieldName: string;
	fields: AirtableFieldSchema[];
	viewReferences: string[];
	/** Fields the table's .base file defines a formula for; see ConvertFieldOptions */
	formulaFieldNames: Set<string>;
	/**
	 * This table's fields that get a frontmatter property, with the property name
	 * already resolved. Built once per table: the template config spans every
	 * selected table, so a per-record walk of it is mostly fields this table does
	 * not have.
	 */
	frontMatterFields: Array<{ fieldName: string, propertyName: string }>;
}

/**
 * Context for creating .base files
 */
export interface BaseFileContext {
	tableFolderPath: string;
	tableName: string;
	views: AirtableViewInfo[];
	fields: AirtableFieldSchema[];
	primaryFieldId: string;
	/** field name -> Obsidian formula, from computeTableFormulas */
	formulas: Map<string, string>;
}

