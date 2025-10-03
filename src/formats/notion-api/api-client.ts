import { Client } from '@notionhq/client';
import type {
	GetPageResponse,
	GetDatabaseResponse,
	ListBlockChildrenResponse,
	SearchResponse,
	PageObjectResponse,
	BlockObjectResponse,
	DatabaseObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

export interface NotionApiConfig {
	auth: string;
	notionVersion?: string;
}

export type NotionSearchResult = SearchResponse['results'][number] | DatabaseObjectResponse;

interface QueryDatabaseParameters {
	database_id: string;
	start_cursor?: string;
	page_size?: number;
}

interface QueryDatabaseResult {
	results: PageObjectResponse[];
	has_more: boolean;
	next_cursor: string | null;
}

type ExtendedClient = Client & {
	databases: Client['databases'] & {
		query: (params: QueryDatabaseParameters) => Promise<QueryDatabaseResult>;
	};
}

class RateLimiter {
	private queue: Array<() => void> = [];
	private processing = false;
	private lastRequestTime = 0;
	private readonly minInterval: number;

	constructor(requestsPerSecond: number) {
		this.minInterval = 1000 / requestsPerSecond;
	}

	async throttle<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			this.queue.push(async () => {
				try {
					const result = await fn();
					resolve(result);
				} catch (error) {
					reject(error);
				}
			});

			if (!this.processing) {
				this.processQueue();
			}
		});
	}

	private async processQueue(): Promise<void> {
		if (this.queue.length === 0) {
			this.processing = false;
			return;
		}

		this.processing = true;
		const now = Date.now();
		const timeSinceLastRequest = now - this.lastRequestTime;

		if (timeSinceLastRequest < this.minInterval) {
			await this.sleep(this.minInterval - timeSinceLastRequest);
		}

		const task = this.queue.shift();
		if (task) {
			this.lastRequestTime = Date.now();
			await task();
		}

		this.processQueue();
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

async function collectAll<T>(
	fetchPage: (cursor?: string) => Promise<{ results: T[]; hasMore: boolean; nextCursor?: string }>
): Promise<T[]> {
	const allResults: T[] = [];
	let cursor: string | undefined;
	let hasMore = true;

	while (hasMore) {
		const response = await fetchPage(cursor);
		allResults.push(...response.results);
		hasMore = response.hasMore;
		cursor = response.nextCursor;
	}

	return allResults;
}

export class NotionApiClient {
	private client: ExtendedClient;
	private rateLimiter: RateLimiter;

	constructor(config: NotionApiConfig) {
		this.client = new Client({
			auth: config.auth,
			notionVersion: config.notionVersion || '2022-06-28',
		}) as ExtendedClient;
		this.rateLimiter = new RateLimiter(3);
	}

	async getPage(pageId: string): Promise<GetPageResponse> {
		return this.rateLimiter.throttle(() =>
			this.client.pages.retrieve({ page_id: pageId })
		);
	}

	async getDatabase(databaseId: string): Promise<GetDatabaseResponse> {
		return this.rateLimiter.throttle(() =>
			this.client.databases.retrieve({ database_id: databaseId })
		);
	}

	async getAllDatabasePages(databaseId: string): Promise<PageObjectResponse[]> {
		const results: PageObjectResponse[] = [];
		let cursor: string | undefined;
		let hasMore = true;

		while (hasMore) {
			const response = await this.rateLimiter.throttle(() =>
				this.client.databases.query({
					database_id: databaseId,
					start_cursor: cursor,
					page_size: 100,
				})
			);

			results.push(...response.results);
			hasMore = response.has_more;
			cursor = response.next_cursor || undefined;
		}

		return results;
	}

	async getBlockChildren(blockId: string, startCursor?: string): Promise<ListBlockChildrenResponse> {
		return this.rateLimiter.throttle(() =>
			this.client.blocks.children.list({
				block_id: blockId,
				start_cursor: startCursor,
				page_size: 100,
			})
		);
	}

	async getAllBlockChildren(blockId: string): Promise<ListBlockChildrenResponse['results']> {
		return collectAll(async (cursor) => {
			const response = await this.getBlockChildren(blockId, cursor);
			return {
				results: response.results,
				hasMore: response.has_more,
				nextCursor: response.next_cursor || undefined,
			};
		});
	}

	async search(query?: string, options?: {
		startCursor?: string;
		pageSize?: number;
	}): Promise<SearchResponse> {
		return this.rateLimiter.throttle(() =>
			this.client.search({
				query,
				start_cursor: options?.startCursor,
				page_size: options?.pageSize || 100,
			})
		);
	}

	async searchAll(query?: string): Promise<NotionSearchResult[]> {
		return collectAll(async (cursor) => {
			const response = await this.search(query, { startCursor: cursor });
			return {
				results: response.results,
				hasMore: response.has_more,
				nextCursor: response.next_cursor || undefined,
			};
		});
	}
}
