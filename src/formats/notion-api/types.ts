/**
 * Type definitions for Notion API importer
 */

import { Client, BlockObjectResponse } from '@notionhq/client';
import { Vault } from 'obsidian';
import { ImportContext } from '../../main';
import type { FormulaImportStrategy } from '../notion-api';

export interface ProcessedPage {
	id: string;
	title: string;
	folderPath: string;
	// Using 'any' because Notion page properties have many different types (text, number, select, date, etc.)
	// and we store them in a flexible format for YAML frontmatter conversion.
	properties: Record<string, any>;
}

export interface NotionImporterConfig {
	maxRetries: number;
	requestCount: number;
}

/**
 * Configuration context for database processing operations
 * Consolidates common parameters used across database conversion functions
 */
export interface DatabaseProcessingContext {
	ctx: ImportContext;
	currentPageFolderPath: string;
	client: Client;
	vault: Vault;
	outputRootPath: string;
	formulaStrategy: FormulaImportStrategy;
	processedDatabases: Map<string, DatabaseInfo>;
	relationPlaceholders: RelationPlaceholder[];
	importPageCallback: (pageId: string, parentPath: string, databaseTag?: string) => Promise<void>;
	onPagesDiscovered?: (count: number) => void;
	baseViewType?: 'table' | 'cards' | 'list';
	coverPropertyName?: string;
}

/**
 * Information about a processed database
 */
export interface DatabaseInfo {
	id: string;
	title: string;
	folderPath: string;
	baseFilePath: string;
	// Using 'any' because database properties have many different types and configurations
	// (text, number, select, formula, relation, rollup, etc.) with varying structures.
	properties: Record<string, any>;
	dataSourceId: string;
}

/**
 * Relation placeholder that needs to be replaced after all databases are processed
 */
export interface RelationPlaceholder {
	pageId: string; // Used to lookup file path via notionIdToPath mapping
	propertyKey: string;
	relatedPageIds: string[];
	targetDatabaseId: string;
}

/**
 * Rollup configuration from Notion API
 * Based on Notion API 2025-09-03
 */
export interface RollupConfig {
	// Relation property that this rollup is based on
	relation_property_name?: string;
	relation_property_key?: string;
	
	// Target property to aggregate from related pages
	rollup_property_name?: string;
	rollup_property_key?: string;
	
	// Aggregation function (only includes functions that are implemented)
	function: 
	// Display functions
	| 'show_original'      // Show original values from related pages
	| 'show_unique'        // Show unique values
		
	// Count functions
	| 'count'              // Count total number of pages
	| 'count_values'       // Count non-empty values
	| 'unique'             // Count unique values
	| 'empty'              // Count empty values
	| 'not_empty'          // Count non-empty values
		
	// Percentage functions
	| 'percent_empty'      // Percentage of empty values
	| 'percent_not_empty'  // Percentage of non-empty values
		
	// Date functions
	| 'earliest_date'      // Earliest date
	| 'latest_date'        // Latest date
	| 'date_range'         // Date range (earliest → latest)
		
	// Note: Numeric aggregation functions (sum, average, median, min, max, range)
	// are not yet implemented and will fall through to the default case
	| string;              // Allow other values for forward compatibility
}

/**
 * Parameters for creating a .base file
 */
export interface CreateBaseFileParams {
	vault: Vault;
	databaseName: string;
	databaseFolderPath: string;
	outputRootPath: string;
	// Using 'any' because Notion database property schema has many variants with different structures
	dataSourceProperties: any;
	formulaStrategy?: FormulaImportStrategy;
	viewType?: 'table' | 'cards' | 'list';
	coverPropertyName?: string;
}

/**
 * Parameters for generating .base file content
 */
export interface GenerateBaseFileContentParams {
	databaseName: string;
	databaseFolderPath: string;
	// Using 'any' because Notion database property schema has many variants with different structures
	dataSourceProperties: any;
	formulaStrategy?: FormulaImportStrategy;
	viewType?: 'table' | 'cards' | 'list';
	coverPropertyName?: string;
}

/**
 * Attachment information from Notion
 */
export interface NotionAttachment {
	type: 'file' | 'external';
	url: string;
	name?: string;
	caption?: string;
}

/**
 * Result of attachment download
 */
export interface AttachmentResult {
	/** Path to the file (without extension for wiki links) or URL */
	path: string;
	/** Whether the file was downloaded locally */
	isLocal: boolean;
	/** Original filename with extension */
	filename?: string;
}

/**
 * Callback type for importing child pages
 */
export type ImportPageCallback = (pageId: string, parentPath: string) => Promise<void>;

/**
 * Context for block conversion operations
 */
export interface BlockConversionContext {
	ctx: ImportContext;
	currentFolderPath: string;
	client: Client;
	vault: Vault;
	downloadExternalAttachments: boolean;
	indentLevel?: number;
	blocksCache?: Map<string, BlockObjectResponse[]>;
	importPageCallback?: ImportPageCallback;
	mentionedIds?: Set<string>; // Collect mentioned page/database IDs during conversion
	syncedBlocksMap?: Map<string, string>; // Map synced block ID to file path
	outputRootPath?: string; // Root path for output (needed for synced blocks folder)
	syncedChildPlaceholders?: Map<string, Set<string>>; // Map file path to synced child IDs
	listCounters?: Map<number, number>; // Track list item numbers per indent level
	onAttachmentDownloaded?: () => void; // Callback when an attachment is downloaded
	currentPageTitle?: string; // Current page title for attachment naming fallback
}

/**
 * Function mapping information for Notion to Obsidian formula conversion
 */
export interface ConversionInfo {
	type: 'method' | 'property' | 'global' | 'operator';
	obsidianName?: string;
	argCount?: number; // Expected number of arguments
}

