/**
 * Database helper functions for Notion API importer
 * Handles database conversion and .base file generation
 */

import { 
	Client, 
	BlockObjectResponse, 
	DatabaseObjectResponse, 
	PageObjectResponse,
	PartialPageObjectResponse
} from '@notionhq/client';
import { normalizePath } from 'obsidian';
import { ImportContext } from '../../main';
import { parseFilePath } from '../../filesystem';
import { sanitizeFileName } from '../../util';
import { getUniqueFolderPath } from './vault-helpers';
import { makeNotionRequest } from './api-helpers';
import { canConvertFormula, convertNotionFormulaToObsidian, getNotionFormulaExpression } from './formula-converter';
import {
	DatabaseInfo,
	RelationPlaceholder,
	DatabaseProcessingContext,
	RollupConfig,
	CreateBaseFileParams,
	GenerateBaseFileContentParams,
	DatabaseImportResult
} from './types';
import { extractPlaceholderIds, createPlaceholder, PlaceholderType } from './utils';
import type { FormulaImportStrategy } from '../notion-api';

/**
 * Obsidian property types that are supported
 */
const OBSIDIAN_PROPERTY_TYPES = {
	CHECKBOX: 'checkbox',
	DATE: 'date',
	DATETIME: 'datetime',
	LIST: 'list',
	NUMBER: 'number',
	TEXT: 'text',
};

/**
 * Convert a child_database block to Markdown
 * This creates a reference to a .base file and sets up the database structure
 * Note: This function also handles top-level databases by accepting a fake block object
 * (see importTopLevelDatabase() in notion-api.ts)
 */
export async function convertChildDatabase(
	block: BlockObjectResponse,
	context: DatabaseProcessingContext
): Promise<string> {
	if (block.type !== 'child_database') return '';
	
	const databaseId = block.id;
	let databaseTitle = 'Untitled Database'; // Default title for error reporting
	
	try {
		// Use the core import logic
		const result = await importDatabaseCore(databaseId, context);
		databaseTitle = result.sanitizedTitle;
		
		// Return an embedded reference to the .base file (using ![[]] to display inline like in Notion)
		return `![[${result.sanitizedTitle}.base]]`;
	}
	catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`Failed to convert database "${databaseTitle}":`, error);
		context.ctx.reportFailed(`Database: ${databaseTitle}`, errorMsg);
		return `<!-- Failed to import database: ${errorMsg} -->`;
	}
}

/**
 * Query all pages from a database with pagination support
 * Note: In Notion API v2025-09-03, databases are now called "data sources"
 */
export async function queryAllDatabasePages(
	client: Client,
	databaseId: string,
	ctx: ImportContext
): Promise<PageObjectResponse[]> {
	const pages: PageObjectResponse[] = [];
	let cursor: string | undefined = undefined;
	
	do {
		// In Notion API v2025-09-03, use dataSources.query instead of databases.query
		// Using 'any' for response because the Notion API returns a paginated response with complex structure
		// and we only need to access .results and .has_more properties which are consistent across versions.
		const response: any = await makeNotionRequest(
			() => client.dataSources.query({
				data_source_id: databaseId,
				start_cursor: cursor,
				page_size: 100,
			}),
			ctx
		);
		
		// Filter to get full page objects
		const fullPages = response.results.filter(
			(page: PageObjectResponse | PartialPageObjectResponse): page is PageObjectResponse => page.object === 'page'
		);
		
		pages.push(...fullPages);
		cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
		
	} while (cursor);
	
	return pages;
}

/**
 * Extract database title from Notion database object
 */
function extractDatabaseTitle(database: DatabaseObjectResponse): string {
	if (database.title && database.title.length > 0) {
		return database.title.map(t => t.plain_text).join('');
	}
	return 'Untitled Database';
}

/**
 * Core database import logic (shared between convertChildDatabase and importUnimportedDatabase)
 * This function handles the actual database import process without the wrapper logic
 */
