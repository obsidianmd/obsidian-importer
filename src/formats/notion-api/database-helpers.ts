/**
 * Database helper functions for Notion API importer
 * Handles database conversion and .base file generation
 */

import { Client, BlockObjectResponse, DatabaseObjectResponse, PageObjectResponse } from '@notionhq/client';
import { Vault, TFolder, normalizePath, App } from 'obsidian';
import { ImportContext } from '../../main';
import { sanitizeFileName } from '../../util';
import { getUniqueFolderPath } from './vault-helpers';
import { makeNotionRequest } from './api-helpers';
import { canConvertFormula, convertNotionFormulaToObsidian, getNotionFormulaExpression } from './formula-converter';

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
	importPageCallback: (pageId: string, parentPath: string) => Promise<void>
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
		if ((database as any).data_sources && (database as any).data_sources.length > 0) {
			const dataSourceId = (database as any).data_sources[0].id;
			const dataSource = await makeNotionRequest(
				() => client.dataSources.retrieve({ data_source_id: dataSourceId }),
				ctx
			);
			dataSourceProperties = (dataSource as any).properties || {};
		}
		
		// Create database folder under current page folder
		const databaseFolderPath = getUniqueFolderPath(vault, currentPageFolderPath, sanitizedTitle);
		await vault.createFolder(normalizePath(databaseFolderPath));
		
		// Query database to get all pages (with pagination)
		// Use the data source ID for querying
		const dataSourceId = (database as any).data_sources?.[0]?.id || databaseId;
		const databasePages = await queryAllDatabasePages(client, dataSourceId, ctx);
		
		ctx.status(`Found ${databasePages.length} pages in database ${sanitizedTitle}`);
		
		// Import each database page recursively
		for (const page of databasePages) {
			if (ctx.isCancelled()) break;
			
			// Import the page using the callback (which handles the full page import logic)
			await importPageCallback(page.id, databaseFolderPath);
		}
		
		// Create .base file in "Notion Databases" folder
		await createBaseFile(
			vault,
			sanitizedTitle,
			databaseFolderPath,
			outputRootPath,
			dataSourceProperties,
			databasePages
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
	databasePages: PageObjectResponse[]
): Promise<void> {
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
	const baseContent = generateBaseFileContent(databaseName, databaseFolderPath, properties, databasePages);
	
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
}

/**
 * Generate content for .base file
 */
function generateBaseFileContent(
	databaseName: string,
	databaseFolderPath: string,
	properties: any,
	databasePages: PageObjectResponse[],
	formulaStrategy: 'static' | 'function' | 'hybrid' = 'function'
): string {
	// Basic .base file structure
	let content = `# ${databaseName}\n\n`;
	
	// Add filter to show only pages in this database folder
	content += `filters:\n`;
	content += `  and:\n`;
	content += `    - file.inFolder("${databaseFolderPath}")\n\n`;
	
	// Map Notion properties to Obsidian properties
	const propertyMappings = mapDatabaseProperties(properties, formulaStrategy);
	
	// Separate formulas from regular properties
	const formulas: Record<string, any> = {};
	const regularProperties: Record<string, any> = {};
	
	for (const [propKey, propConfig] of Object.entries(propertyMappings)) {
		if (propConfig.formula) {
			// This is a formula property
			formulas[propKey] = propConfig;
		} else {
			// This is a regular property
			regularProperties[propKey] = propConfig;
		}
	}
	
	// Add formulas section if there are any
	if (Object.keys(formulas).length > 0) {
		content += `formulas:\n`;
		for (const [propKey, propConfig] of Object.entries(formulas)) {
			// Extract the formula name (remove "formula." prefix)
			const formulaName = propKey.replace(/^formula\./, '');
			content += `  ${formulaName}: ${propConfig.formula}\n`;
		}
		content += `\n`;
	}
	
	// Add properties section
	if (Object.keys(regularProperties).length > 0) {
		content += `properties:\n`;
		for (const [propKey, propConfig] of Object.entries(regularProperties)) {
			content += `  ${propKey}:\n`;
			content += `    displayName: "${propConfig.displayName}"\n`;
			if (propConfig.type) {
				content += `    type: ${propConfig.type}\n`;
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
	
	// Add all regular properties to the view
	for (const propKey of Object.keys(regularProperties)) {
		content += `      - ${propKey}\n`;
	}
	
	// Add all formula properties to the view (with formula. prefix)
	for (const propKey of Object.keys(formulas)) {
		content += `      - ${propKey}\n`;
	}
	
	return content;
}

/**
 * Map Notion database properties to Obsidian base properties
 * @param notionProperties - Notion database property schema
 * @param formulaStrategy - How to handle formula properties
 */
function mapDatabaseProperties(
	notionProperties: any,
	formulaStrategy: 'static' | 'function' | 'hybrid' = 'function'
): Record<string, any> {
	const mappings: Record<string, any> = {};
	
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
					const obsidianFormula = convertNotionFormulaToObsidian(formulaExpression);
					if (obsidianFormula && canConvertFormula(formulaExpression)) {
						// Conversion successful - add as formula
						mappings[`formula.${sanitizePropertyKey(key)}`] = {
							displayName: propName,
							formula: obsidianFormula,
						};
					} else {
						// Conversion failed - keep original Notion syntax (will show empty values)
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
					const obsidianFormula = convertNotionFormulaToObsidian(formulaExpression);
					if (obsidianFormula) {
						// Conversion successful - add as formula
						mappings[`formula.${sanitizePropertyKey(key)}`] = {
							displayName: propName,
							formula: obsidianFormula,
						};
					}
				} else {
					// Cannot convert - add as text property
					mappings[sanitizePropertyKey(key)] = {
						displayName: propName,
						type: OBSIDIAN_PROPERTY_TYPES.TEXT,
					};
				}
			}
			break;
			
			case 'relation':
			case 'rollup':
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
	
	return mappings;
}

/**
 * Sanitize property key for use in .base file
 */
function sanitizePropertyKey(key: string): string {
	// Replace spaces and special characters with underscores
	return key.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
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
	importPageCallback: (pageId: string, parentPath: string) => Promise<void>
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
					importPageCallback
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

