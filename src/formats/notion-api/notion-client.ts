import { Client } from '@notionhq/client';
import { Platform } from 'obsidian';

export interface NotionDatabase {
	id: string;
	title: string;
	properties: Record<string, any>;
	created_time: string;
	last_edited_time: string;
}

export interface NotionDataSource {
	id: string;
	name: string;
}

export interface NotionPage {
	id: string;
	title: string;
	properties: Record<string, any>;
	created_time: string;
	last_edited_time: string;
}

export class NotionApiClient {
	private client: Client;

	constructor(token: string) {
		// Mobile compatibility: Only initialize on desktop
		if (Platform.isDesktopApp) {
			this.client = new Client({ 
				auth: token,
				notionVersion: '2025-09-03'
			});
		} else {
			throw new Error('Notion API importer requires desktop Obsidian');
		}
	}

	async getDatabases(): Promise<NotionDatabase[]> {
		try {
			const response = await this.client.search({
				filter: {
					property: 'object',
					value: 'database' as any
				}
			});

			return response.results.map((db: any) => ({
				id: db.id,
				title: db.title?.[0]?.plain_text || 'Untitled Database',
				properties: db.properties,
				created_time: db.created_time,
				last_edited_time: db.last_edited_time
			}));
		} catch (error: any) {
			throw new Error(`Failed to fetch databases: ${error.message}`);
		}
	}

	async getDatabase(databaseId: string): Promise<NotionDatabase> {
		try {
			const response = await this.client.databases.retrieve({
				database_id: databaseId
			}) as any;

			return {
				id: response.id,
				title: response.title?.[0]?.plain_text || 'Untitled Database',
				properties: response.properties,
				created_time: response.created_time,
				last_edited_time: response.last_edited_time
			};
		} catch (error: any) {
			throw new Error(`Failed to fetch database ${databaseId}: ${error.message}`);
		}
	}

	async getDataSources(databaseId: string): Promise<NotionDataSource[]> {
		try {
			const response = await this.client.databases.retrieve({
				database_id: databaseId
			}) as any;

			// Check if data_sources property exists (new in 2025-09-03)
			if (response.data_sources && Array.isArray(response.data_sources)) {
				return response.data_sources.map((ds: any) => ({
					id: ds.id,
					name: ds.name || 'Unnamed Data Source'
				}));
			}

			// Fallback: create a single data source for the database
			return [{
				id: databaseId,
				name: 'Default Data Source'
			}];
		} catch (error: any) {
			throw new Error(`Failed to fetch data sources for database ${databaseId}: ${error.message}`);
		}
	}

	async getPagesFromDataSource(dataSourceId: string): Promise<NotionPage[]> {
		try {
			const response = await this.client.request({
				method: 'post' as any,
				path: `data_sources/${dataSourceId}/query`,
				body: {
					page_size: 100
				}
			}) as any;

			return response.results.map((page: any) => ({
				id: page.id,
				title: this.extractPageTitle(page),
				properties: page.properties,
				created_time: page.created_time,
				last_edited_time: page.last_edited_time
			}));
		} catch (error: any) {
			// Fallback: try to query the database directly
			try {
				const response = await (this.client as any).databases.query({
					database_id: dataSourceId,
					page_size: 100
				});

				return response.results.map((page: any) => ({
					id: page.id,
					title: this.extractPageTitle(page),
					properties: page.properties,
					created_time: page.created_time,
					last_edited_time: page.last_edited_time
				}));
			} catch (fallbackError: any) {
				throw new Error(`Failed to fetch pages from data source ${dataSourceId}: ${error.message}`);
			}
		}
	}

	async getPageBlocks(pageId: string): Promise<any[]> {
		try {
			const response = await this.client.blocks.children.list({
				block_id: pageId
			});

			return response.results;
		} catch (error) {
			throw new Error(`Failed to fetch blocks for page ${pageId}: ${error.message}`);
		}
	}

	private extractPageTitle(page: any): string {
		// Try to find a title property
		for (const [key, value] of Object.entries(page.properties || {})) {
			if (value && typeof value === 'object' && 'title' in value) {
				const titleValue = (value as any).title;
				if (Array.isArray(titleValue) && titleValue.length > 0) {
					return titleValue[0].plain_text || 'Untitled';
				}
			}
		}

		// Fallback: look for any text property
		for (const [key, value] of Object.entries(page.properties || {})) {
			if (value && typeof value === 'object' && 'rich_text' in value) {
				const richText = (value as any).rich_text;
				if (Array.isArray(richText) && richText.length > 0) {
					return richText[0].plain_text || 'Untitled';
				}
			}
		}

		return 'Untitled';
	}
}
