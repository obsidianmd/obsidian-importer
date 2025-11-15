/**
 * API helper functions for Notion API importer
 * Handles API calls with rate limiting and error handling
 */

import { 
	Client, 
	BlockObjectResponse, 
	PageObjectResponse,
	DatabaseObjectResponse,
	RichTextItemResponse,
	UserObjectResponse,
	PartialBlockObjectResponse
} from '@notionhq/client';
import { ImportContext } from '../../main';
import { canConvertFormula, getNotionFormulaExpression } from './formula-converter';

const MAX_RETRIES = 3;

/**
 * Get children blocks for a block, using cache if available
 * This is a common pattern used throughout the codebase
 * 
 * @param blockId - The ID of the parent block
 * @param client - Notion API client
 * @param ctx - Import context for cancellation and error reporting
 * @param blocksCache - Optional cache to store/retrieve children
 * @returns Array of child blocks, or empty array if block has no children
 */
export async function getBlockChildren(
	blockId: string,
	client: Client,
	ctx: ImportContext,
	blocksCache?: Map<string, BlockObjectResponse[]>
): Promise<BlockObjectResponse[]> {
	// Try to get from cache first
	let children = blocksCache?.get(blockId);
	
	if (!children) {
		// Not in cache, fetch from API
		children = await fetchAllBlocks(client, blockId, ctx);
		
		// Store in cache if cache is provided
		if (blocksCache) {
			blocksCache.set(blockId, children);
		}
	}
	
	return children;
}

/**
 * Parameters for processBlockChildren function
 */
export interface ProcessBlockChildrenParams<T> {
	block: BlockObjectResponse;
	client: Client;
	ctx: ImportContext;
	blocksCache?: Map<string, BlockObjectResponse[]>;
	processor: (children: BlockObjectResponse[]) => Promise<T> | T;
	errorContext?: string;
}

/**
 * Process children blocks if they exist, with automatic error handling
 * This encapsulates the common pattern of checking has_children, fetching, and processing
 * 
 * @param params - Parameters object containing:
 *   - block: The parent block to check for children
 *   - client: Notion API client
 *   - ctx: Import context for cancellation and error reporting
 *   - blocksCache: Optional cache to store/retrieve children
 *   - processor: Callback function to process the children blocks
 *   - errorContext: Optional context string for error messages (e.g., "bulleted list item")
 * @returns The result from the processor callback, or undefined if no children or error occurred
 */
export async function processBlockChildren<T>(
	params: ProcessBlockChildrenParams<T>
): Promise<T | undefined> {
	const { block, client, ctx, blocksCache, processor, errorContext } = params;
	
	if (!block.has_children) {
		return undefined;
	}
	
	try {
		const children = await getBlockChildren(block.id, client, ctx, blocksCache);
		
		if (children.length === 0) {
			return undefined;
		}
		
		return await processor(children);
	}
	catch (error) {
		const context = errorContext || 'block';
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`Failed to fetch children for ${context} ${block.id}:`, error);
		ctx.reportFailed(`Fetch children for ${context} ${block.id}`, errorMsg);
		return undefined;
	}
}

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
	// Using 'any' for error because we need to access error.code and error.status properties
	// which may or may not exist depending on the error type (Notion API error vs generic error).
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
		// Using 'any' for response because Notion API returns a paginated response with complex structure
		// and we only need to access .results, .has_more, and .next_cursor properties.
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
			(block: BlockObjectResponse | PartialBlockObjectResponse): block is BlockObjectResponse => 'type' in block
		);
		
		blocks.push(...fullBlocks);
		cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
		
	} while (cursor);
	
	return blocks;
}

/**
 * Recursively check if a page has any child pages or databases
 * This includes checking nested blocks (e.g., pages inside toggles, lists, etc.)
 * @param client - Notion client
 * @param blocks - Blocks to check
 * @param ctx - Import context
 * @param blocksCache - Optional cache to store fetched blocks and avoid duplicate API calls
 */
