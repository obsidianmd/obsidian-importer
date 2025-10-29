/**
 * Database helper functions for Notion API importer
 * Handles database conversion and .base file generation
 */

import { Client, BlockObjectResponse, DatabaseObjectResponse, PageObjectResponse } from '@notionhq/client';
import { Vault, normalizePath, App } from 'obsidian';
import { ImportContext } from '../../main';
import { sanitizeFileName } from '../../util';
import { getUniqueFolderPath } from './vault-helpers';
import { makeNotionRequest } from './api-helpers';
import { canConvertFormula, convertNotionFormulaToObsidian, getNotionFormulaExpression } from './formula-converter';
import { DatabaseInfo, RelationPlaceholder } from './types';
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
 * In fact, Notion allows top-level databases, which will be addressed later.
 */
export async function convertChildDatabase(
	block: BlockObjectResponse,
	ctx: ImportContext,
	currentPageFolderPath: string,
	client: Client,
	vault: Vault,
	app: App,
	outputRootPath: string,
	formulaStrategy: FormulaImportStrategy,
	processedDatabases: Map<string, DatabaseInfo>,
	relationPlaceholders: RelationPlaceholder[],
	importPageCallback: (pageId: string, parentPath: string) => Promise<void>,
	onPagesDiscovered?: (count: number) => void
): Promise<string> {
	if (block.type !== 'child_database') return '';
	
	try {
		// Get database details
		const databaseId = block.id;
		const database = await makeNotionRequest(
			() => client.databases.retrieve({ database_id: databaseId }) as Promise<DatabaseObjectResponse>,
			ctx
		);
		
		// Extract database title
		const databaseTitle = extractDatabaseTitle(database);
		const sanitizedTitle = sanitizeFileName(databaseTitle || 'Untitled Database');
		
		ctx.status(`Processing database: ${sanitizedTitle}...`);
		
		// In Notion API v2025-09-03, databases have data_sources array
		// Get the first data source to retrieve properties
        // It seems that the code I used in the Notion Flow plugin is not compatible with the new 2025-09-03 version of the API.
        // FIXME: At the same time, I may need to inform the user in the "Import Notes" that the imported database only reads the first data source.
		
		let dataSourceProperties: Record<string, any> = {};
		let propertyIds: string[] = [];
		
		if ((database as any).data_sources && (database as any).data_sources.length > 0) {
			const dataSourceId = (database as any).data_sources[0].id;
			const dataSource = await makeNotionRequest(
				() => client.dataSources.retrieve({ data_source_id: dataSourceId }),
				ctx
			);
			
			dataSourceProperties = (dataSource as any).properties || {};
			// Get property order from property_ids array if available
			propertyIds = (dataSource as any).property_ids || [];
		}
		
		// Create database folder under current page folder
		const databaseFolderPath = getUniqueFolderPath(vault, currentPageFolderPath, sanitizedTitle);
		await vault.createFolder(normalizePath(databaseFolderPath));
		
		// Query database to get all pages (with pagination)
		// Use the data source ID for querying
		const dataSourceId = (database as any).data_sources?.[0]?.id || databaseId;
		const databasePages = await queryAllDatabasePages(client, dataSourceId, ctx);
		
		ctx.status(`Found ${databasePages.length} pages in database ${sanitizedTitle}`);
		
		// Notify about discovered pages
		if (onPagesDiscovered) {
			onPagesDiscovered(databasePages.length);
		}
		
	// Import each database page recursively
	for (const page of databasePages) {
		if (ctx.isCancelled()) break;
		
		// Import the page using the callback (which handles the full page import logic)
		await importPageCallback(page.id, databaseFolderPath);
	}
	
	// Create .base file in "Notion Databases" folder
	const baseFilePath = await createBaseFile(
		vault,
		sanitizedTitle,
		databaseFolderPath,
		outputRootPath,
		dataSourceProperties,
		databasePages,
		formulaStrategy,
		propertyIds
	);
	
	// Record database information for relation resolution
	const databaseInfo: DatabaseInfo = {
		id: databaseId,
		title: sanitizedTitle,
		folderPath: databaseFolderPath,
		baseFilePath: baseFilePath,
		properties: dataSourceProperties,
		dataSourceId: dataSourceId,
	};
	processedDatabases.set(databaseId, databaseInfo);
	
	// Process relation properties in database pages
	// This will add placeholders to relationPlaceholders array
	await processRelationProperties(
		databasePages,
		dataSourceProperties,
		databaseId,
		relationPlaceholders
	);
	
	// Return a reference to the .base file
	return `[[${sanitizedTitle}.base]]`;
	}
	catch (error) {
		console.error(`Failed to convert database ${block.id}:`, error);
		ctx.reportFailed(`Database ${block.id}`, error.message);
		return `<!-- Failed to import database: ${error.message} -->`;
	}
}

/**
 * Query all pages from a database with pagination support
 * Note: In Notion API v2025-09-03, databases are now called "data sources"
 */
