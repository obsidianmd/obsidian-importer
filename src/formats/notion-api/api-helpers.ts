/**
 * API helper functions for Notion API importer
 * Handles API calls with rate limiting and error handling
 */

import { Client, BlockObjectResponse, PageObjectResponse } from '@notionhq/client';
import { ImportContext } from '../../main';

const MAX_RETRIES = 3;

/**
 * Wrapper for Notion API calls with rate limit handling
 * Automatically retries on 429 errors with exponential backoff
 */
export async function makeNotionRequest<T>(
	requestFn: () => Promise<T>,
	ctx: ImportContext,
	retryCount: number = 0
): Promise<T> {
	try {
		return await requestFn();
	}
	catch (error: any) {
		// Handle rate limiting (429 error)
		if (error.code === 'rate_limited' || error.status === 429) {
			if (retryCount >= MAX_RETRIES) {
				throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries`);
			}
			
			// Get retry delay from Retry-After header or use exponential backoff
			let retryAfter = 1;
			if (error.headers && error.headers['retry-after']) {
				retryAfter = parseInt(error.headers['retry-after'], 10);
			}
			else {
				// Exponential backoff: 1s, 2s, 4s
				retryAfter = Math.pow(2, retryCount);
			}
			
			const previousStatus = ctx.statusMessage;
			ctx.status(`Rate limited. Waiting ${retryAfter} seconds before retry (${retryCount + 1}/${MAX_RETRIES})...`);
			
			await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
			
			ctx.status(previousStatus);
			
			// Retry the request
			return makeNotionRequest(requestFn, ctx, retryCount + 1);
		}
		
		// Re-throw other errors
		throw error;
	}
}

/**
 * Fetch all blocks from a page with pagination and rate limit handling
 */
export async function fetchAllBlocks(
	client: Client,
	blockId: string, 
	ctx: ImportContext
): Promise<BlockObjectResponse[]> {
	const blocks: BlockObjectResponse[] = [];
	let cursor: string | undefined = undefined;
	
	do {
		const response: any = await makeNotionRequest(
			() => client.blocks.children.list({
				block_id: blockId,
				start_cursor: cursor,
				page_size: 100,
			}),
			ctx
		);
		
		// Filter out partial blocks
		const fullBlocks = response.results.filter(
			(block: any): block is BlockObjectResponse => 'type' in block
		);
		
		blocks.push(...fullBlocks);
		cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
		
	} while (cursor);
	
	return blocks;
}

/**
 * Extract page title from Notion page object
 */
export function extractPageTitle(page: PageObjectResponse): string {
	const properties = page.properties;
	
	// Try to find title property
	for (const key in properties) {
		const prop = properties[key];
		if (prop.type === 'title' && prop.title.length > 0) {
			return prop.title.map(t => t.plain_text).join('');
		}
	}
	
	return 'Untitled';
}

/**
 * Extract frontmatter from Notion page
 * This includes the notion-id, timestamps, and all page properties
 * @param page - The Notion page object
 * @param formulaStrategy - How to handle formula properties ('static', 'function', 'hybrid')
 * @param databaseProperties - Database property schema (for checking if formulas can be converted)
 */
export function extractFrontMatter(
	page: PageObjectResponse, 
	formulaStrategy: 'static' | 'function' | 'hybrid' = 'function',
	databaseProperties?: any
): Record<string, any> {
	const frontMatter: Record<string, any> = {
		'notion-id': page.id,
	};
	
	// Add created and last edited time
	if (page.created_time) {
		frontMatter.created = page.created_time;
	}
	if (page.last_edited_time) {
		frontMatter.updated = page.last_edited_time;
	}
	
	// Extract all page properties
	const properties = page.properties;
	for (const key in properties) {
		const prop = properties[key];
		
		// Skip title property (already used as filename)
		if (prop.type === 'title') {
			continue;
		}
		
		// Handle formula properties based on strategy
		if (prop.type === 'formula') {
			const shouldAddToYAML = shouldAddFormulaToYAML(
				key,
				databaseProperties,
				formulaStrategy
			);
			
			if (shouldAddToYAML) {
				const value = mapNotionPropertyToFrontmatter(prop);
				if (value !== null && value !== undefined) {
					frontMatter[key] = value;
				}
			}
			continue;
		}
		
		// Map property to frontmatter value
		const value = mapNotionPropertyToFrontmatter(prop);
		if (value !== null && value !== undefined) {
			frontMatter[key] = value;
		}
	}
	
	return frontMatter;
}

/**
 * Determine if a formula property should be added to page YAML
 * Based on the import strategy and whether the formula can be converted
 */
function shouldAddFormulaToYAML(
	propertyKey: string,
	databaseProperties: any,
	strategy: 'static' | 'function' | 'hybrid'
): boolean {
	// Import formula-converter functions
	const { canConvertFormula, getNotionFormulaExpression } = require('./formula-converter');
	
	if (strategy === 'static') {
		// Always add to YAML for static strategy
		return true;
	}
	
	if (strategy === 'function') {
		// Never add to YAML for function strategy (will be in base formulas)
		return false;
	}
	
	// Hybrid strategy: add to YAML only if cannot be converted
	if (databaseProperties && databaseProperties[propertyKey]) {
		const formulaExpression = getNotionFormulaExpression(databaseProperties[propertyKey].formula);
		if (formulaExpression && canConvertFormula(formulaExpression)) {
			// Can be converted, don't add to YAML
			return false;
		}
	}
	
	// Cannot be converted or no database properties, add to YAML
	return true;
}

/**
 * Map a Notion property to a frontmatter value
 * Handles all Notion property types and converts them to Obsidian-compatible values
 */
function mapNotionPropertyToFrontmatter(prop: any): any {
	switch (prop.type) {
		case 'number':
			return prop.number;
		
		case 'checkbox':
			return prop.checkbox;
		
		case 'select':
			return prop.select?.name || null;
		
		case 'multi_select':
			return prop.multi_select?.map((s: any) => s.name) || [];
		
		case 'status':
			return prop.status?.name || null;
		
		case 'date':
			if (!prop.date) return null;
			// If has time component, use datetime format
			if (prop.date.start && prop.date.start.length > 10) {
				return prop.date.end 
					? `${prop.date.start} to ${prop.date.end}`
					: prop.date.start;
			}
			// Otherwise use date format
			return prop.date.end 
				? `${prop.date.start} to ${prop.date.end}`
				: prop.date.start;
		
		case 'email':
			return prop.email;
		
		case 'url':
			return prop.url;
		
		case 'phone_number':
			return prop.phone_number;
		
		case 'rich_text':
			// Convert rich text to plain text
			return prop.rich_text?.map((t: any) => t.plain_text).join('') || '';
		
		case 'people':
			// Convert people to names or emails
			return prop.people?.map((p: any) => {
				if (p.type === 'person' && p.person?.email) {
					return p.person.email;
				}
				return p.name || p.id;
			}) || [];
		
		case 'files':
			// Convert files to URLs
			return prop.files?.map((f: any) => {
				if (f.type === 'file') {
					return f.file?.url || '';
				} else if (f.type === 'external') {
					return f.external?.url || '';
				}
				return '';
			}).filter((url: string) => url) || [];
		
		case 'formula':
			// Extract formula result value
			if (!prop.formula) return null;
			const formulaResult = prop.formula;
			switch (formulaResult.type) {
				case 'string':
					return formulaResult.string;
				case 'number':
					return formulaResult.number;
				case 'boolean':
					return formulaResult.boolean;
				case 'date':
					return formulaResult.date?.start || null;
				default:
					return null;
			}
		
	case 'relation':
		// Relation properties contain page IDs
		// We'll store the IDs temporarily and replace them with links later
		if (prop.relation && prop.relation.length > 0) {
			return prop.relation.map((r: any) => r.id);
		}
		return [];
		
		case 'rollup':
			// Rollup properties aggregate values, extract the result
			if (!prop.rollup) return null;
			const rollupResult = prop.rollup;
			switch (rollupResult.type) {
				case 'number':
					return rollupResult.number;
				case 'date':
					return rollupResult.date?.start || null;
				case 'array':
					return rollupResult.array?.length || 0;
				default:
					return null;
			}
		
		case 'created_time':
			return prop.created_time;
		
		case 'created_by':
			// Extract user info
			if (prop.created_by?.type === 'person' && prop.created_by.person?.email) {
				return prop.created_by.person.email;
			}
			return prop.created_by?.name || prop.created_by?.id || null;
		
		case 'last_edited_time':
			return prop.last_edited_time;
		
		case 'last_edited_by':
			// Extract user info
			if (prop.last_edited_by?.type === 'person' && prop.last_edited_by.person?.email) {
				return prop.last_edited_by.person.email;
			}
			return prop.last_edited_by?.name || prop.last_edited_by?.id || null;
		
		case 'unique_id':
			// Unique ID property
			if (prop.unique_id?.prefix) {
				return `${prop.unique_id.prefix}-${prop.unique_id.number}`;
			}
			return prop.unique_id?.number || null;
		
		case 'verification':
			// Verification property
			return prop.verification?.state || null;
		
		default:
			// For unknown types, try to convert to string
			return String(prop[prop.type] || '');
	}
}