export async function hasChildPagesOrDatabases(
	client: Client,
	blocks: BlockObjectResponse[],
	ctx: ImportContext,
	blocksCache?: Map<string, BlockObjectResponse[]>
): Promise<boolean> {
	for (const block of blocks) {
		// Check if current block is a child_page
		if (block.type === 'child_page') {
			return true;
		}
		
		// Check if current block is a child_database
		// But we need to verify it's not a linked database (which we skip)
		if (block.type === 'child_database') {
			try {
				// Try to retrieve the database to check if it's a linked database
				const database = await makeNotionRequest(
					() => client.databases.retrieve({ database_id: block.id }) as Promise<DatabaseObjectResponse>,
					ctx
				);
				
				// Check if this is a linked database (no data sources)
				// Linked databases are not supported and will be skipped during import
				if (database.data_sources && database.data_sources.length > 0) {
					// This is a real database, not a linked one
					return true;
				}
				// Otherwise, it's a linked database - continue checking other blocks
			}
			catch (error) {
				// If we can't retrieve the database, assume it's inaccessible and skip it
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.warn(`[hasChildPagesOrDatabases] Failed to check database ${block.id}, skipping:`, errorMsg);
				// Continue checking other blocks
			}
		}
		
		// Recursively check nested blocks if this block has children
		if (block.has_children) {
			try {
				const children = await getBlockChildren(block.id, client, ctx, blocksCache);
			
				if (children.length > 0) {
					const hasChildrenInNested = await hasChildPagesOrDatabases(client, children, ctx, blocksCache);
					if (hasChildrenInNested) {
						return true;
					}
				}
			}
			catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error(`Failed to fetch children for block ${block.id}:`, error);
				ctx.reportFailed(`Fetch children for block ${block.id}`, errorMsg);
			// Continue checking other blocks even if one fails
			}
		}
	}
	
	return false;
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
/**
 * @param databaseProperties - Using 'any' because database property schema has many variants
 * @returns Using 'any' for values because page properties can be of many different types
 */
export function extractFrontMatter(
	page: PageObjectResponse, 
	formulaStrategy: 'static' | 'function' | 'hybrid' = 'function',
	databaseProperties?: any
): Record<string, any> {
	// Using 'any' for frontMatter values because page properties have many different types
	const frontMatter: Record<string, any> = {
		'notion-id': page.id,
	};
	
	// Note: created_time and last_edited_time are not added to frontmatter
	// Users can enable these if needed by uncommenting the code below
	// if (page.created_time) {
	// 	frontMatter.created = page.created_time;
	// }
	// if (page.last_edited_time) {
	// 	frontMatter.updated = page.last_edited_time;
	// }
	
	// Add cover if present (will be processed as attachment later)
	if (page.cover) {
		frontMatter.cover = extractCoverUrl(page.cover);
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
 * Extract cover URL from page cover object
 * Extract the type from PageObjectResponse['cover'] since PageCoverResponse is not exported
 */
function extractCoverUrl(cover: PageObjectResponse['cover']): string | null {
	if (!cover) return null;
	
	if (cover.type === 'external' && cover.external?.url) {
		return cover.external.url;
	}
	else if (cover.type === 'file' && cover.file?.url) {
		return cover.file.url;
	}
	
	return null;
}

/**
 * Determine if a formula property should be added to page YAML
 * Based on the import strategy and whether the formula can be converted
 */
/**
 * Check if a formula property should be added to YAML frontmatter
 * @param databaseProperties - Using 'any' because database property schema has many variants
 */
function shouldAddFormulaToYAML(
	propertyKey: string,
	databaseProperties: any,
	strategy: 'static' | 'function' | 'hybrid'
): boolean {
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
 * @param prop - Using 'any' because PageObjectResponse['properties'][string] is a large union type
 *               and TypeScript cannot properly narrow types in the switch statement
 * @returns Using 'any' because the return value type depends on the property type
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
			return prop.multi_select?.map((s: { name: string }) => s.name) || [];
		
		case 'status':
			return prop.status?.name || null;
		
		case 'date':
			if (!prop.date) return null;
			// Return date/datetime with optional end date (range)
			// Note: Both date and datetime use the same format for now
			// TODO: Consider using different Obsidian property types for date vs datetime
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
			return prop.rich_text?.map((t: RichTextItemResponse) => t.plain_text).join('') || '';
		
		case 'people':
			// Convert people to names or emails
			return prop.people?.map((p: UserObjectResponse) => {
				if (p.type === 'person' && p.person?.email) {
					return p.person.email;
				}
				return p.name || p.id;
			}) || [];
		
		case 'files':
			// Convert files to URLs
			// Using 'any' because file items can be internal or external with different structures
			return prop.files?.map((f: any) => {
				if (f.type === 'file') return f.file?.url || '';
				if (f.type === 'external') return f.external?.url || '';
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
			return prop.relation?.map((r: { id: string }) => r.id) || [];
		
		case 'rollup':
			// Rollup properties should NOT be included in page YAML
			// They will be calculated dynamically in the .base file as formulas
			// Skip adding rollup to frontmatter
			return null;
		
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