async function queryAllDatabasePages(
	client: Client,
	databaseId: string,
	ctx: ImportContext
): Promise<PageObjectResponse[]> {
	const pages: PageObjectResponse[] = [];
	let cursor: string | undefined = undefined;
	
	do {
		// In Notion API v2025-09-03, use dataSources.query instead of databases.query
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
			(page: any): page is PageObjectResponse => page.object === 'page'
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
 * Create a .base file for the database
 */
export async function createBaseFile(
	vault: Vault,
	databaseName: string,
	databaseFolderPath: string,
	outputRootPath: string,
	properties: any,
	databasePages: PageObjectResponse[],
	formulaStrategy: FormulaImportStrategy = 'function',
	propertyIds: string[] = []
): Promise<string> {
	// Create "Notion Databases" folder at the same level as output root
	const parentPath = outputRootPath.split('/').slice(0, -1).join('/') || '/';
	const databasesFolder = parentPath === '/' ? '/Notion Databases' : parentPath + '/Notion Databases';
	
	try {
		let folder = vault.getAbstractFileByPath(normalizePath(databasesFolder));
		if (!folder) {
			await vault.createFolder(normalizePath(databasesFolder));
		}
	}
	catch (error) {
		console.error('Failed to create Notion Databases folder:', error);
	}
	
	// Generate .base file content
	const baseContent = generateBaseFileContent(databaseName, databaseFolderPath, properties, databasePages, formulaStrategy, propertyIds);
	
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
function generateBaseFileContent(
	databaseName: string,
	databaseFolderPath: string,
	properties: any,
	databasePages: PageObjectResponse[],
	formulaStrategy: FormulaImportStrategy = 'function',
	propertyIds: string[] = []
): string {
	// Basic .base file structure
	let content = `# ${databaseName}\n\n`;
	
	// Add filter to show files in first-level subfolders of the database folder
	// Logic: file.folder should start with database path, but should only have one more level
	// Example: if database is "Root/db-1", match "Root/db-1/page-1" but not "Root/db-1/page-1/db-2"
	// This allows user-created files in the same structure to appear in the base
	content += `filters:\n`;
	content += `  and:\n`;
	content += `    - file.folder.startsWith("${databaseFolderPath}/")\n`;
	// Count the number of path separators to ensure it's only one level deep
	// Split the database path to count its depth, then ensure file.folder has exactly one more level
	const databaseDepth = databaseFolderPath.split('/').length;
	content += `    - file.folder.split("/").length == ${databaseDepth + 1}\n\n`;
	
	// Map Notion properties to Obsidian properties
	const propertyMappings = mapDatabaseProperties(properties, formulaStrategy, propertyIds);
	
	// Separate formulas from regular properties (maintaining order)
	const formulas: Array<{key: string, config: any}> = [];
	const regularProperties: Array<{key: string, config: any}> = [];
	
	for (const item of propertyMappings) {
		if (item.config.formula) {
			// This is a formula property
			formulas.push(item);
		} else {
			// This is a regular property
			regularProperties.push(item);
		}
	}
	
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
	
	// Add a default table view
	content += `views:\n`;
	content += `  - type: table\n`;
	content += `    name: "All Items"\n`;
	content += `    order:\n`;
	content += `      - file.name\n`;
	
	// Add all regular properties to the view (in order)
	for (const item of regularProperties) {
		content += `      - ${item.key}\n`;
	}
	
	// Add all formula properties to the view (with formula. prefix, in order)
	for (const item of formulas) {
		content += `      - ${item.key}\n`;
	}
	
	return content;
}

/**
 * Map Notion database properties to Obsidian base properties
 * @param notionProperties - Notion database property schema
 * @param formulaStrategy - How to handle formula properties
 * @param propertyIds - Array of property IDs in the order they should appear
 * @returns Array of {key, config} objects in the correct order
 */
function mapDatabaseProperties(
	notionProperties: any,
	formulaStrategy: FormulaImportStrategy = 'function',
	propertyIds: string[] = []
): Array<{key: string, config: any}> {
	const mappings: Record<string, any> = {};
	
	// First pass: create mappings for all properties
	for (const [key, prop] of Object.entries(notionProperties as Record<string, any>)) {
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
					const obsidianFormula = convertNotionFormulaToObsidian(formulaExpression, notionProperties);
					if (obsidianFormula && canConvertFormula(formulaExpression)) {
						// Conversion successful - add as formula
						mappings[`formula.${sanitizePropertyKey(key)}`] = {
							displayName: propName,
							formula: obsidianFormula,
						};
					} else {
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
					const obsidianFormula = convertNotionFormulaToObsidian(formulaExpression, notionProperties);
					if (obsidianFormula) {
						// Conversion successful - add as formula
						mappings[`formula.${sanitizePropertyKey(key)}`] = {
							displayName: propName,
							formula: obsidianFormula,
						};
					}
				} else {
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
			const rollupFormula = convertRollupToFormula(key, prop.rollup, notionProperties);
			if (rollupFormula) {
				mappings[`formula.${sanitizePropertyKey(key)}`] = {
					displayName: propName,
					formula: rollupFormula,
				};
			} else {
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
	
	// Second pass: convert to ordered array
	// If propertyIds is provided, use that order; otherwise use the order from Object.entries
	const orderedMappings: Array<{key: string, config: any}> = [];
	
	if (propertyIds.length > 0) {
		// Use the order from propertyIds
		for (const propId of propertyIds) {
			if (mappings[propId]) {
				orderedMappings.push({
					key: propId,
					config: mappings[propId]
				});
			}
		}
		// Add any properties that weren't in propertyIds (shouldn't happen, but just in case)
		for (const [key, config] of Object.entries(mappings)) {
			if (!propertyIds.includes(key)) {
				orderedMappings.push({ key, config });
			}
		}
	} else {
		// No propertyIds provided, use the order from Object.entries
		for (const [key, config] of Object.entries(mappings)) {
			orderedMappings.push({ key, config });
		}
	}
	
	return orderedMappings;
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
	rollupKey: string,
	rollupConfig: any,
	allProperties: any
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
			// Note: Obsidian Base does not have built-in date comparison functions
			// This rollup function cannot be accurately converted
			console.warn(`⚠️ Rollup function "earliest_date" is not supported.`);
			console.warn(`   Obsidian Base does not have date aggregation functions.`);
			console.warn(`   Suggestion: Manually sort by date in your base view.`);
			return null;
		
		case 'latest_date':
			// Finds the latest date in time of a date property
			// Note: Obsidian Base does not have built-in date comparison functions
			// This rollup function cannot be accurately converted
			console.warn(`⚠️ Rollup function "latest_date" is not supported.`);
			console.warn(`   Obsidian Base does not have date aggregation functions.`);
			console.warn(`   Suggestion: Manually sort by date in your base view.`);
			return null;
		
		case 'date_range':
			// Computes the date range (latest date - earliest date) of a date property
			// Note: Obsidian Base does not have built-in date comparison functions
			// This rollup function cannot be accurately converted
			console.warn(`⚠️ Rollup function "date_range" is not supported.`);
			console.warn(`   Obsidian Base does not have date aggregation functions.`);
			console.warn(`   Suggestion: Use date arithmetic manually in your notes.`);
			console.warn(`   Reference: https://help.obsidian.md/bases/syntax#Date+arithmetic`);
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
async function processRelationProperties(
	databasePages: PageObjectResponse[],
	properties: any,
	databaseId: string,
	relationPlaceholders: RelationPlaceholder[]
): Promise<void> {
	// Find all relation properties
	const relationProperties: Record<string, any> = {};
	for (const [key, prop] of Object.entries(properties as Record<string, any>)) {
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
				const relatedPageIds = pageProp.relation.map((r: any) => r.id);
				
				if (relatedPageIds.length > 0) {
					// Get the target database ID from the relation config
					const targetDatabaseId = (propConfig as any).relation?.database_id || '';
					
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
 * Replace <!-- DATABASE_PLACEHOLDER:id --> with actual database references
 */
export async function processDatabasePlaceholders(
	markdownContent: string,
	blocks: any[],
	ctx: ImportContext,
	currentPageFolderPath: string,
	client: Client,
	vault: Vault,
	app: App,
	outputRootPath: string,
	formulaStrategy: FormulaImportStrategy,
	processedDatabases: Map<string, DatabaseInfo>,
	relationPlaceholders: RelationPlaceholder[],
	importPageCallback: (pageId: string, parentPath: string) => Promise<void>,
	onPagesDiscovered?: (count: number) => void
): Promise<string> {
	// Find all database placeholders
	const placeholderRegex = /<!-- DATABASE_PLACEHOLDER:([a-f0-9-]+) -->/g;
	const matches = [...markdownContent.matchAll(placeholderRegex)];
	
	if (matches.length === 0) {
		return markdownContent;
	}
	
	let processedContent = markdownContent;
	
	// Process each database placeholder
	for (const match of matches) {
		const placeholder = match[0];
		const databaseId = match[1];
		
		// Find the corresponding block
		const databaseBlock = blocks.find(b => b.id === databaseId && b.type === 'child_database');
		
		if (databaseBlock) {
			try {
				// Convert the database and get the reference
				const databaseReference = await convertChildDatabase(
					databaseBlock,
					ctx,
					currentPageFolderPath,
					client,
					vault,
					app,
					outputRootPath,
					formulaStrategy,
					processedDatabases,
					relationPlaceholders,
					importPageCallback,
					onPagesDiscovered
				);
				
				// Replace placeholder with actual reference
				processedContent = processedContent.replace(placeholder, databaseReference);
			}
			catch (error) {
				console.error(`Failed to process database ${databaseId}:`, error);
				processedContent = processedContent.replace(
					placeholder,
					`<!-- Failed to import database: ${error.message} -->`
				);
			}
		}
	}
	
	return processedContent;
}