export async function importDatabaseCore(
	databaseId: string,
	context: DatabaseProcessingContext
): Promise<DatabaseImportResult> {
	const {
		ctx,
		currentPageFolderPath,
		client,
		vault,
		outputRootPath,
		formulaStrategy,
		processedDatabases,
		relationPlaceholders,
		importPageCallback,
		onPagesDiscovered,
		baseViewType = 'table',
		coverPropertyName = 'cover'
	} = context;
	
	// Get database details
	const database = await makeNotionRequest(
		() => client.databases.retrieve({ database_id: databaseId }) as Promise<DatabaseObjectResponse>,
		ctx
	);
	
	// Extract database title
	const databaseTitle = extractDatabaseTitle(database);
	const sanitizedTitle = sanitizeFileName(databaseTitle || 'Untitled Database');
	
	ctx.status(`Processing database: ${sanitizedTitle}...`);
	
	// Get data source properties
	let dataSourceProperties: Record<string, any> = {};
	let dataSourceId = databaseId;
	
	if (database.data_sources && database.data_sources.length > 0) {
		dataSourceId = database.data_sources[0].id;
		const dataSource = await makeNotionRequest(
			() => client.dataSources.retrieve({ data_source_id: dataSourceId }),
			ctx
		);
		dataSourceProperties = dataSource.properties || {};
	}
	
	// Create database folder
	const databaseFolderPath = getUniqueFolderPath(vault, currentPageFolderPath, sanitizedTitle);
	await vault.createFolder(normalizePath(databaseFolderPath));
	
	// Query database to get all pages
	const databasePages = await queryAllDatabasePages(client, dataSourceId, ctx);
	
	ctx.status(`Found ${databasePages.length} pages in database ${sanitizedTitle}`);
	
	// Notify about discovered pages (if callback provided)
	if (onPagesDiscovered) {
		onPagesDiscovered(databasePages.length);
	}
	
	// Import each database page
	for (const page of databasePages) {
		if (ctx.isCancelled()) break;
		await importPageCallback(page.id, databaseFolderPath, databaseFolderPath);
	}
	
	// Create .base file
	const baseFilePath = await createBaseFile({
		vault,
		databaseName: sanitizedTitle,
		databaseFolderPath,
		outputRootPath,
		dataSourceProperties,
		formulaStrategy,
		viewType: baseViewType,
		coverPropertyName,
		ctx
	});
	
	// Record database information
	const databaseInfo: DatabaseInfo = {
		id: databaseId,
		title: sanitizedTitle,
		folderPath: databaseFolderPath,
		baseFilePath: baseFilePath,
		properties: dataSourceProperties,
		dataSourceId: dataSourceId,
	};
	processedDatabases.set(databaseId, databaseInfo);
	
	// Process relation properties
	await processRelationProperties(
		databasePages,
		dataSourceProperties,
		relationPlaceholders
	);
	
	return { sanitizedTitle, baseFilePath, databasePages, dataSourceId, dataSourceProperties };
}

/**
 * Create a .base file for the database
 */
export async function createBaseFile(params: CreateBaseFileParams): Promise<string> {
	const {
		vault,
		databaseName,
		databaseFolderPath,
		outputRootPath,
		dataSourceProperties,
		formulaStrategy = 'function',
		viewType = 'table',
		coverPropertyName = 'cover',
		ctx
	} = params;
	// Create "Notion Databases" folder at the same level as output root
	const { parent: parentPath } = parseFilePath(outputRootPath);
	const databasesFolder = normalizePath(
		parentPath ? `${parentPath}/Notion Databases` : 'Notion Databases'
	);
	
	try {
		let folder = vault.getAbstractFileByPath(databasesFolder);
		if (!folder) {
			await vault.createFolder(databasesFolder);
		}
	}
	catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('Failed to create Notion Databases folder:', error);
		ctx.reportFailed('Create Notion Databases folder', errorMsg);
	}
	
	// Generate .base file content
	const baseContent = generateBaseFileContent({
		databaseName,
		databaseFolderPath,
		dataSourceProperties,
		formulaStrategy,
		viewType,
		coverPropertyName
	});
	
	// Create .base file
	const baseFilePath = normalizePath(`${databasesFolder}/${databaseName}.base`);
	
	// Check if file already exists, if so, add number suffix
	let finalPath = baseFilePath;
	let counter = 1;
	while (vault.getAbstractFileByPath(finalPath)) {
		finalPath = normalizePath(`${databasesFolder}/${databaseName} (${counter}).base`);
		counter++;
	}
	
	await vault.create(finalPath, baseContent);
	
	return finalPath;
}

