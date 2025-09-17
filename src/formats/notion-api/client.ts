/**
 * Notion API Client for Obsidian Importer
 * Supports API version 2025-09-03 with data source objects
 */

export interface NotionUser {
	id: string;
	name?: string;
	avatar_url?: string;
	type: 'person' | 'bot';
}

export interface NotionPage {
	id: string;
	created_time: string;
	last_edited_time: string;
	archived: boolean;
	properties: Record<string, any>;
	parent: {
		type: string;
		[key: string]: any;
	};
	url: string;
}

export interface NotionDatabase {
	id: string;
	title: Array<{
		type: string;
		plain_text: string;
	}>;
	description: Array<{
		type: string;
		plain_text: string;
	}>;
	properties: Record<string, any>;
	created_time: string;
	last_edited_time: string;
	archived: boolean;
	url: string;
}

export interface NotionDataSource {
	id: string;
	properties: Record<string, any>;
	parent: {
		type: 'database_id';
		database_id: string;
	};
	database_parent: {
		type: string;
		[key: string]: any;
	};
	title: Array<{
		type: string;
		plain_text: string;
	}>;
	description: Array<{
		type: string;
		plain_text: string;
	}>;
	created_time: string;
	last_edited_time: string;
	archived: boolean;
}

export interface NotionBlock {
	id: string;
	type: string;
	created_time: string;
	last_edited_time: string;
	archived: boolean;
	has_children: boolean;
	parent: {
		type: string;
		[key: string]: any;
	};
	[key: string]: any; // Block-specific properties
}

export class NotionAPIClient {
	private apiToken: string;
	private baseUrl = 'https://api.notion.com/v1';
	private apiVersion = '2025-09-03';

	constructor(apiToken: string) {
		this.apiToken = apiToken;
	}

	private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
		const url = `${this.baseUrl}${endpoint}`;
		
		const response = await fetch(url, {
			...options,
			headers: {
				'Authorization': `Bearer ${this.apiToken}`,
				'Notion-Version': this.apiVersion,
				'Content-Type': 'application/json',
				...options.headers,
			},
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(`Notion API error (${response.status}): ${errorData.message || response.statusText}`);
		}

		return response.json();
	}

	async getCurrentUser(): Promise<NotionUser> {
		return this.makeRequest('/users/me');
	}

	async searchPages(includeArchived: boolean = false): Promise<NotionPage[]> {
		const filter: any = {
			property: 'object',
			value: 'page'
		};

		if (!includeArchived) {
			filter.and = [{
				property: 'archived',
				checkbox: {
					equals: false
				}
			}];
		}

		const response = await this.makeRequest('/search', {
			method: 'POST',
			body: JSON.stringify({
				filter,
				sort: {
					direction: 'descending',
					timestamp: 'last_edited_time'
				}
			})
		});

		return response.results;
	}

	async searchDatabases(includeArchived: boolean = false): Promise<NotionDatabase[]> {
		const filter: any = {
			property: 'object',
			value: 'database'
		};

		if (!includeArchived) {
			filter.and = [{
				property: 'archived',
				checkbox: {
					equals: false
				}
			}];
		}

		const response = await this.makeRequest('/search', {
			method: 'POST',
			body: JSON.stringify({
				filter,
				sort: {
					direction: 'descending',
					timestamp: 'last_edited_time'
				}
			})
		});

		return response.results;
	}

	async getPageBlocks(pageId: string): Promise<NotionBlock[]> {
		const blocks: NotionBlock[] = [];
		let cursor: string | undefined;

		do {
			const response = await this.makeRequest(`/blocks/${pageId}/children`, {
				method: 'GET',
				...(cursor && {
					body: JSON.stringify({ start_cursor: cursor })
				})
			});

			blocks.push(...response.results);
			cursor = response.next_cursor;
		} while (cursor);

		// Recursively get child blocks
		for (const block of blocks) {
			if (block.has_children) {
				const childBlocks = await this.getPageBlocks(block.id);
				(block as any).children = childBlocks;
			}
		}

		return blocks;
	}

	async getDatabaseDataSources(databaseId: string): Promise<NotionDataSource[]> {
		// For API version 2025-09-03, we need to get data sources for a database
		try {
			const response = await this.makeRequest(`/databases/${databaseId}/data_sources`);
			return response.results;
		} catch (error) {
			// Fallback for older databases that might not have separate data sources
			// In this case, we'll treat the database itself as a single data source
			console.warn(`Could not fetch data sources for database ${databaseId}, using fallback:`, error);
			
			const database = await this.makeRequest(`/databases/${databaseId}`);
			return [{
				id: databaseId, // Use database ID as data source ID for compatibility
				properties: database.properties,
				parent: {
					type: 'database_id',
					database_id: databaseId
				},
				database_parent: database.parent,
				title: database.title,
				description: database.description || [],
				created_time: database.created_time,
				last_edited_time: database.last_edited_time,
				archived: database.archived
			}];
		}
	}

	async queryDataSource(dataSourceId: string): Promise<NotionPage[]> {
		const pages: NotionPage[] = [];
		let cursor: string | undefined;

		do {
			const body: any = {
				page_size: 100
			};
			
			if (cursor) {
				body.start_cursor = cursor;
			}

			// Try the new data source query endpoint first
			let response;
			try {
				response = await this.makeRequest(`/data_sources/${dataSourceId}/query`, {
					method: 'POST',
					body: JSON.stringify(body)
				});
			} catch (error) {
				// Fallback to database query for compatibility
				console.warn(`Data source query failed, falling back to database query:`, error);
				response = await this.makeRequest(`/databases/${dataSourceId}/query`, {
					method: 'POST',
					body: JSON.stringify(body)
				});
			}

			pages.push(...response.results);
			cursor = response.next_cursor;
		} while (cursor);

		return pages;
	}

	async downloadFile(url: string): Promise<ArrayBuffer> {
		// Notion file URLs are signed and temporary
		const response = await fetch(url);
		
		if (!response.ok) {
			throw new Error(`Failed to download file: ${response.statusText}`);
		}

		return response.arrayBuffer();
	}

	async getPage(pageId: string): Promise<NotionPage> {
		return this.makeRequest(`/pages/${pageId}`);
	}

	async getDatabase(databaseId: string): Promise<NotionDatabase> {
		return this.makeRequest(`/databases/${databaseId}`);
	}

	async getDataSource(dataSourceId: string): Promise<NotionDataSource> {
		try {
			return this.makeRequest(`/data_sources/${dataSourceId}`);
		} catch (error) {
			// Fallback to database endpoint for compatibility
			console.warn(`Data source retrieval failed, falling back to database:`, error);
			const database = await this.getDatabase(dataSourceId);
			
			// Convert database to data source format
			return {
				id: dataSourceId,
				properties: database.properties,
				parent: {
					type: 'database_id',
					database_id: dataSourceId
				},
				database_parent: { type: 'page_id', page_id: '' }, // Will be filled from actual database
				title: database.title,
				description: database.description || [],
				created_time: database.created_time,
				last_edited_time: database.last_edited_time,
				archived: database.archived
			};
		}
	}
}