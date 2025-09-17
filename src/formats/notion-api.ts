import { Notice, Setting } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { NotionAPIClient } from './notion-api/client';
import { NotionBlockConverter } from './notion-api/block-converter';
import { NotionDatabaseConverter } from './notion-api/database-converter';

export class NotionAPIImporter extends FormatImporter {
	apiToken: string = '';
	includeArchived: boolean = false;
	singleLineBreaks: boolean = false;
	
	private apiClient: NotionAPIClient | null = null;
	private blockConverter: NotionBlockConverter | null = null;
	private databaseConverter: NotionDatabaseConverter | null = null;

	init() {
		this.addOutputLocationSetting('Notion API Import');
		
		// API Token setting
		new Setting(this.modal.contentEl)
			.setName('Notion Integration Token')
			.setDesc('Enter your Notion integration token. Create one at https://www.notion.so/my-integrations')
			.addText((text) => text
				.setPlaceholder('secret_...')
				.setValue(this.apiToken)
				.onChange((value) => {
					this.apiToken = value.trim();
					this.validateToken();
				}));

		// Include archived pages setting
		new Setting(this.modal.contentEl)
			.setName('Include archived pages')
			.setDesc('Import pages that have been archived in Notion.')
			.addToggle((toggle) => toggle
				.setValue(this.includeArchived)
				.onChange((value) => (this.includeArchived = value)));

		// Single line breaks setting
		new Setting(this.modal.contentEl)
			.setName('Single line breaks')
			.setDesc('Separate Notion blocks with only one line break (default is 2).')
			.addToggle((toggle) => toggle
				.setValue(this.singleLineBreaks)
				.onChange((value) => {
					this.singleLineBreaks = value;
				}));

		// Test connection button
		new Setting(this.modal.contentEl)
			.setName('Test Connection')
			.setDesc('Test your Notion integration token.')
			.addButton((button) => button
				.setButtonText('Test Connection')
				.onClick(async () => {
					await this.testConnection();
				}));
	}

	private validateToken(): boolean {
		if (!this.apiToken) {
			return false;
		}
		
		// Notion integration tokens start with 'secret_'
		if (!this.apiToken.startsWith('secret_')) {
			new Notice('Invalid token format. Notion integration tokens start with "secret_"');
			return false;
		}
		
		return true;
	}

	private async testConnection(): Promise<void> {
		if (!this.validateToken()) {
			new Notice('Please enter a valid Notion integration token.');
			return;
		}

		try {
			this.apiClient = new NotionAPIClient(this.apiToken);
			const user = await this.apiClient.getCurrentUser();
			new Notice(`✅ Connected successfully! Authenticated as: ${user.name || user.id}`);
		} catch (error) {
			new Notice(`❌ Connection failed: ${error.message}`);
			console.error('Notion API connection test failed:', error);
		}
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.validateToken()) {
			new Notice('Please enter a valid Notion integration token.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		try {
			// Initialize API client and converters
			this.apiClient = new NotionAPIClient(this.apiToken);
			this.blockConverter = new NotionBlockConverter(
				this.vault.getConfig('attachmentFolderPath') ?? '',
				this.singleLineBreaks
			);
			this.databaseConverter = new NotionDatabaseConverter();

			ctx.status('Connecting to Notion API...');
			
			// Test connection
			await this.apiClient.getCurrentUser();
			
			ctx.status('Fetching workspace content...');
			
			// Get all accessible pages and databases
			const pages = await this.apiClient.searchPages(this.includeArchived);
			const databases = await this.apiClient.searchDatabases(this.includeArchived);
			
			const totalItems = pages.length + databases.length;
			ctx.reportProgress(0, totalItems);
			
			let current = 0;
			
			// Import pages
			for (const page of pages) {
				if (ctx.isCancelled()) return;
				
				current++;
				ctx.status(`Importing page: ${this.getPageTitle(page)}`);
				ctx.reportProgress(current, totalItems);
				
				try {
					await this.importPage(page, folder.path, ctx);
					ctx.reportNoteSuccess(page.id);
				} catch (error) {
					ctx.reportFailed(page.id, error);
				}
			}
			
			// Import databases
			for (const database of databases) {
				if (ctx.isCancelled()) return;
				
				current++;
				ctx.status(`Importing database: ${this.getDatabaseTitle(database)}`);
				ctx.reportProgress(current, totalItems);
				
				try {
					await this.importDatabase(database, folder.path, ctx);
					ctx.reportNoteSuccess(database.id);
				} catch (error) {
					ctx.reportFailed(database.id, error);
				}
			}
			
			ctx.status('Import completed successfully!');
			
		} catch (error) {
			new Notice(`Import failed: ${error.message}`);
			console.error('Notion API import failed:', error);
		}
	}

	private async importPage(page: any, basePath: string, ctx: ImportContext): Promise<void> {
		if (!this.apiClient || !this.blockConverter) {
			throw new Error('API client or block converter not initialized');
		}

		// Get page content (blocks)
		const blocks = await this.apiClient.getPageBlocks(page.id);
		
		// Convert to markdown
		const markdown = await this.blockConverter.convertBlocksToMarkdown(blocks, this.apiClient);
		
		// Get page title
		const title = this.getPageTitle(page);
		
		// Create the file
		const filePath = `${basePath}/${this.sanitizeFilePath(title)}.md`;
		await this.vault.create(filePath, markdown);
	}

	private async importDatabase(database: any, basePath: string, ctx: ImportContext): Promise<void> {
		if (!this.apiClient || !this.databaseConverter) {
			throw new Error('API client or database converter not initialized');
		}

		// Get database title
		const title = this.getDatabaseTitle(database);
		
		// Create database folder
		const databasePath = `${basePath}/${this.sanitizeFilePath(title)}`;
		await this.createFolders(databasePath);
		
		// Get all data sources for this database (API version 2025-09-03)
		const dataSources = await this.apiClient.getDatabaseDataSources(database.id);
		
		for (const dataSource of dataSources) {
			// Query all pages in this data source
			const pages = await this.apiClient.queryDataSource(dataSource.id);
			
			// Convert database to Obsidian Base format
			await this.databaseConverter.convertToBase(
				database,
				dataSource,
				pages,
				databasePath,
				this.vault,
				this.apiClient
			);
		}
	}

	private getPageTitle(page: any): string {
		// Extract title from page properties
		if (page.properties?.title?.title?.[0]?.plain_text) {
			return page.properties.title.title[0].plain_text;
		}
		if (page.properties?.Name?.title?.[0]?.plain_text) {
			return page.properties.Name.title[0].plain_text;
		}
		return `Untitled Page ${page.id.slice(0, 8)}`;
	}

	private getDatabaseTitle(database: any): string {
		// Extract title from database
		if (database.title?.[0]?.plain_text) {
			return database.title[0].plain_text;
		}
		return `Untitled Database ${database.id.slice(0, 8)}`;
	}
}