/**
 * Generate content for .base file
 */
function generateBaseFileContent(params: GenerateBaseFileContentParams): string {
	const {
		databaseName,
		databaseFolderPath,
		dataSourceProperties,
		formulaStrategy = 'function',
		viewType = 'table',
		coverPropertyName = 'cover'
	} = params;
	
	// Basic .base file structure
	let content = `# ${databaseName}\n\n`;
	
	// Use tag-based filter to include all pages from this database
	// This allows pages in nested folders (pages with children) to be included
	// We use the database folder path as the tag value because:
	// 1. Database names can be duplicated, but folder paths are unique
	// 2. It's more readable than using Notion IDs
	content += `filters:\n`;
	content += `  and:\n`;
	content += `    - note["notion-db"] == "${databaseFolderPath}"\n\n`;
	
	// Map Notion properties to Obsidian properties
	const { formulas, regularProperties } = mapDatabaseProperties(dataSourceProperties, formulaStrategy);
	
	// Add formulas section if there are any
	if (formulas.length > 0) {
		content += `formulas:\n`;
		for (const item of formulas) {
			// Extract the formula name (remove "formula." prefix)
			const formulaName = item.key.replace(/^formula\./, '');
			content += `  ${formulaName}: ${item.config.formula}\n`;
		}
		content += `\n`;
	}
	
	// Add properties section
	if (regularProperties.length > 0) {
		content += `properties:\n`;
		for (const item of regularProperties) {
			content += `  ${item.key}:\n`;
			content += `    displayName: "${item.config.displayName}"\n`;
			if (item.config.type) {
				content += `    type: ${item.config.type}\n`;
			}
		}
		content += `\n`;
	}
	
	// Add view based on user selection
	content += `views:\n`;
	
	if (viewType === 'table') {
		// Table view
		content += `  - type: table\n`;
		content += `    name: "All Items"\n`;
		content += `    order:\n`;
		content += `      - file.name\n`;
		
		// Add all regular properties to the view (in order)
		for (const item of regularProperties) {
			content += `      - ${item.key}\n`;
		}
		
		// Add all formula properties to the view (in order)
		for (const item of formulas) {
			content += `      - ${item.key}\n`;
		}
	}
	else if (viewType === 'cards') {
		// Cards view
		content += `  - type: cards\n`;
		content += `    name: "View"\n`;
		content += `    image: note.${coverPropertyName}\n`;
		content += `    order:\n`;
		content += `      - file.name\n`;
		
		// Add all regular properties
		for (const item of regularProperties) {
			content += `      - ${item.key}\n`;
		}
		
		// Add all formula properties
		for (const item of formulas) {
			content += `      - ${item.key}\n`;
		}
	}
	else if (viewType === 'list') {
		// List view
		content += `  - type: list\n`;
		content += `    name: "View"\n`;
		content += `    order:\n`;
		content += `      - file.name\n`;
		
		// Add all regular properties
		for (const item of regularProperties) {
			content += `      - ${item.key}\n`;
		}
		
		// Add all formula properties
		for (const item of formulas) {
			content += `      - ${item.key}\n`;
		}
	}
	
	return content;
}

