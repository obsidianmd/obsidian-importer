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
import { normalizePath, stringifyYaml, BasesConfigFile, TFile } from 'obsidian';
import { ImportContext } from '../../main';
import { sanitizeFileName } from '../../util';
import { parseFilePath } from '../../filesystem';
import { getUniqueFolderPath, getUniqueFilePath, updatePropertyTypes } from './vault-helpers';
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
	MULTITEXT: 'multitext',
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

		// Get the .base file from vault using the baseFilePath from result
		const baseFile = context.vault.getAbstractFileByPath(normalizePath(result.baseFilePath));

		if (baseFile && baseFile instanceof TFile) {
			// Use generateMarkdownLink to respect user's link format settings
			const sourceFilePath = context.currentFilePath || context.currentPageFolderPath;
			const link = context.app.fileManager.generateMarkdownLink(baseFile, sourceFilePath);
			// Add embed prefix
			return `!${link}`;
		}
		else {
			// Fallback to wiki link if file not found
			return `![[${result.sanitizedTitle}.base]]`;
		}
	}
	catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);

		// Check if this is a linked database error
		// According to Notion's official documentation, linked databases are not supported by the API
		// They will have empty data_sources array and should be skipped
		// Note: Linked databases always have "Untitled" as their title
		// See: https://developers.notion.com/docs/working-with-databases#linked-databases
		if (errorMsg.includes('Linked database') ||
			errorMsg.includes('not supported by Notion API')) {
			console.log(`Skipping linked database (block ID: ${databaseId})`);
			return `<!-- Linked database (not supported by Notion API) -->`;
		}

		// Check for other permission/access errors that might indicate a linked view
		const isLinkedViewError = (
			(errorMsg.includes('Could not find database with ID') ||
				errorMsg.includes('APIResponseError')) &&
			block.child_database?.title === 'Untitled' &&
			!block.has_children
		);

		if (isLinkedViewError) {
			console.log(`Skipping linked database view (block ID: ${databaseId}) - this is a reference to an existing database`);
			return `<!-- Linked database view (skipped - references an existing database) -->`;
		}

		// This is a real error, not a linked database
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
	context: DatabaseProcessingContext,
	isDataSourceId: boolean = false // If true, databaseId is actually a data_source_id
): Promise<DatabaseImportResult> {
	const {
		ctx,
		currentPageFolderPath,
		client,
		vault,
		formulaStrategy,
		processedDatabases,
		relationPlaceholders,
		importPageCallback,
		onPagesDiscovered,
		databasePropertyName = 'base'
	} = context;

	let dataSourceId: string;
	let sanitizedTitle: string = 'Untitled Database'; // Default value

	if (isDataSourceId) {
		// The ID is already a data_source_id (from Search API)
		// No need to call databases.retrieve()
		dataSourceId = databaseId;

		// We'll get the title from dataSources.retrieve() below
		ctx.status(`Processing database from data source: ${dataSourceId}...`);
	}
	else {
		// Traditional flow: get database first, then extract data_source_id
		const database = await makeNotionRequest(
			() => client.databases.retrieve({ database_id: databaseId }) as Promise<DatabaseObjectResponse>,
			ctx
		);

		// Extract database title
		const databaseTitle = extractDatabaseTitle(database);
		sanitizedTitle = sanitizeFileName(databaseTitle || 'Untitled Database');

		ctx.status(`Processing database: ${sanitizedTitle}...`);

		// Check if this is a linked database (no data sources)
		// According to Notion's official documentation, linked databases are not supported by the API
		// and will have an empty data_sources array
		// Note: Linked databases always have "Untitled" as their title
		if (!database.data_sources || database.data_sources.length === 0) {
			const errorMsg = 'Linked database (not supported by Notion API)';
			console.warn(`Skipping linked database (ID: ${databaseId}): ${errorMsg}`);
			throw new Error(errorMsg);
		}

		dataSourceId = database.data_sources[0].id;
	}

	// Try to retrieve data source - if this fails, don't create folder
	const dataSource = await makeNotionRequest(
		() => client.dataSources.retrieve({ data_source_id: dataSourceId }),
		ctx
	);

	// Get data source properties
	let dataSourceProperties: Record<string, any> = dataSource.properties || {};

	// If we're using data_source_id directly, extract title from dataSource
	if (isDataSourceId) {
		// Extract title from data source
		// The dataSource object is typed as GetDataSourceResponse which may not have name/title
		// We need to access it as any to get the actual data
		const dsAny = dataSource as any;
		const dataSourceTitle = dsAny.name ||
			(dsAny.title && Array.isArray(dsAny.title)
				? dsAny.title.map((t: any) => t.text?.content || t.plain_text || '').join('').trim()
				: null) ||
			'Untitled Database';
		sanitizedTitle = sanitizeFileName(dataSourceTitle);
		ctx.status(`Processing database: ${sanitizedTitle}...`);
	}

	// Query database to get all pages - if this fails, don't create folder
	const databasePages = await queryAllDatabasePages(client, dataSourceId, ctx);

	ctx.status(`Found ${databasePages.length} pages in database ${sanitizedTitle}`);

	// Query database templates (these appear in search but not in database pages)
	let templatePages: Array<{ id: string, name: string }> = [];
	try {
		const templatesResponse = await makeNotionRequest(
			() => client.dataSources.listTemplates({ data_source_id: dataSourceId }),
			ctx
		);
		templatePages = templatesResponse.templates || [];
		if (templatePages.length > 0) {
			ctx.status(`Found ${templatePages.length} template(s) in database ${sanitizedTitle}`);
		}
	}
	catch (error) {
		console.warn(`Failed to fetch templates for database ${sanitizedTitle}:`, error);
		// Continue even if template fetching fails
	}

	// Notify about discovered pages (if callback provided)
	if (onPagesDiscovered) {
		onPagesDiscovered(databasePages.length);
	}

	// Only create database folder after successfully validating data source and querying pages
	// This prevents creating empty folders for linked databases or databases with permission errors
	// For incremental import: reuse existing folder if it exists, otherwise create a unique one
	const baseFolderPath = normalizePath(currentPageFolderPath ? `${currentPageFolderPath}/${sanitizedTitle}` : sanitizedTitle);
	
	let databaseFolderPath: string;
	// Use adapter.exists for reliable check
	if (await vault.adapter.exists(baseFolderPath)) {
		// Reuse existing folder for incremental import
		databaseFolderPath = baseFolderPath;
	}
	else {
		// Create new folder with unique name if needed
		databaseFolderPath = getUniqueFolderPath(vault, currentPageFolderPath, sanitizedTitle);
		await vault.createFolder(normalizePath(databaseFolderPath));
	}

	// Create .base file before importing pages
	// This allows pages to reference the .base file in their frontmatter
	const baseFilePath = await createBaseFile({
		vault,
		databaseName: sanitizedTitle,
		databaseFolderPath,
		dataSourceProperties,
		formulaStrategy,
		databasePropertyName
	});

	// Extract .base file name for database tag (e.g., "Database name.base")
	const { basename: baseFileName } = parseFilePath(baseFilePath);
	const baseFileTag = `${baseFileName}.base`;

	// Import each database page with .base file tag
	for (const page of databasePages) {
		if (ctx.isCancelled()) break;
		await importPageCallback(page.id, databaseFolderPath, baseFileTag);
	}

	// Import database template pages (if any)
	// Templates are stored in the same folder as database pages
	if (templatePages.length > 0) {
		// Import each template page to the database folder
		for (const template of templatePages) {
			if (ctx.isCancelled()) break;
			ctx.status(`Importing template: ${template.name}...`);
			// Template pages should not have database tag (they are templates, not database entries)
			// Use custom file name format: {Database name} {Template name}
			const templateFileName = `${sanitizedTitle} ${template.name}`;
			await importPageCallback(template.id, databaseFolderPath, undefined, templateFileName);
		}
	}
	
	// Update property types using Obsidian's official API
	// This ensures correct type inference for properties (especially text vs number & date vs datetime)
	// Note: Only updates properties that don't already have a type (respects user's manual changes)
	const propertyTypes = extractPropertyTypesForTypesJson(dataSourceProperties, databasePages);
	updatePropertyTypes(context.app, propertyTypes);
	
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
		dataSourceProperties,
		formulaStrategy = 'hybrid',
		databasePropertyName = 'base'
	} = params;

	// Generate .base file content
	const baseContent = generateBaseFileContent({
		databaseName,
		dataSourceProperties,
		formulaStrategy,
		databasePropertyName
	});

	// Create or update .base file in the database folder (same level as database pages)
	const baseFilePath = normalizePath(`${databaseFolderPath}/${databaseName}.base`);

	// For incremental import: update existing .base file if it exists
	// Use adapter.exists for reliable check
	if (await vault.adapter.exists(baseFilePath)) {
		// Update existing .base file with latest database properties
		const existingFile = vault.getAbstractFileByPath(baseFilePath);
		if (existingFile instanceof TFile) {
			await vault.modify(existingFile, baseContent);
		}
		else {
			// File exists but not recognized as TFile, use adapter to write directly
			await vault.adapter.write(baseFilePath, baseContent);
		}
		return baseFilePath;
	}

	// File doesn't exist, create new one with unique name if needed
	const finalPath = getUniqueFilePath(vault, databaseFolderPath, `${databaseName}.base`);

	await vault.create(finalPath, baseContent);

	return finalPath;
}

