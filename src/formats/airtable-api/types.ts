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
 * Formula import strategy
 */
export type FormulaImportStrategy = 'static' | 'hybrid';

/**
 * Options for making Airtable API requests
 */
export interface AirtableRequestOptions {
	url: string;
	token: string;
	ctx: StatusReporter;
	method?: 'GET' | 'POST';
	// Request body varies by endpoint (JSON object)
	body?: any;
}

/**
 * Options for fetching records from Airtable
 */
export interface FetchRecordsOptions {
	baseId: string;
	tableIdOrName: string;
	token: string;
	viewId?: string;
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
	recordId: string;
	formulaStrategy: FormulaImportStrategy;
	fieldIdToNameMap?: Map<string, string>;
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
}

/**
 * Airtable Field schema
 */
export interface AirtableFieldSchema {
	id: string;
	name: string;
	type: string;
	// Options structure varies by field type (formula, currency, rating, select, etc.)
	// See: https://airtable.com/developers/web/api/field-model
	options?: any;
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
	// Additional metadata for table nodes
	metadata?: {
		baseId?: string;
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
	size: number;
	type: string;
	thumbnails?: {
		small?: { url: string, width: number, height: number };
		large?: { url: string, width: number, height: number };
		full?: { url: string, width: number, height: number };
	};
}

/**
 * Result of attachment download
 */
export interface AttachmentResult {
	path: string;
	isLocal: boolean;
	filename?: string;
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
 * Phase 2: Write files locally
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
 * Context for creating a record file
 */
export interface RecordFileContext {
	baseId: string;
	tablePath: string;
	primaryFieldId: string;
	fields: AirtableFieldSchema[];
	viewReferences: string[];
	recordIdToTitle: Map<string, string>;
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
}