/**
 * Map Notion database properties to Obsidian base properties
 * @param dataSourceProperties - Notion data source property schema
 * @param formulaStrategy - How to handle formula properties
 * @returns Object with separate arrays for formulas and regular properties
 */
/**
 * Map database properties to Dataview format
 * @param dataSourceProperties - Using 'any' because Notion's database property schema has many variants
 * @param formulaStrategy - Strategy for handling formula properties
 * @returns Object with formulas and regularProperties arrays, each using 'any' for config because
 *          property configurations vary widely by type (text, number, select, formula, relation, etc.)
 */
function mapDatabaseProperties(
	dataSourceProperties: any,
	formulaStrategy: FormulaImportStrategy = 'function'
): {
		formulas: Array<{key: string, config: any}>;
		regularProperties: Array<{key: string, config: any}>;
	} {
	// Using 'any' for mappings because we're building a dynamic mapping of property configurations
	// which have different structures depending on the property type.
	const mappings: Record<string, any> = {};
	
	// First pass: create mappings for all properties
	// Using 'any' in Object.entries cast because dataSourceProperties has dynamic keys and property types
	for (const [key, prop] of Object.entries(dataSourceProperties as Record<string, any>)) {
		const propType = prop.type;
		const propName = prop.name || key;
		
		// Map Notion property types to Obsidian property types
		switch (propType) {
			case 'checkbox':
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
					type: OBSIDIAN_PROPERTY_TYPES.CHECKBOX,
				};
				break;
			
			case 'date':
				// Check if it includes time
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
					type: OBSIDIAN_PROPERTY_TYPES.DATE, // TODO: detect if datetime
				};
				break;
			
			case 'number':
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
					type: OBSIDIAN_PROPERTY_TYPES.NUMBER,
				};
				break;
			
			case 'select':
			case 'status':
				// Single select -> text in Obsidian
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
					type: OBSIDIAN_PROPERTY_TYPES.TEXT,
				};
				break;
			
			case 'multi_select':
				// Multi-select -> list in Obsidian
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
					type: OBSIDIAN_PROPERTY_TYPES.LIST,
				};
				break;
			
			case 'title':
				// Skip title property - it corresponds to file.name in Obsidian
				// Title is already used as the page filename
				break;
			
			case 'rich_text':
			case 'url':
			case 'email':
			case 'phone_number':
				// Text-based properties
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
					type: OBSIDIAN_PROPERTY_TYPES.TEXT,
				};
				break;
				
			case 'formula':
				// Handle formula based on import strategy
				const formulaExpression = getNotionFormulaExpression(prop.formula);
				
				if (formulaStrategy === 'static') {
					// Strategy 1: Static values only - add as text property
					mappings[sanitizePropertyKey(key)] = {
						displayName: propName,
						type: OBSIDIAN_PROPERTY_TYPES.TEXT,
					};
				}
				else if (formulaStrategy === 'function') {
					// Strategy 2: Function only - try to convert, keep original syntax if fails
					if (formulaExpression) {
						const obsidianFormula = convertNotionFormulaToObsidian(formulaExpression, dataSourceProperties);
						if (obsidianFormula && canConvertFormula(formulaExpression)) {
							// Conversion successful - add as formula
							mappings[`formula.${sanitizePropertyKey(key)}`] = {
								displayName: propName,
								formula: obsidianFormula,
							};
						}
						else {
							// Conversion failed - keep original Notion syntax (will show empty values)
							console.warn(`⚠️ Formula "${propName}" cannot be fully converted to Obsidian syntax.`);
							console.warn(`   Original: ${formulaExpression}`);
							console.warn(`   Reason: Contains unsupported functions (e.g., substring, slice, split, format, etc.)`);
							console.warn(`   Result: Formula will be kept as-is but may not work correctly in Obsidian.`);
							console.warn(`   Suggestion: Consider using "Static values" strategy for this database.`);
							mappings[`formula.${sanitizePropertyKey(key)}`] = {
								displayName: propName,
								formula: formulaExpression, // Keep original Notion syntax
							};
						}
					}
				}
				else if (formulaStrategy === 'hybrid') {
					// Strategy 3: Hybrid - convert if possible, fallback to text
					if (formulaExpression && canConvertFormula(formulaExpression)) {
						const obsidianFormula = convertNotionFormulaToObsidian(formulaExpression, dataSourceProperties);
						if (obsidianFormula) {
							// Conversion successful - add as formula
							mappings[`formula.${sanitizePropertyKey(key)}`] = {
								displayName: propName,
								formula: obsidianFormula,
							};
						}
					}
					else {
						// Cannot convert - add as text property
						console.warn(`⚠️ Formula "${propName}" cannot be converted to Obsidian syntax, falling back to text property.`);
						console.warn(`   Original: ${formulaExpression}`);
						console.warn(`   Reason: Contains unsupported functions (e.g., substring, slice, split, format, etc.)`);
						mappings[sanitizePropertyKey(key)] = {
							displayName: propName,
							type: OBSIDIAN_PROPERTY_TYPES.TEXT,
						};
					}
				}
				break;
				
			case 'relation':
				// Relation properties will be stored as list of links in page YAML
				// Skip adding to .base file properties (will be handled in page frontmatter)
				// But we still need to record it for reference
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
					type: OBSIDIAN_PROPERTY_TYPES.LIST,
					isRelation: true,
					relationConfig: prop.relation,
				};
				break;
			
			case 'rollup':
				// Rollup properties should be converted to formulas in .base file
				const rollupFormula = convertRollupToFormula(prop.rollup);
				if (rollupFormula) {
					mappings[`formula.${sanitizePropertyKey(key)}`] = {
						displayName: propName,
						formula: rollupFormula,
					};
				}
				else {
					// Fallback: if conversion fails, log warning and skip this property
					// Don't add it as a regular property since it should be a formula
					console.warn(`Failed to convert rollup property "${propName}" to formula.`);
				}
				break;
			
			case 'people':
			case 'files':
			case 'created_time':
			case 'created_by':
			case 'last_edited_time':
			case 'last_edited_by':
				// These will be converted to text representation
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
					type: OBSIDIAN_PROPERTY_TYPES.TEXT,
				};
				break;
			
			default:
				// Unsupported types -> text
				console.log(`Unsupported property type: ${propType}, treating as text`);
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
					type: OBSIDIAN_PROPERTY_TYPES.TEXT,
				};
		}
	}
	
	// Separate formulas from regular properties
	// Note: Property order is based on Object.entries() iteration order
	// which in modern JavaScript (ES2015+) preserves insertion order for string keys
	// Using 'any' for config because property configurations have different structures by type
	const formulas: Array<{key: string, config: any}> = [];
	const regularProperties: Array<{key: string, config: any}> = [];
	
	for (const [key, config] of Object.entries(mappings)) {
		if (config.formula) {
			// This is a formula property
			formulas.push({ key, config });
		}
		else {
			// This is a regular property
			regularProperties.push({ key, config });
		}
	}
	
	return { formulas, regularProperties };
}

