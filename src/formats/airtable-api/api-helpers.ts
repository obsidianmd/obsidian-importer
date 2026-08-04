/**
 * API helpers for Airtable integration
 */

import { requestUrl } from 'obsidian';
import Airtable from 'airtable';
import type { AirtableBaseInfo, AirtableTableInfo, AirtableRequestOptions, FetchRecordsOptions, StatusReporter } from './types';

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
 * Give up after this many consecutive 429s so a persistently throttled or
 * over-scoped token surfaces an error instead of retrying forever.
 */
const MAX_RATE_LIMIT_RETRIES = 5;

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
export async function makeAirtableRequest<T>(options: AirtableRequestOptions, attempt: number = 1): Promise<T> {
	const { url, token, ctx, method = 'GET', body } = options;

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
			if (attempt >= MAX_RATE_LIMIT_RETRIES) {
				throw new Error(`Airtable API error: still rate limited after ${MAX_RATE_LIMIT_RETRIES} attempts`);
			}

			const retryAfter = response.headers?.['retry-after']
				? parseInt(response.headers['retry-after']) * 1000
				: 30000; // Default 30 seconds as per Airtable docs

			ctx.status(`Rate limited, waiting ${retryAfter / 1000}s (attempt ${attempt}/${MAX_RATE_LIMIT_RETRIES})...`);
			await new Promise(resolve => setTimeout(resolve, retryAfter));
			return makeAirtableRequest(options, attempt + 1);
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
	ctx: StatusReporter
): Promise<AirtableBaseInfo[]> {
	ctx.status('Fetching bases...');

	const response = await makeAirtableRequest<{ bases: AirtableBaseInfo[] }>({
		url: `${AIRTABLE_META_API_BASE}/bases`,
		token,
		ctx,
	});

	return response.bases || [];
}

/**
 * Fetch table schema for a base
 */
export async function fetchTableSchema(
	baseId: string,
	token: string,
	ctx: StatusReporter
): Promise<AirtableTableInfo[]> {
	// Caller-supplied reporters usually have a friendlier label (the base's name)
	// than the ID available here, so this only fills in when nothing else did
	ctx.status(`Fetching tables for base ${baseId}...`);

	const response = await makeAirtableRequest<{ tables: AirtableTableInfo[] }>({
		url: `${AIRTABLE_META_API_BASE}/bases/${baseId}/tables`,
		token,
		ctx,
	});

	return response.tables || [];
}

/**
 * Fetch records from a table with pagination
 * Returns Airtable SDK record objects (not typed due to SDK complexity)
 */
export async function fetchAllRecords(options: FetchRecordsOptions): Promise<any[]> {
	const { baseId, tableIdOrName, token, viewId, onProgress } = options;
	const base = new Airtable({ apiKey: token }).base(baseId);

	// Airtable SDK record objects with methods like get(), _rawJson, etc.
	const records: any[] = [];

	try {
		// Airtable SDK select options
		const selectOptions: any = {};

		if (viewId) {
			selectOptions.view = viewId;
		}

		await base(tableIdOrName)
			.select(selectOptions)
			// Airtable SDK returns untyped, readonly record arrays
			.eachPage((pageRecords: readonly any[], fetchNextPage: () => void) => {
				records.push(...pageRecords);

				// Update progress via callback
				if (onProgress) {
					onProgress(records.length);
				}

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