/**
 * Generate content for .base file using BasesConfigFile structure
 */
function generateBaseFileContent(params: GenerateBaseFileContentParams): string {
	const {
		databaseName,
		dataSourceProperties,
		formulaStrategy = 'hybrid',
		databasePropertyName = 'base',
	} = params;

	// Map Notion properties to Obsidian properties
	const { formulas, regularProperties, titlePropertyName } = mapDatabaseProperties(dataSourceProperties, formulaStrategy);
	
	// Build the order array for views
	// Always use 'file.name' as the first column (it will display with custom displayName if set)
	const orderColumns = ['file.name'];
	for (const item of regularProperties) {
		orderColumns.push(item.key);
	}
	for (const item of formulas) {
		orderColumns.push(item.key);
	}

	// Build BasesConfigFile object
	const baseConfig: BasesConfigFile = {
		// Filter to include only pages that link to this .base file
		// Pages have a frontmatter property (e.g., "base") that contains [[database name.base]]
		filters: {
			and: [
				`note["${databasePropertyName}"] == link("${databaseName}.base")`
			]
		} as any
	};

	// Add formulas if there are any
	if (formulas.length > 0) {
		baseConfig.formulas = {};
		for (const item of formulas) {
			// Extract the formula name (remove "formula." prefix)
			const formulaName = item.key.replace(/^formula\./, '');
			baseConfig.formulas[formulaName] = item.config.formula;
		}
	}

	// Add properties if there are any
	if (regularProperties.length > 0 || titlePropertyName) {
		baseConfig.properties = {};

		// Add title property mapping: use file.name as key, set displayName to Notion's title column name
		if (titlePropertyName) {
			baseConfig.properties['file.name'] = {
				displayName: titlePropertyName
			};
		}

		for (const item of regularProperties) {
			baseConfig.properties[item.key] = {
				displayName: item.config.displayName
			};
			// Note: We don't write 'type' to .base file as it's redundant.
			// Property types are managed globally in .obsidian/types.json
		}
	}

	// Add default table view
	baseConfig.views = [{
		type: 'table',
		name: 'Table View',
		order: orderColumns
	}];

	// Convert to YAML with title comment
	return `# ${databaseName}\n\n${stringifyYaml(baseConfig)}`;
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
	dataSourceProperties: Record<string, any>,
	formulaStrategy: FormulaImportStrategy = 'hybrid'
): {
	formulas: Array<{ key: string, config: any }>;
	regularProperties: Array<{ key: string, config: any }>;
	titlePropertyName: string | null;
} {
	// Using 'any' for mappings because we're building a dynamic mapping of property configurations
	// which have different structures depending on the property type.
	const mappings: Record<string, any> = {};
	let titlePropertyName: string | null = null;

	// First pass: create mappings for all properties
	// Using 'any' in Object.entries cast because dataSourceProperties has dynamic keys and property types
	for (const [key, prop] of Object.entries(dataSourceProperties)) {
		const propType = prop.type;
		const propName = prop.name || key;

		// Map Notion property types to Obsidian property types
		// Only handle cases that require special processing
		switch (propType) {
			case 'title':
				// Save the title property name to use in column order
				// The title property corresponds to file.name in Obsidian, but we want to preserve the custom column name
				titlePropertyName = propName;
				break;
				
			case 'formula':
				// Handle formula based on import strategy
				const formulaExpression = getNotionFormulaExpression(prop.formula);

				if (formulaStrategy === 'static') {
					// Strategy 1: Static values only - add as regular property
					mappings[sanitizePropertyKey(key)] = {
						displayName: propName,
					};
				}
				else if (formulaStrategy === 'hybrid') {
					// Strategy 2: Hybrid - convert if possible, fallback to regular property
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
						// Cannot convert - add as regular property
						console.warn(`⚠️ Formula "${propName}" cannot be converted to Obsidian syntax, falling back to text property.`);
						console.warn(`   Original: ${formulaExpression}`);
						console.warn(`   Reason: Contains unsupported functions (e.g., substring, slice, split, format, etc.)`);
						mappings[sanitizePropertyKey(key)] = {
							displayName: propName,
						};
					}
				}
				break;

			case 'relation':
				// Relation properties will be stored as list of links in page YAML
				// Need to record special metadata for relation properties
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
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
		
			case 'button':
				// Button properties are UI elements, not data - skip them
				// Don't add to mappings
				break;
	
			default:
				// All other property types: just set displayName
				// Type information is managed in types.json, not in .base file
				mappings[sanitizePropertyKey(key)] = {
					displayName: propName,
				};
		}
	}

	// Separate formulas from regular properties
	// Note: Property order is based on Object.entries() iteration order
	// which in modern JavaScript (ES2015+) preserves insertion order for string keys
	// Using 'any' for config because property configurations have different structures by type
	const formulas: Array<{ key: string, config: any }> = [];
	const regularProperties: Array<{ key: string, config: any }> = [];

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

	return { formulas, regularProperties, titlePropertyName };
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
 * Extract property types that should be written to types.json
 * Maps all Notion property types to Obsidian property types following the same logic as mapDatabaseProperties
 * Returns a mapping of property name -> Obsidian type
 */
