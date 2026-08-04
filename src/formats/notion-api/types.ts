/**
 * Type definitions for Notion API importer
 */

import {
	Client,
	BlockObjectResponse,
	DataSourceObjectResponse,
	PageObjectResponse,
	Heading1BlockObjectResponse
} from '@notionhq/client';
import { Vault, App } from 'obsidian';
import { ImportContext } from '../../main';
import type { FormulaImportStrategy } from '../../base';

/**
 * One property's configuration in a data source's schema.
 *
 * Reached through an indexed access because the SDK does not export the config
 * union by name, only the response type that carries it. Widened with the
 * property types Notion returns that the SDK's union does not list yet: button
 * and place are real and do arrive, and the switches over these handle them.
 * Naming them here keeps those cases compiling without giving up the narrowing
 * the SDK's own members provide.
 */
export type NotionPropertyConfig =
	| DataSourceObjectResponse['properties'][string]
	| { type: 'button' | 'place', id: string, name: string, description: string | null };

/** A data source's property schema. */
export type NotionProperties = Record<string, NotionPropertyConfig>;

/**
 * One entry of the property map the importer builds for a .base file.
 *
 * Not a Notion type: this is the Obsidian-shaped result of mapping a Notion
 * property, with formula present only when the property became one.
 */
export interface BasePropertyMapping {
	displayName: string;
	/** Present only when the property became a formula in the .base file */
	formula?: string;
	/**
	 * Recorded for relation properties. Nothing reads these yet - only
	 * displayName and formula reach the .base file - but they are written, so
	 * they are described rather than quietly dropped.
	 */
	isRelation?: boolean;
	relationConfig?: unknown;
}

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
	properties: NotionProperties;
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
	dataSourceProperties: NotionProperties;
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
	| (string & {});      // Allow other values without collapsing the union above
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
	dataSourceProperties: NotionProperties;
	formulaStrategy?: FormulaImportStrategy;
	databasePropertyName?: string; // Property name for linking pages to database
}

/**
 * Parameters for generating .base file content
 */
export interface GenerateBaseFileContentParams {
	databaseName: string;
	dataSourceProperties: NotionProperties;
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
 * Common type for heading content with rich text and color.
 *
 * Notion gives heading_1, heading_2 and heading_3 the same shape, so naming one
 * of them describes all three; a union of the three collapses to this anyway.
 */
export type HeaderContentWithRichTextAndColorResponse = Heading1BlockObjectResponse['heading_1'];

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