/**
 * Sanitize property key for use in .base file
 * Keep the original key as much as possible to match YAML frontmatter
 */
function sanitizePropertyKey(key: string): string {
	// Obsidian properties support most characters including spaces and hyphens
	// Return the original key to ensure consistency with YAML frontmatter
	return key;
}

/**
 * Convert a Notion rollup property to an Obsidian formula
 * Rollup aggregates values from related pages
 */
function convertRollupToFormula(
	rollupConfig: RollupConfig | null | undefined
): string | null {
	if (!rollupConfig) {
		return null;
	}
	
	// Get the relation property that this rollup is based on
	// In Notion API 2025-09-03, the fields are named differently
	const relationPropertyKey = rollupConfig.relation_property_name || rollupConfig.relation_property_key;
	const rollupPropertyKey = rollupConfig.rollup_property_name || rollupConfig.rollup_property_key;
	const rollupFunction = rollupConfig.function;
	
	if (!relationPropertyKey || !rollupFunction) {
		return null;
	}
	
	// Sanitize the relation property key
	const sanitizedRelationKey = sanitizePropertyKey(relationPropertyKey);
	
	// Map Notion rollup functions to Obsidian formulas
	// Note: Obsidian doesn't have direct rollup support, so we approximate
	// Map Notion rollup function names to formulas
	// Based on actual Notion API values (as of 2025-09-03)
	switch (rollupFunction) {
		case 'show_original':
			// Show original values from the target property of related pages
			// For types that can contain multiple values (multi-select, person), shows all values
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				return `note["${sanitizedRelationKey}"].map(value.asFile().properties["${sanitizedRollupPropKey}"])`;
			}
			// If no target property, just show the relation itself
			return `note["${sanitizedRelationKey}"]`;
		
		case 'show_unique':
			// Shows the unique values for this property
			// For types that can contain multiple values (multi-select, person), 
			// counts the unique values across all pages
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				// First map to get property values from all related pages, then get unique values
				return `note["${sanitizedRelationKey}"].map(value.asFile().properties["${sanitizedRollupPropKey}"]).flat().unique()`;
			}
			// If no target property, get unique relation pages
			return `note["${sanitizedRelationKey}"].unique()`;
		
		case 'count':
			// Counts the total number of pages (including blank pages)
			// Simply counts how many pages are in the relation
			return `note["${sanitizedRelationKey}"].length`;
		
		case 'count_values':
			// Counts the number of non-empty values for this property
			// For types that can contain multiple values (multi-select, person),
			// counts the number of selected values for each page (total count across all pages)
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				// Map to get all property values, flatten arrays (for multi-select), filter out empty, then count
				return `note["${sanitizedRelationKey}"].map(value.asFile().properties["${sanitizedRollupPropKey}"]).flat().length`;
			}
			// If no target property, same as count
			return `note["${sanitizedRelationKey}"].length`;
		
		case 'unique':
			// Counts the number of unique values for this property
			// For types that can contain multiple values (multi-select, person),
			// counts the unique values across all pages
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				// Map to get property values, flatten, get unique, then count
				return `note["${sanitizedRelationKey}"].map(value.asFile().properties["${sanitizedRollupPropKey}"]).flat().unique().length`;
			}
			// If no target property, count unique relation pages
			return `note["${sanitizedRelationKey}"].unique().length`;
		
		case 'empty':
			// Counts pages that have an empty value for this property
			// Returns the count of pages with empty values
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				// Count pages where the property is empty/null/undefined
				return `note["${sanitizedRelationKey}"].filter(value.asFile().properties["${sanitizedRollupPropKey}"] == null || value.asFile().properties["${sanitizedRollupPropKey}"] == "" || (typeof value.asFile().properties["${sanitizedRollupPropKey}"] == "object" && value.asFile().properties["${sanitizedRollupPropKey}"].length == 0)).length`;
			}
			// If no target property, check if relation itself is empty
			return `if(note["${sanitizedRelationKey}"].length == 0, 1, 0)`;
		
		case 'not_empty':
			// Counts pages that have a non-empty value for this property
			// Returns the count of pages with non-empty values
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				// Count pages where the property is not empty
				return `note["${sanitizedRelationKey}"].filter(value.asFile().properties["${sanitizedRollupPropKey}"] != null && value.asFile().properties["${sanitizedRollupPropKey}"] != "" && !(typeof value.asFile().properties["${sanitizedRollupPropKey}"] == "object" && value.asFile().properties["${sanitizedRollupPropKey}"].length == 0)).length`;
			}
			// If no target property, check if relation itself is not empty
			return `if(note["${sanitizedRelationKey}"].length > 0, 1, 0)`;
		
		case 'percent_empty':
			// Displays the percentage of pages that have an empty value for this property
			// Calculates: (empty pages / total pages) * 100
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				const totalPages = `note["${sanitizedRelationKey}"].length`;
				const emptyPages = `note["${sanitizedRelationKey}"].filter(value.asFile().properties["${sanitizedRollupPropKey}"] == null || value.asFile().properties["${sanitizedRollupPropKey}"] == "" || (typeof value.asFile().properties["${sanitizedRollupPropKey}"] == "object" && value.asFile().properties["${sanitizedRollupPropKey}"].length == 0)).length`;
				return `if(${totalPages} == 0, 0, (${emptyPages} / ${totalPages}) * 100)`;
			}
			// If no target property, check relation itself
			return `if(note["${sanitizedRelationKey}"].length == 0, 100, 0)`;
		
		case 'percent_not_empty':
			// Displays the percentage of pages that have a non-empty value for this property
			// Calculates: (non-empty pages / total pages) * 100
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				const totalPages = `note["${sanitizedRelationKey}"].length`;
				const notEmptyPages = `note["${sanitizedRelationKey}"].filter(value.asFile().properties["${sanitizedRollupPropKey}"] != null && value.asFile().properties["${sanitizedRollupPropKey}"] != "" && !(typeof value.asFile().properties["${sanitizedRollupPropKey}"] == "object" && value.asFile().properties["${sanitizedRollupPropKey}"].length == 0)).length`;
				return `if(${totalPages} == 0, 0, (${notEmptyPages} / ${totalPages}) * 100)`;
			}
			// If no target property, check relation itself
			return `if(note["${sanitizedRelationKey}"].length > 0, 100, 0)`;
		
		case 'earliest_date':
			// Finds the earliest date in time of a date property
			// Strategy: Get all dates, convert to date objects, sort by converting to numbers for comparison
			// Note: We need to sort by timestamp but keep as date objects
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				// Get all date values from related pages, filter out nulls
				// Convert to date objects, then sort (dates can be compared directly in Obsidian)
				const datesArray = `note["${sanitizedRelationKey}"].map(value.asFile().properties["${sanitizedRollupPropKey}"]).filter(value != null).map(date(value)).sort()`;
				return `${datesArray}[0]`;
			}
			console.warn(`⚠️ Rollup function "earliest_date" requires a target property.`);
			return null;
		
		case 'latest_date':
			// Finds the latest date in time of a date property
			// Strategy: Get all dates, convert to date objects, sort by converting to numbers for comparison
			// Note: We need to sort by timestamp but keep as date objects
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				// Get all date values from related pages, filter out nulls
				// Convert to date objects, then sort (dates can be compared directly in Obsidian)
				const datesArray = `note["${sanitizedRelationKey}"].map(value.asFile().properties["${sanitizedRollupPropKey}"]).filter(value != null).map(date(value)).sort()`;
				return `${datesArray}[-1]`;
			}
			console.warn(`⚠️ Rollup function "latest_date" requires a target property.`);
			return null;
		
		case 'date_range':
			// Computes the date range (earliest date -> latest date) of a date property
			// Strategy: Sort dates, take first and last elements, format as "earliest → latest"
			if (rollupPropertyKey) {
				const sanitizedRollupPropKey = sanitizePropertyKey(rollupPropertyKey);
				// Get all date values from related pages, filter out nulls, convert to date objects, sort
				const datesArray = `note["${sanitizedRelationKey}"].map(value.asFile().properties["${sanitizedRollupPropKey}"]).filter(value != null).map(date(value)).sort()`;
				// Take first (earliest) and last (latest) elements and format
				const earliestExpr = `${datesArray}[0]`;
				const latestExpr = `${datesArray}[-1]`;
				// Format as "YYYY-MM-DD → YYYY-MM-DD"
				return `(${earliestExpr}).format("YYYY-MM-DD") + " → " + (${latestExpr}).format("YYYY-MM-DD")`;
			}
			console.warn(`⚠️ Rollup function "date_range" requires a target property.`);
			return null;
			
		default:
			console.warn(`⚠️ Unsupported rollup function: "${rollupFunction}"`);
			console.warn(`   This rollup property will be skipped.`);
			console.warn(`   Please report this to the plugin developer if this is a valid Notion rollup function.`);
			return null;
	}
}

