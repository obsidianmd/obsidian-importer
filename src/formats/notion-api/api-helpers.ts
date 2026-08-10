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
import { App, FrontMatterCache, Vault } from 'obsidian';
import { ImportContext } from '../../import-context';
import { i18n } from '../../i18n';
import { extractErrorMessage } from '../../util';

/**
 * What a block is called on screen. These are fixed block kinds, not anything
 * the source named, so each gets a string of its own — and because the record
 * is keyed by the union, adding a kind without a label will not compile.
 *
 * A label carries whatever article its language needs, since the sentence it
 * lands in cannot know the gender of the noun coming.
 */
const BLOCK_CONTEXT_LABELS: Record<BlockContext, () => string> = {
	'paragraph': () => i18n.importer.notionApi.blockParagraph(),
	'bulleted list item': () => i18n.importer.notionApi.blockBulletedListItem(),
	'numbered list item': () => i18n.importer.notionApi.blockNumberedListItem(),
	'to-do item': () => i18n.importer.notionApi.blockTodoItem(),
	'quote block': () => i18n.importer.notionApi.blockQuote(),
	'callout block': () => i18n.importer.notionApi.blockCallout(),
	'toggle block': () => i18n.importer.notionApi.blockToggle(),
	'toggleable heading': () => i18n.importer.notionApi.blockToggleableHeading(),
	'column': () => i18n.importer.notionApi.blockColumn(),
	'column_list': () => i18n.importer.notionApi.blockColumnList(),
	'table': () => i18n.importer.notionApi.blockTable(),
	'block': () => i18n.importer.notionApi.blockGeneric(),
};
import { canConvertFormula, getNotionFormulaExpression } from './formula-converter';
import { downloadAndFormatAttachment } from './attachment-helpers';
import { BlockContext, NotionAttachment } from './types';

const MAX_RETRIES = 3;

export interface NotionRequestError {
	code?: string;
	status?: number;
	headers?: Record<string, string>;
}

/**
 * Failures worth asking again about.
 *
 * A rate limit says so outright. The rest are Notion having a bad moment - a
 * gateway timing out, a data source taking longer to render than the API is
 * willing to wait - and an import large enough to meet them will meet them a
 * few hundred times. Giving up on the first one loses a page that would have
 * arrived on the second.
 *
 * Everything else (a 404, a permission the token does not have, a malformed
 * request) means the same thing however many times it is asked.
 */
const RETRYABLE_CODES = new Set([
	'rate_limited',
	'service_overload',
	'internal_server_error',
	'service_unavailable',
	'gateway_timeout',
	'notionhq_client_request_timeout',
	'notionhq_client_response_error',
]);

/**
 * Notion sometimes says outright that a failure is worth another try - a
 * database large enough to run past what the API will spend rendering it comes
 * back with "Retry with exponential backoff" and a status that says nothing.
 */
const ASKS_TO_RETRY = /retry with exponential backoff/i;

function isRetryable(error: NotionRequestError): boolean {
	if (error.status !== undefined && error.status >= 500) return true;
	if (error.status === 429 || error.status === 408) return true;
	if (error.code !== undefined && RETRYABLE_CODES.has(error.code)) return true;

	return ASKS_TO_RETRY.test(extractErrorMessage(error) ?? '');
}

/** How long to wait before asking again, in seconds. */
function retryDelay(error: NotionRequestError, retryCount: number): number {
	const retryAfter = error.headers?.['retry-after'] ?? error.headers?.['Retry-After'];
	const asked = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;

	// Exponential backoff otherwise: 1s, 2s, 4s
	return Number.isFinite(asked) && asked > 0 ? asked : Math.pow(2, retryCount);
}

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
	errorContext?: BlockContext;
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
		const context: BlockContext = errorContext || 'block';
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`Failed to fetch children for ${context} ${block.id}:`, error);
		ctx.reportFailed(
			i18n.importer.notionApi.labelFetchChildren({
				context: BLOCK_CONTEXT_LABELS[context](),
				id: block.id,
			}),
			errorMsg
		);
		return undefined;
	}
}

