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
export interface AirtableFieldOptions {
	linkedTableId?: string;
	recordLinkFieldId?: string;
	fieldIdInLinkedTable?: string;
	formula?: string;
	result?: { type?: string };
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

export interface PreparedTableData {
	baseId: string;
	baseName: string;
	tableName: string;
	primaryFieldId: string;
	fields: AirtableFieldSchema[];
	views: AirtableViewInfo[];
	records: AirtableRecord[];
	recordViewMemberships: Map<string, string[]>;
	viewsShowingEveryRecord: Set<string>;
}

export interface PlannedRecord {
	record: AirtableRecord;
	filePath: string;
	title: string;
	/** Why this record was passed over, ready to show. */
	skipped?: string;
}

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
	viewsShowingEveryRecord?: ReadonlySet<string>;
}

