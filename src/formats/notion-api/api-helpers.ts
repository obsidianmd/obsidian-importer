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
 */
export function extractFrontMatter(page: PageObjectResponse): Record<string, any> {
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
	
	return frontMatter;
}