/**
 * Wrapper for Notion API calls that asks again when the failure was Notion's
 * rather than the request's, backing off between tries.
 */
export async function makeNotionRequest<T>(
	requestFn: () => Promise<T>,
	ctx: ImportContext,
	retryCount: number = 0
): Promise<T> {
	try {
		return await requestFn();
	}
	catch (e) {
		const error = e as NotionRequestError;
		if (!isRetryable(error)) throw e;

		const rateLimited = error.code === 'rate_limited' || error.status === 429;

		if (retryCount >= MAX_RETRIES) {
			// Say what it kept failing with, not just that it kept failing:
			// this is the line the import log ends up showing.
			throw new Error(rateLimited
				? i18n.importer.notionApi.reasonRateLimitGaveUp({ retries: MAX_RETRIES })
				: i18n.importer.notionApi.reasonGaveUp({
					reason: extractErrorMessage(e) ?? String(error.status ?? error.code),
					retries: MAX_RETRIES,
				}));
		}

		const waitFor = retryDelay(error, retryCount);
		const previousStatus = ctx.statusMessage;

		// Two whole sentences rather than one with the cause dropped into it:
		// a status naming a number needs its own wording in every language.
		ctx.status(rateLimited
			? i18n.importer.notionApi.statusRateLimited({
				seconds: waitFor,
				attempt: retryCount + 1,
				total: MAX_RETRIES,
			})
			: i18n.importer.notionApi.statusRetrying({
				status: String(error.status ?? error.code),
				seconds: waitFor,
				attempt: retryCount + 1,
				total: MAX_RETRIES,
			}));

		await new Promise(resolve => window.setTimeout(resolve, waitFor * 1000));

		if (await ctx.shouldStop()) throw e;

		ctx.status(previousStatus);

		return makeNotionRequest(requestFn, ctx, retryCount + 1);
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
		const response = await makeNotionRequest(
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
				ctx.reportFailed(i18n.importer.notionApi.labelFetchChildrenBlock({ id: block.id }), errorMsg);
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
 * @param formulaStrategy - How to handle formula properties ('static', 'hybrid')
 * @param databaseProperties - Database property schema (for checking if formulas can be converted)
 */
/**
 * Parameters for extractFrontMatter function
 */
export interface ExtractFrontMatterParams {
	page: PageObjectResponse;
	formulaStrategy?: 'static' | 'hybrid';
	databaseProperties?: any;
	client?: Client;
	ctx?: ImportContext;
	// Parameters for downloading file attachments
	vault?: Vault;
	app?: App;
	currentFilePath?: string;
	currentFolderPath?: string;
	downloadExternalAttachments?: boolean;
	incrementalImport?: boolean;
	onAttachmentDownloaded?: (filename: string) => void;
	getAvailableAttachmentPath?: (filename: string) => Promise<string>;
}

/**
 * Extract frontmatter from a Notion page
 * @param params - Parameters object
 * @returns Using 'any' for values because page properties can be of many different types
 */
export async function extractFrontMatter(
	params: ExtractFrontMatterParams
): Promise<FrontMatterCache> {
	const {
		page,
		formulaStrategy = 'hybrid',
		databaseProperties,
		client,
		ctx
	} = params;
	// Using 'any' for frontMatter values because page properties have many different types
	const frontMatter: FrontMatterCache = {
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

		// Handle people properties with user lookup
		if (prop.type === 'people' && client && ctx) {
			const value = await mapPeoplePropertyToFrontmatter(prop, client, ctx);
			if (value !== null && value !== undefined) {
				frontMatter[key] = value;
			}
			continue;
		}

		// Handle files properties - download attachments
		if (prop.type === 'files' && params.vault && params.app && ctx) {
			const value = await mapFilesPropertyToFrontmatter(prop, params);
			if (value !== null && value !== undefined) {
				frontMatter[key] = value;
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
 * Map a people property to frontmatter value with user lookup
 * Fetches full user information and returns only names
 * Note: YAML frontmatter doesn't support markdown syntax, so we only store the name
 * Email links are preserved in content mentions (user @mentions in text)
 * @param prop - People property from Notion page
 * @param client - Notion client for API calls
 * @param ctx - Import context for status updates
 * @returns Array of user names
 */
async function mapPeoplePropertyToFrontmatter(
	prop: any,
	client: Client,
	ctx: ImportContext
): Promise<string[]> {
	if (!prop.people || !Array.isArray(prop.people)) {
		return [];
	}

	const results: string[] = [];

	for (const person of prop.people) {
		// If person has full info (name), use it directly
		if (person.name) {
			results.push(person.name);
		}
		// If only has ID, fetch full user info
		else if (person.object === 'user' && person.id) {
			try {
				const user = await makeNotionRequest(
					() => client.users.retrieve({ user_id: person.id }),
					ctx
				);

				if (user && 'name' in user) {
					const userName = user.name || user.id;
					results.push(userName);
				}
				else {
					// Fallback to ID
					results.push(person.id);
				}
			}
			catch (error) {
				console.warn(`Failed to fetch user ${person.id}:`, error);
				// Fallback to ID
				results.push(person.id);
			}
		}
		else {
			// Fallback to ID
			results.push(person.id);
		}
	}

	return results;
}

/**
 * Map files property to frontmatter value by downloading attachments
 * @param prop - Files property from Notion
 * @param params - Extract frontmatter parameters containing vault, app, etc.
 * @returns Array of Obsidian links to downloaded files, or null if no files
 */
async function mapFilesPropertyToFrontmatter(
	prop: any,
	params: ExtractFrontMatterParams
): Promise<string[] | null> {
	if (!prop.files || prop.files.length === 0) {
		return null;
	}

	const { vault, app, ctx, currentFilePath, currentFolderPath, incrementalImport, onAttachmentDownloaded, getAvailableAttachmentPath } = params;

	if (!vault || !app || !ctx) {
		// Fallback to URL if we don't have required parameters
		return prop.files.map((f: any) => {
			if (f.type === 'file') return f.file?.url || '';
			if (f.type === 'external') return f.external?.url || '';
			return '';
		}).filter((url: string) => url);
	}

	const results: string[] = [];

	for (const file of prop.files) {
		try {
			// Extract attachment info
			let attachment: NotionAttachment | null = null;

			if (file.type === 'file' && file.file?.url) {
				attachment = {
					type: 'file',
					url: file.file.url,
					name: file.name
				};
			}
			else if (file.type === 'external' && file.external?.url) {
				attachment = {
					type: 'external',
					url: file.external.url,
					name: file.name
				};
			}

			if (!attachment) continue;

			// Download and format the attachment
			// Files property attachments are always downloaded, regardless of downloadExternalAttachments setting
			// This is consistent with how cover images are handled
			const link = await downloadAndFormatAttachment(
				attachment,
				{
					vault,
					app,
					ctx,
					currentFilePath,
					currentFolderPath,
					downloadExternalAttachments: true,  // Always download files property attachments
					incrementalImport: incrementalImport || false,
					onAttachmentDownloaded,
					getAvailableAttachmentPath
				},
				{
					isEmbed: false,
					fallbackText: attachment.name || 'file',
					forceWikiLink: true  // Force wiki links for YAML compatibility
				}
			);
			results.push(link);
		}
		catch (error) {
			console.error('Failed to download file attachment:', error);
			// Fallback to URL on error
			if (file.type === 'file' && file.file?.url) {
				results.push(file.file.url);
			}
			else if (file.type === 'external' && file.external?.url) {
				results.push(file.external.url);
			}
		}
	}

	return results.length > 0 ? results : null;
}

/**
 * Convert Notion date string (ISO 8601) to Obsidian format
 * - If date only (YYYY-MM-DD): keep as is
 * - If datetime (ISO 8601 with time): convert to YYYY-MM-DDTHH:mm:ss
 * @param dateString - Notion date string (e.g., "2025-11-23" or "2025-11-23T09:00:00.000+08:00")
 * @returns Obsidian-compatible date/datetime string
 */
function convertNotionDateToObsidian(dateString: string): string {
	// Check if it's a date-only format (YYYY-MM-DD)
	if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
		return dateString;
	}

	// It's a datetime, parse and convert to Obsidian format
	// Notion uses ISO 8601: 2025-11-23T09:00:00.000+08:00
	// Obsidian uses: 2025-11-23T09:00:00 (no milliseconds, no timezone)
	try {
		const date = new Date(dateString);
		// Format as YYYY-MM-DDTHH:mm:ss
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');

		return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
	}
	catch (error) {
		// If parsing fails, return original string
		console.warn(`Failed to parse date: ${dateString}`, error);
		return dateString;
	}
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

		case 'date': {
			if (!prop.date) return null;
			// Convert Notion date format (ISO 8601) to Obsidian format
			// Date only: YYYY-MM-DD (keep as is)
			// Datetime: YYYY-MM-DDTHH:mm:ss (convert from ISO 8601)
			// For date ranges, use "start to end" format as text
			const startDate = convertNotionDateToObsidian(prop.date.start);
			if (prop.date.end) {
				const endDate = convertNotionDateToObsidian(prop.date.end);
				return `${startDate} to ${endDate}`;
			}
			return startDate;
		}

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
			// Convert people to names, fallback to email, then id
			// Priority: name > email > id
			return prop.people?.map((p: UserObjectResponse) => {
				if (p.name) return p.name;
				if (p.type === 'person' && p.person?.email) return p.person.email;
				return p.id;
			}) || [];

		case 'files':
			// Convert files to URLs
			// Using 'any' because file items can be internal or external with different structures
			return prop.files?.map((f: any) => {
				if (f.type === 'file') return f.file?.url || '';
				if (f.type === 'external') return f.external?.url || '';
				return '';
			}).filter((url: string) => url) || [];

		case 'formula': {
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
			// Convert Notion timestamp to Obsidian datetime format
			return prop.created_time ? convertNotionDateToObsidian(prop.created_time) : null;

		case 'created_by':
			// Extract user info with priority: name > email > id
			if (prop.created_by?.name) return prop.created_by.name;
			if (prop.created_by?.type === 'person' && prop.created_by.person?.email) {
				return prop.created_by.person.email;
			}
			return prop.created_by?.id || null;

		case 'last_edited_time':
			// Convert Notion timestamp to Obsidian datetime format
			return prop.last_edited_time ? convertNotionDateToObsidian(prop.last_edited_time) : null;

		case 'last_edited_by':
			// Extract user info with priority: name > email > id
			if (prop.last_edited_by?.name) return prop.last_edited_by.name;
			if (prop.last_edited_by?.type === 'person' && prop.last_edited_by.person?.email) {
				return prop.last_edited_by.person.email;
			}
			return prop.last_edited_by?.id || null;

		case 'unique_id':
			// Unique ID property
			if (prop.unique_id?.prefix) {
				return `${prop.unique_id.prefix}-${prop.unique_id.number}`;
			}
			return prop.unique_id?.number || null;

		case 'verification':
			// Verification property
			return prop.verification?.state || null;

		case 'button':
			// Button properties are UI elements, not data - ignore them
			return null;

		case 'place':
			// Place property - convert to Obsidian Maps format: [lat, lon]
			if (prop.place?.lat != null && prop.place?.lon != null) {
				return [String(prop.place.lat), String(prop.place.lon)];
			}
			return null;

		default:
			// For unknown types, try to convert to string
			return String(prop[prop.type] || '');
	}
}

