/**
 * Type definitions for Airtable API importer
 */

import Airtable from 'airtable';
import { Vault, App } from 'obsidian';
import { ImportContext } from '../../main';

/**
 * Formula import strategy
 */
export type FormulaImportStrategy = 'static' | 'hybrid';

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
	options?: any;
}

/**
 * Tree node for base/table/view selection
 */
export interface AirtableTreeNode {
	id: string;
	title: string;
	type: 'base' | 'table' | 'view';
	parentId: string | null;
	children: AirtableTreeNode[];
	selected: boolean;
	disabled: boolean;
	collapsed: boolean;
	// Additional metadata for processing
	metadata?: {
		baseId?: string;
		tableName?: string;
		viewId?: string;
		fields?: AirtableFieldSchema[];
	};
}

/**
 * Context for processing Airtable records
 */
export interface RecordProcessingContext {
	ctx: ImportContext;
	currentFolderPath: string;
	client: typeof Airtable;
	vault: Vault;
	app: App;
	outputRootPath: string;
	formulaStrategy: FormulaImportStrategy;
	downloadAttachments: boolean;
	processedTables: Map<string, TableInfo>;
	linkedRecordPlaceholders: LinkedRecordPlaceholder[];
	importRecordCallback: (tableId: string, recordId: string, parentPath: string, customFileName?: string) => Promise<void>;
}

/**
 * Information about a processed table
 */
export interface TableInfo {
	id: string;
	baseId: string;
	name: string;
	folderPath: string;
	baseFilePath: string;
	fields: AirtableFieldSchema[];
	primaryFieldId: string;
}

/**
 * Linked Record placeholder for post-processing
 */
export interface LinkedRecordPlaceholder {
	recordId: string; // Source record ID
	fieldName: string; // Field name in frontmatter
	linkedRecordIds: string[]; // Linked record IDs
	linkedTableId?: string; // Target table ID
}

/**
 * Lookup placeholder for post-processing
 */
export interface LookupPlaceholder {
	recordId: string;
	fieldName: string;
	linkedFieldName: string; // Field to lookup from linked records
	lookupFieldName: string; // Field to display
}

/**
 * Rollup placeholder for post-processing
 */
export interface RollupPlaceholder {
	recordId: string;
	fieldName: string;
	linkedFieldName: string;
	rollupFieldName: string;
	aggregation: string; // count, sum, average, etc.
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
 * Parameters for creating .base file
 */
export interface CreateBaseFileParams {
	vault: Vault;
	tableName: string;
	tableFolderPath: string;
	fields: AirtableFieldSchema[];
	views: AirtableViewInfo[];
	formulaStrategy?: FormulaImportStrategy;
}

/**
 * Airtable record with proper typing
 */
export interface AirtableRecord {
	id: string;
	fields: Record<string, any>;
	createdTime: string;
}