/**
 * Process relation properties in database pages
 * Add placeholders to the relationPlaceholders array
 */
/**
 * Process relation properties in database pages
 * @param dataSourceProperties - Using 'any' because Notion's database property schema has many variants
 */
export async function processRelationProperties(
	databasePages: PageObjectResponse[],
	dataSourceProperties: any,
	relationPlaceholders: RelationPlaceholder[]
): Promise<void> {
	// Find all relation properties
	// Using 'any' because relation property configurations have complex nested structures
	const relationProperties: Record<string, any> = {};
	// Using 'any' in Object.entries cast because dataSourceProperties has dynamic keys
	for (const [key, prop] of Object.entries(dataSourceProperties as Record<string, any>)) {
		if (prop.type === 'relation') {
			relationProperties[key] = prop;
		}
	}
	
	if (Object.keys(relationProperties).length === 0) {
		return;
	}
	
	// Process each page
	for (const page of databasePages) {
		const pageProperties = page.properties;
		
		// Check each relation property
		for (const [propKey, propConfig] of Object.entries(relationProperties)) {
			const pageProp = pageProperties[propKey];
			
			if (pageProp && pageProp.type === 'relation' && pageProp.relation) {
				const relatedPageIds = pageProp.relation.map(r => r.id);
			
				if (relatedPageIds.length > 0) {
				// Get the target database ID from the relation config
				// propConfig is from database schema, which has different structure than page properties
				// Using 'as any' because the relation config structure is not fully typed in Notion's API,
				// but we know it contains a database_id property for relation types.
					const targetDatabaseId = propConfig.type === 'relation' && 'relation' in propConfig 
						? (propConfig.relation as any)?.database_id || ''
						: '';
				
					// Add placeholder
					relationPlaceholders.push({
						pageId: page.id,
						propertyKey: propKey,
						relatedPageIds: relatedPageIds,
						targetDatabaseId: targetDatabaseId,
					});
				}
			}
		}
	}
}

