/**
 * Type definitions for Notion API importer
 */

import {
	Client,
	BlockObjectResponse,
	PageObjectResponse,
	Heading1BlockObjectResponse,
	Heading2BlockObjectResponse,
	Heading3BlockObjectResponse
} from '@notionhq/client';
import { Vault, App } from 'obsidian';
import { ImportContext } from '../../main';
import type { FormulaImportStrategy } from '../notion-api';

/**
 * Configuration context for database processing operations
 * Consolidates common parameters used across database conversion functions
 */
export interface DatabaseProcessingContext {
	ctx: ImportContext;
	currentPageFolderPath: string;
	currentFilePath?: string; // Current file path for link generation
	client: Client;
	vault: Vault;
	app: App;
	outputRootPath: string;
	formulaStrategy: FormulaImportStrategy;
	processedDatabases: Map<string, DatabaseInfo>;
	relationPlaceholders: RelationPlaceholder[];
	importPageCallback: (pageId: string, parentPath: string, databaseTag?: string, customFileName?: string) => Promise<void>;
	onPagesDiscovered?: (count: number) => void;
	databasePropertyName?: string; // Property name for linking pages to their database .base file
	blocksCache?: Map<string, BlockObjectResponse[]>; // Cache of fetched blocks for recursive search
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
 * Return type for importDatabaseCore function
 */
export interface DatabaseImportResult {
	sanitizedTitle: string;
	baseFilePath: string;
	databasePages: PageObjectResponse[];
	dataSourceId: string;
	dataSourceProperties: Record<string, any>;
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
 * Parameters for fetching and importing a Notion page
 */
export interface FetchAndImportPageParams {
	ctx: ImportContext;
	pageId: string;
	parentPath: string;
	databaseTag?: string;
	customFileName?: string; // Custom file name (without .md extension) to override the page title
}

export interface CreateBaseFileParams {
	vault: Vault;
	databaseName: string;
	databaseFolderPath: string;
	// Using 'any' because Notion database property schema has many variants with different structures
	dataSourceProperties: Record<string, any>;
	formulaStrategy?: FormulaImportStrategy;
	databasePropertyName?: string; // Property name for linking pages to database
}

/**
 * Parameters for generating .base file content
 */
export interface GenerateBaseFileContentParams {
	databaseName: string;
	// Using 'any' because Notion database property schema has many variants with different structures
	dataSourceProperties: Record<string, any>;
	formulaStrategy?: FormulaImportStrategy;
	databasePropertyName?: string; // Property name for linking pages to database
}

/**
 * Attachment information from Notion
 */
export interface NotionAttachment {
	type: 'file' | 'external';
	url: string;
	name?: string;
	caption?: string;
	created_time?: string;
	last_edited_time?: string;
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
 * Parameters for formatting attachment links
 */
export interface FormatAttachmentLinkParams {
	/** Attachment download result */
	result: AttachmentResult;
	/** Obsidian vault */
	vault: Vault;
	/** Obsidian app (for generateMarkdownLink) */
	app: App;
	/** Source file path (for relative link generation) */
	sourceFilePath: string;
	/** Optional caption/alt text */
	caption?: string;
	/** Whether to use embed syntax (!) for images/videos/pdfs */
	isEmbed?: boolean;
	/** Force wiki link format (for YAML frontmatter compatibility) */
	forceWikiLink?: boolean;
}

/**
 * Callback type for importing child pages
 */
export type ImportPageCallback = (pageId: string, parentPath: string) => Promise<void>;

/**
 * Common type for heading content with rich text and color
 */
export type HeaderContentWithRichTextAndColorResponse =
	Heading1BlockObjectResponse['heading_1'] |
	Heading2BlockObjectResponse['heading_2'] |
	Heading3BlockObjectResponse['heading_3'];

/**
 * Context for block conversion operations
 */
export interface BlockConversionContext {
	ctx: ImportContext;
	currentFolderPath: string;
	currentFilePath?: string; // Current file path for link generation
	client: Client;
	vault: Vault;
	app: App;
	downloadExternalAttachments: boolean;
	singleLineBreaks?: boolean; // Single line breaks between blocks (default: false)
	incrementalImport?: boolean; // Skip downloading attachments if same path and size
	indentLevel?: number;
	blocksCache?: Map<string, BlockObjectResponse[]>;
	importPageCallback?: ImportPageCallback;
	mentionedIds?: Set<string>; // Collect mentioned page/database IDs during conversion
	syncedBlocksMap?: Map<string, string>; // Map synced block ID to file path
	outputRootPath?: string; // Root path for output (needed for synced blocks folder)
	syncedChildPagePlaceholders?: Map<string, Set<string>>; // Map file path to synced child page IDs
	syncedChildDatabasePlaceholders?: Map<string, Set<string>>; // Map file path to synced child database IDs
	listCounters?: Map<number, number>; // Track list item numbers per indent level
	onAttachmentDownloaded?: () => void; // Callback when an attachment is downloaded
	currentPageTitle?: string; // Current page title for attachment naming fallback
	isProcessingSyncedBlock?: boolean; // Flag to indicate we're processing synced block content
	getAvailableAttachmentPath?: (filename: string) => Promise<string>; // Function to get available attachment path
}

/**
 * Function mapping information for Notion to Obsidian formula conversion
 */
export interface ConversionInfo {
	type: 'method' | 'property' | 'global' | 'operator';
	obsidianName?: string;
	argCount?: number; // Expected number of arguments
}

/**
 * Attachment type enum for type safety and consistency
 */
export enum AttachmentType {
	IMAGE = 'image',
	VIDEO = 'video',
	FILE = 'file',
	PDF = 'pdf'
}

/**
 * Configuration for attachment block conversion
 */
export interface AttachmentBlockConfig {
	type: AttachmentType;
	isEmbed: boolean;
	fallbackText: string;
	beforeDownload?: (attachment: NotionAttachment, block: any) => string | null;
}

