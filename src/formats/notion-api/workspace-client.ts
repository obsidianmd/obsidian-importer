import { Client } from '@notionhq/client';
import { Platform } from 'obsidian';

// Workspace structure interfaces
export interface WorkspaceDatabase {
	id: string;
	title: string;
	properties: Record<string, any>;
	created_time: string;
	last_edited_time: string;
}

export interface WorkspaceDataSource {
	id: string;
	name: string;
}

export interface WorkspacePage {
	id: string;
	title: string;
	properties: Record<string, any>;
	created_time: string;
	last_edited_time: string;
}

export interface WorkspaceStructure {
	databases: WorkspaceDatabase[];
	dataSources: WorkspaceDataSource[];
}

// Main workspace client - handles all Notion API interactions
export class NotionWorkspace {
	private notionClient: Client;

	constructor(apiKey: string) {
		// Only works on desktop - mobile doesn't support Notion API calls
		if (Platform.isDesktopApp) {
			this.notionClient = new Client({ 
				auth: apiKey,
				notionVersion: '2025-09-03' // Latest API with data sources support
			});
		} else {
			throw new Error('Notion workspace import requires desktop Obsidian');
		}
	}

	async fetchAvailableWorkspaces(): Promise<Array<{id: string, title: string, pageCount: number}>> {
		try {
			const response = await this.notionClient.search({
				filter: {
					property: 'object',
					value: 'database' as any
				}
			});

			// Group databases by workspace and return workspace info
			const workspaces = new Map<string, {title: string, pageCount: number}>();
			
			for (const db of response.results as any[]) {
				const workspaceId = db.parent?.workspace_id || 'default';
				const workspaceTitle = db.parent?.workspace_name || 'Personal Workspace';
				
				if (!workspaces.has(workspaceId)) {
					workspaces.set(workspaceId, { title: workspaceTitle, pageCount: 0 });
				}
				
				// Estimate page count (we'll get exact count later)
				workspaces.get(workspaceId)!.pageCount += 1;
			}

			return Array.from(workspaces.entries()).map(([id, info]) => ({
				id,
				title: info.title,
				pageCount: info.pageCount
			}));
		} catch (error: any) {
			throw new Error(`Failed to discover workspaces: ${error.message}`);
		}
	}

	async fetchWorkspaceStructure(workspaceId: string): Promise<WorkspaceStructure> {
		try {
			// Get all databases in this workspace
			const response = await this.notionClient.search({
				filter: {
					property: 'object',
					value: 'database' as any
				}
			}) as any;

			const databases: WorkspaceDatabase[] = [];
			const dataSources: WorkspaceDataSource[] = [];

			for (const db of response.results) {
				// Check if this database belongs to the requested workspace
				if (db.parent?.workspace_id === workspaceId || workspaceId === 'default') {
					databases.push({
						id: db.id,
						title: db.title?.[0]?.plain_text || 'Untitled Database',
						properties: db.properties,
						created_time: db.created_time,
						last_edited_time: db.last_edited_time
					});

					// Try to get data sources for this database
					try {
						const dbDetails = await this.notionClient.databases.retrieve({
							database_id: db.id
						}) as any;

						if (dbDetails.data_sources && Array.isArray(dbDetails.data_sources)) {
							for (const ds of dbDetails.data_sources) {
								dataSources.push({
									id: ds.id,
									name: ds.name || 'Unnamed Data Source'
								});
							}
						}
					} catch (dsError) {
						// Data sources not available for this database, skip
					}
				}
			}

			return { databases, dataSources };
		} catch (error: any) {
			throw new Error(`Failed to fetch workspace structure: ${error.message}`);
		}
	}

	async fetchAllPages(workspaceId: string): Promise<WorkspacePage[]> {
		try {
			// Get all pages in this workspace
			const response = await this.notionClient.search({
				filter: {
					property: 'object',
					value: 'page' as any
				}
			}) as any;

			const pages: WorkspacePage[] = [];

			for (const page of response.results) {
				// Check if this page belongs to the requested workspace
				if (page.parent?.workspace_id === workspaceId || workspaceId === 'default') {
					pages.push({
						id: page.id,
						title: this.extractPageTitle(page),
						properties: page.properties,
						created_time: page.created_time,
						last_edited_time: page.last_edited_time
					});
				}
			}

			return pages;
		} catch (error: any) {
			throw new Error(`Failed to fetch pages from workspace: ${error.message}`);
		}
	}

	async fetchPageContent(pageId: string): Promise<any[]> {
		try {
			const response = await this.notionClient.blocks.children.list({
				block_id: pageId
			});

			return response.results;
		} catch (error: any) {
			throw new Error(`Failed to fetch page content: ${error.message}`);
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