/**
 * Process database placeholders in markdown content
 * Replace [[DATABASE_PLACEHOLDER:id]] with actual database references
 */
/**
 * Process database placeholders in markdown content
 * @param blocks - Using 'any[]' because blocks can be of many different types (BlockObjectResponse variants)
 *                 and we only need to check their 'type' property at runtime.
 */
export async function processDatabasePlaceholders(
	markdownContent: string,
	blocks: any[],
	context: DatabaseProcessingContext
): Promise<string> {
	// Find all database placeholders
	const databaseIds = extractPlaceholderIds(markdownContent, PlaceholderType.DATABASE_PLACEHOLDER);
	
	if (databaseIds.length === 0) {
		return markdownContent;
	}
	
	let processedContent = markdownContent;
	
	// Process each database placeholder
	for (const databaseId of databaseIds) {
		const placeholder = createPlaceholder(PlaceholderType.DATABASE_PLACEHOLDER, databaseId);
		
		// Find the corresponding block
		const databaseBlock = blocks.find(b => b.id === databaseId && b.type === 'child_database');
		
		if (databaseBlock) {
			try {
				// Convert the database and get the reference
				const databaseReference = await convertChildDatabase(
					databaseBlock,
					context
				);
				
				// Replace placeholder with actual reference
				processedContent = processedContent.replace(placeholder, databaseReference);
			}
			catch (error) {
				// Error is already reported inside convertChildDatabase with proper title
				// Just replace the placeholder with error comment
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error(`Failed to process database ${databaseId}:`, error);
				processedContent = processedContent.replace(
					placeholder,
					`<!-- Failed to import database: ${errorMsg} -->`
				);
			}
		}
	}
	
	return processedContent;
}

