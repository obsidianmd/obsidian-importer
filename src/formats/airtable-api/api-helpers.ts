/**
 * API helpers for Airtable integration
 */

import { requestUrl } from 'obsidian';
import { ImportContext } from '../../main';
import Airtable from 'airtable';
import type { AirtableBaseInfo, AirtableTableInfo } from './types';

/**
 * Airtable Meta API base URL
 */
const AIRTABLE_META_API_BASE = 'https://api.airtable.com/v0/meta';

/**
 * Rate limit configuration for Meta API requests
 * 
 * Airtable limits:
 * - Data API: 5 requests/second per base (handled by SDK with built-in retry)
 * - Meta API: Unknown exact limit, but less strict than Data API
 * 
 * We use a conservative 50ms delay for Meta API calls (bases/tables schema)
 * to balance user experience with API limits. If 429 occurs, we'll wait 30s as required.
 */
const RATE_LIMIT_DELAY = 50; // milliseconds between Meta API requests
let lastRequestTime = 0;

/**
 * Wait for rate limit if necessary
 */
async function waitForRateLimit(): Promise<void> {
	const now = Date.now();
	const timeSinceLastRequest = now - lastRequestTime;
	
	if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
		const waitTime = RATE_LIMIT_DELAY - timeSinceLastRequest;
		await new Promise(resolve => setTimeout(resolve, waitTime));
	}
	
	lastRequestTime = Date.now();
}

/**
 * Make a rate-limited request to Airtable API
 */
export async function makeAirtableRequest<T>(
	url: string,
	token: string,
	ctx: ImportContext,
	method: 'GET' | 'POST' = 'GET',
	body?: any
): Promise<T> {
	await waitForRateLimit();
	
	try {
		const response = await requestUrl({
			url,
			method,
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: body ? JSON.stringify(body) : undefined,
			throw: false,
		});
		
		if (response.status === 429) {
			// Rate limited - Airtable requires 30 second wait per official docs
			// https://airtable.com/developers/web/api/rate-limits
			const retryAfter = response.headers?.['retry-after'] 
				? parseInt(response.headers['retry-after']) * 1000 
				: 30000; // Default 30 seconds as per Airtable docs
			
			ctx.status(`Rate limited, waiting ${retryAfter / 1000}s...`);
			await new Promise(resolve => setTimeout(resolve, retryAfter));
			return makeAirtableRequest(url, token, ctx, method, body);
		}
		
		if (response.status >= 400) {
			const errorText = response.text || `HTTP ${response.status}`;
			throw new Error(`Airtable API error: ${errorText}`);
		}
		
		return response.json as T;
	}
	catch (error) {
		console.error('Airtable API request failed:', error);
		throw error;
	}
}

/**
 * Fetch all bases accessible to the user
 */
export async function fetchBases(
	token: string,
	ctx: ImportContext
): Promise<AirtableBaseInfo[]> {
	ctx.status('Fetching bases...');
	
	const response = await makeAirtableRequest<{ bases: AirtableBaseInfo[] }>(
		`${AIRTABLE_META_API_BASE}/bases`,
		token,
		ctx
	);
	
	return response.bases || [];
}

/**
 * Fetch table schema for a base
 */
export async function fetchTableSchema(
	baseId: string,
	token: string,
	ctx: ImportContext
): Promise<AirtableTableInfo[]> {
	ctx.status(`Fetching tables for base ${baseId}...`);
	
	const response = await makeAirtableRequest<{ tables: AirtableTableInfo[] }>(
		`${AIRTABLE_META_API_BASE}/bases/${baseId}/tables`,
		token,
		ctx
	);
	
	return response.tables || [];
}

/**
 * Fetch records from a table with pagination
 */
export async function fetchAllRecords(
	baseId: string,
	tableIdOrName: string,
	token: string,
	ctx: ImportContext,
	viewId?: string
): Promise<any[]> {
	const base = new Airtable({ apiKey: token }).base(baseId);
	
	const records: any[] = [];
	
	try {
		const selectOptions: any = {
			// pageSize: 100, // Max page size
		};
		
		if (viewId) {
			selectOptions.view = viewId;
		}
		
		await base(tableIdOrName)
			.select(selectOptions)
			.eachPage((pageRecords: any[], fetchNextPage: () => void) => {
				records.push(...pageRecords);
				
				// Update progress
				ctx.status(`Fetched ${records.length} records...`);
				
				// Fetch next page
				fetchNextPage();
			});
	}
	catch (error) {
		console.error(`Failed to fetch records from table ${tableIdOrName}:`, error);
		throw error;
	}
	
	return records;
}

/**
 * Fetch a single record by ID
 */
export async function fetchRecord(
	baseId: string,
	tableIdOrName: string,
	recordId: string,
	token: string,
	ctx: ImportContext
): Promise<any> {
	const base = new Airtable({ apiKey: token }).base(baseId);
	
	try {
		const record = await base(tableIdOrName).find(recordId);
		return record;
	}
	catch (error) {
		console.error(`Failed to fetch record ${recordId}:`, error);
		throw error;
	}
}