function extractPropertyTypesForTypesJson(
	dataSourceProperties: Record<string, any>,
	databasePages: Array<PageObjectResponse | PartialPageObjectResponse>
): Record<string, string> {
	const propertyTypes: Record<string, string> = {};
	
	for (const [key, prop] of Object.entries(dataSourceProperties)) {
		const propType = prop.type;
		const propName = prop.name || key;
		
		// Map Notion property types to Obsidian property types
		switch (propType) {
			case 'checkbox':
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.CHECKBOX;
				break;
			
			case 'date':
				// Check if this date property is a range (has both start and end)
				// If it's a range, treat as text (format: "start to end")
				// If single date, determine date vs datetime based on time information
				let hasRange = false;
				let hasTime = false;
				
				for (const page of databasePages) {
					const pageProps = (page as PageObjectResponse).properties;
					if (pageProps && pageProps[key]) {
						const dateProp = pageProps[key] as any;
						if (dateProp.type === 'date' && dateProp.date) {
							// Check if it's a range (has end date)
							if (dateProp.date.end) {
								hasRange = true;
								break; // Early exit - ranges are always text
							}
							
							// Check time information in start date
							if (dateProp.date.start && dateProp.date.start.includes('T')) {
								hasTime = true;
							}
						}
					}
				}
				
				if (hasRange) {
					// Date range is stored as text (format: "2024-01-01 to 2024-01-10")
					propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.TEXT;
				}
				else {
					// Single date: use datetime if has time, otherwise use date
					propertyTypes[propName] = hasTime ? OBSIDIAN_PROPERTY_TYPES.DATETIME : OBSIDIAN_PROPERTY_TYPES.DATE;
				}
				break;
			
			case 'number':
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.NUMBER;
				break;
			
			case 'select':
			case 'status':
				// Single select -> text in Obsidian
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.TEXT;
				break;
			
			case 'multi_select':
				// Multi-select -> multitext in Obsidian
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.MULTITEXT;
				break;
			
			case 'title':
				// Title property is handled as file.name, skip
				break;
			
			case 'rich_text':
			case 'url':
			case 'email':
			case 'phone_number':
				// Text-based properties
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.TEXT;
				break;
			
			case 'formula':
				// Skip formula properties:
				// - If converted to Obsidian formula: stored in .base file formulas section, not in YAML
				// - If fallback to static text: let Obsidian auto-infer the type
				break;
			
			case 'relation':
				// Relation properties -> multitext of links
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.MULTITEXT;
				break;
			
			case 'rollup':
				// Rollup properties are converted to formulas, skip them in types.json
				break;
			
			case 'people':
				// People property -> multitext of user names/emails
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.MULTITEXT;
				break;
			
			case 'files':
				// Files property -> multitext of attachment links
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.MULTITEXT;
				break;
			
			case 'created_time':
			case 'last_edited_time':
				// Timestamp properties - always include time
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.DATETIME;
				break;
			
			case 'created_by':
			case 'last_edited_by':
				// User properties -> single user name/email/id
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.TEXT;
				break;
			
			case 'button':
				// Button properties are UI elements, not data - skip them
				break;
			
			case 'place':
				// Place property -> multitext format
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.MULTITEXT;
				break;
			
			default:
				// Unsupported types -> text
				console.log(`Unsupported property type: ${propType}, treating as text`);
				propertyTypes[propName] = OBSIDIAN_PROPERTY_TYPES.TEXT;
		}
	}
	
	return propertyTypes;
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
	dataSourceProperties: Record<string, any>,
	relationPlaceholders: RelationPlaceholder[]
): Promise<void> {
	// Find all relation properties
	// Using 'any' because relation property configurations have complex nested structures
	const relationProperties: Record<string, any> = {};
	// Using 'any' in Object.entries cast because dataSourceProperties has dynamic keys
	for (const [key, prop] of Object.entries(dataSourceProperties)) {
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
 * Recursively find a block by ID in a block tree
 * @param blocks - Array of blocks to search
 * @param blockId - ID of the block to find
 * @param blocksCache - Optional cache of fetched blocks
 * @returns The block if found, null otherwise
 */
function findBlockById(
	blocks: BlockObjectResponse[],
	blockId: string,
	blocksCache?: Map<string, BlockObjectResponse[]>
): BlockObjectResponse | null {
	for (const block of blocks) {
		// Check if this is the block we're looking for
		if (block.id === blockId) {
			return block;
		}

		// Recursively search in children if block has children
		if (block.has_children) {
			// Try to get children from cache first
			let children: BlockObjectResponse[] = [];
			if (blocksCache && blocksCache.has(block.id)) {
				children = blocksCache.get(block.id)!;
			}

			// Search in children
			if (children.length > 0) {
				const found = findBlockById(children, blockId, blocksCache);
				if (found) {
					return found;
				}
			}
		}
	}

	return null;
}

/**
 * Process database placeholders in markdown content
 * Replace [[DATABASE_PLACEHOLDER:id]] with actual database references
 * @param markdownContent - Markdown content containing database placeholders
 * @param blocks - Array of blocks to search for database blocks (will search recursively)
 * @param context - Database processing context
 * @returns Processed markdown content with placeholders replaced
 */
export async function processDatabasePlaceholders(
	markdownContent: string,
	blocks: BlockObjectResponse[],
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

		// Find the corresponding block (recursively search in nested blocks)
		// This handles databases inside callouts, blockquotes, toggles, etc.
		const databaseBlock = findBlockById(blocks, databaseId, context.blocksCache);

		if (databaseBlock && databaseBlock.type === 'child_database') {
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
		else {
			// Database block not found - this shouldn't happen, but log it
			console.warn(`Database block not found for placeholder: ${databaseId}`);
		}
	}

	return processedContent;
}

