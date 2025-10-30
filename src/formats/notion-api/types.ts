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
 * Rollup configuration from Notion
 */
export interface RollupConfig {
	relationPropertyKey: string;
	relationPropertyId: string;
	rollupPropertyKey: string;
	rollupPropertyId: string;
	function: string; // count, sum, average, etc.
}

