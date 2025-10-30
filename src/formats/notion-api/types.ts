/**
 * Type definitions for Notion API importer
 */

import { Client } from '@notionhq/client';
import { Vault } from 'obsidian';
import { ImportContext } from '../../main';
import type { FormulaImportStrategy } from '../notion-api';

export interface ProcessedPage {
	id: string;
	title: string;
	folderPath: string;
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
	importPageCallback: (pageId: string, parentPath: string) => Promise<void>;
	onPagesDiscovered?: (count: number) => void;
}

/**
 * Information about a processed database
 */
export interface DatabaseInfo {
	id: string;
	title: string;
	folderPath: string;
	baseFilePath: string;
	properties: Record<string, any>;
	dataSourceId: string;
}

/**
 * Relation placeholder that needs to be replaced after all databases are processed
 */
export interface RelationPlaceholder {
	pageId: string;
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

