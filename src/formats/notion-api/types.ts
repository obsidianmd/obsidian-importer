/**
 * Type definitions for Notion API importer
 */

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
 * Rollup configuration from Notion
 */
export interface RollupConfig {
	relationPropertyKey: string;
	relationPropertyId: string;
	rollupPropertyKey: string;
	rollupPropertyId: string;
	function: string; // count, sum, average, etc.
}

