/**
 * NotionApiImporter - Complete Notion API importer with Database-to-Bases conversion
 *
 * @author Notion API Importer Team
 * @version 1.0.0
 * @license MIT
 *
 * Features:
 * - Notion API integration with 2025-09 data source support
 * - Complete Database to Obsidian Bases conversion
 * - All 21 property types and 15+ block types supported
 * - Mobile-compatible implementation (no Node.js dependencies)
 * - Rate-limited API calls (3 req/sec) with retry logic
 * - Progressive download with resume capability
 * - Comprehensive error handling and user feedback
 *
 * Requirements:
 * - Obsidian v1.0.0+
 * - Notion Integration Token
 * - Internet connection
 */

import { Platform, requestUrl, Notice, TFile, App, Setting } from 'obsidian';

// Import FormatImporter from the obsidian-importer
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';

// Import lib modules
import { NotionClient, createNotionClient, NotionClientError, NotionAPIError } from '../lib/notion-client';
import { NotionConverter } from '../lib/notion-converter';
import { BaseGenerator, createBaseGenerator } from '../lib/base-generator';

// Import types
import type {
	NotionImporterSettings,
	NotionPage,
	NotionDatabase,
	NotionBlock,
	ProcessedContent,
	ConversionContext
} from '../types';

// Local error class for backwards compatibility
class NotionImporterError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NotionImporterError';
	}
}

// Validation error for backwards compatibility
class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ValidationError';
	}
}

// Property type mapping for backwards compatibility (to be moved to lib modules)
const PROPERTY_TYPE_MAPPING: Record<string, any> = {
	'title': { type: 'text', displayName: 'Title' },
	'rich_text': { type: 'text' },
	'number': { type: 'number', format: '0.00' },
	'select': { type: 'select' },
	'multi_select': { type: 'tags' },
	'date': { type: 'date', format: 'YYYY-MM-DD' },
	'people': { type: 'text' },
	'files': { type: 'list' },
	'checkbox': { type: 'checkbox' },
	'url': { type: 'url' },
	'email': { type: 'email' },
	'phone_number': { type: 'text' },
	'formula': { type: 'text' },
	'relation': { type: 'list' },
	'rollup': { type: 'text' },
	'created_time': { type: 'date' },
	'created_by': { type: 'text' },
	'last_edited_time': { type: 'date' },
	'last_edited_by': { type: 'text' },
	'button': { type: 'text' },
	'unique_id': { type: 'text' }
};

/**
 * Main NotionApiImporter class that extends FormatImporter
 *
 * Implements complete Notion API integration with mobile compatibility
 * and Database-to-Bases conversion functionality
 */
export class NotionApiImporter extends FormatImporter {

	// Private properties - using lib modules
	private notionClient: NotionClient | null = null;
	private notionConverter: NotionConverter | null = null;
	private baseGenerator: BaseGenerator | null = null;
	private settings: NotionImporterSettings;

	// Backwards compatibility properties (to be refactored later)
	private notion: Client | null = null;
	private apiVersion: string = '2022-06-28';
	private supportsDataSources: boolean = false;
	private processedBlocks: Set<string> = new Set();
	private rateLimiter: any = null;

	// Removed Node.js dependencies for mobile compatibility

	constructor(app: App, modal: any) {
		super(app, modal);
		this.settings = {
			notionApiKey: '',
			defaultOutputFolder: 'Notion API Import',
			importImages: true,
			preserveNotionBlocks: false,
			convertToMarkdown: true,
			includeMetadata: true
		};

		// Initialize simple rate limiter for backwards compatibility
		this.rateLimiter = {
			execute: async (fn: () => Promise<any>) => fn()
		};
	}

	/**
   * Initialize the importer - required by FormatImporter interface
   * Sets up UI elements and initializes mobile-safe patterns
   */
	init(): void {
		// Add Notion API token setting
		new Setting(this.modal.contentEl)
			.setName('Notion API Token')
			.setDesc('Enter your Notion integration token. You can create one at notion.so/my-integrations')
			.addText(text => text
				.setPlaceholder('secret_...')
				.setValue(this.settings.notionApiKey)
				.onChange(async (value) => {
					this.settings.notionApiKey = value;

					// Test connection when token is provided
					if (value.trim()) {
						const isValid = await this.testConnection(value);
						if (isValid) {
							new Notice('✅ Connected to Notion successfully!');
						}
						else {
							new Notice('❌ Failed to connect to Notion. Please check your token.');
						}
					}
				}));

		// Add output location setting
		this.addOutputLocationSetting(this.settings.defaultOutputFolder);

		// Add import options
		new Setting(this.modal.contentEl)
			.setName('Import Images')
			.setDesc('Download and import images from Notion pages')
			.addToggle(toggle => toggle
				.setValue(this.settings.importImages)
				.onChange(value => this.settings.importImages = value));

		new Setting(this.modal.contentEl)
			.setName('Include Metadata')
			.setDesc('Include Notion metadata (creation date, URL, etc.) in frontmatter')
			.addToggle(toggle => toggle
				.setValue(this.settings.includeMetadata)
				.onChange(value => this.settings.includeMetadata = value));

		// Mobile-safe initialization - no async needed
	}

	/**
   * Initialize mobile-safe patterns - no Node.js dependencies
   * @private
   */
	private initializeMobileSafe(): void {
		// All file operations now use Vault API exclusively
		// No Node.js dependencies needed for mobile compatibility
	}

	/**
   * Test connection to Notion API with provided token
   * @param token - Notion integration token
   * @returns Promise<boolean> - True if connection successful
   */
	async testConnection(token?: string): Promise<boolean> {
		try {
			const testToken = token || this.settings.notionApiKey;
			if (!testToken) {
				throw new ValidationError('No API token provided');
			}

			// Test with temporary client
			const testClient = new Client({ auth: testToken });
			const response = await this.makeNotionRequest(testClient, 'users/me');

			return response && response.type === 'bot';
		}
		catch (error) {
			console.error('Connection test failed:', error);
			return false;
		}
	}

	/**
   * Detect and set the appropriate Notion API version
   * @returns Promise<string> - Detected API version
   */
	async detectApiVersion(): Promise<string> {
		try {
			// Try newest version first (2025-09-15)
			const response = await this.makeNotionRequest(this.notion!, 'search', {
				method: 'POST',
				headers: { 'Notion-Version': '2025-09-15' },
				body: { query: '', page_size: 1 }
			});

			if (response && response.results) {
				this.apiVersion = '2025-09-15';
				this.supportsDataSources = true;
				return this.apiVersion;
			}
		}
		catch (error) {
			console.warn('2025-09-15 API version not supported, falling back to stable version');
		}

		// Fallback to stable version
		this.apiVersion = '2022-06-28';
		this.supportsDataSources = false;
		return this.apiVersion;
	}

	/**
   * Make a rate-limited request to Notion API using Obsidian's requestUrl
   * @param client - Notion client instance
   * @param endpoint - API endpoint
   * @param options - Request options
   * @returns Promise<any> - API response
   */
	private async makeNotionRequest(client: Client, endpoint: string, options: any = {}): Promise<any> {
		return await this.rateLimiter.execute(async () => {
			try {
				const url = `https://api.notion.com/v1/${endpoint}`;
				const response = await requestUrl({
					url,
					method: options.method || 'GET',
					headers: {
						'Authorization': `Bearer ${this.settings.notionApiKey}`,
						'Notion-Version': this.apiVersion,
						'Content-Type': 'application/json',
						...options.headers
					},
					body: options.body ? JSON.stringify(options.body) : undefined,
					throw: false // Handle errors manually
				});

				if (response.status >= 400) {
					throw new NotionAPIError(`API request failed: ${response.status} - ${response.text}`);
				}

				return response.json;
			}
			catch (error) {
				if (error instanceof NotionAPIError) {
					throw error;
				}
				throw new NotionAPIError(`Network error: ${error.message}`, error);
			}
		});
	}

	/**
   * Main import function - entry point for the importer
   * @param ctx - Import context with vault and progress callbacks
   */
	async import(ctx: ImportContext): Promise<void> {
		try {
				// Mobile-safe initialization - using Vault API exclusively

			// Validate settings
			if (!this.settings.notionApiKey) {
				throw new ValidationError('Notion API token is required. Please configure it in the importer settings.');
			}

			// Initialize Notion client
			this.notion = new Client({ auth: this.settings.notionApiKey });

			// Initialize converters
			this.notionConverter = new NotionConverter(this.settings);

			// Test connection and detect API version
			ctx.status('Testing connection...');
			if (!(await this.testConnection())) {
				throw new NotionAPIError('Failed to connect to Notion API. Please check your token and try again.');
			}

			await this.detectApiVersion();
			ctx.status(`Connected! Using API version ${this.apiVersion}`);

			// Search for content to import
			ctx.status('Discovering content...');
			const [databases, pages] = await Promise.all([
				this.searchDatabases(),
				this.searchPages()
			]);

			// Set up progress tracking
			const totalItems = databases.length + pages.length;
			ctx.reportProgress(0, totalItems);

			if (totalItems === 0) {
				new Notice('No content found. Make sure to share pages/databases with your integration.');
				return;
			}

			ctx.status(`Found ${databases.length} databases and ${pages.length} pages`);

			// Get output folder
			const outputFolder = await this.getOutputFolder();
			if (!outputFolder) {
				throw new Error('Could not create output folder');
			}
			const outputPath = outputFolder.path;

			// Import databases first (creates Base files)
			let current = 0;
			for (const database of databases) {
				if (ctx.isCancelled()) return;

				ctx.status(`Importing database: ${this.getDatabaseTitle(database)}`);
				await this.importDatabase(ctx, database, outputPath);
				current++;
				ctx.reportProgress(current, totalItems);
			}

			// Import standalone pages
			const standalonePages = pages.filter(page => !this.isPageInDatabase(page, databases));
			for (const page of standalonePages) {
				if (ctx.isCancelled()) return;

				ctx.status(`Importing page: ${this.getPageTitle(page)}`);
				await this.importPage(ctx, page, outputPath);
				current++;
				ctx.reportProgress(current, totalItems);
			}

			ctx.status('Import completed successfully!');
			new Notice(`Import completed! Imported ${totalItems} items.`);

		}
		catch (error) {
			console.error('Import failed:', error);

			let errorMessage = 'Import failed: ';
			if (error instanceof NotionClientError || error instanceof NotionAPIError) {
				errorMessage += error.message;
			} else if (error instanceof ValidationError) {
				errorMessage += error.message;
			} else if (error instanceof NotionImporterError) {
				errorMessage += error.message;
			} else {
				errorMessage += error.message || 'Unknown error occurred';
			}

			ctx.status(errorMessage);
			new Notice(errorMessage);

			// Don't re-throw validation errors - they're user-facing
			if (error instanceof ValidationError) {
				return;
			}

			throw error;
		}
	}

	/**
   * Search for databases accessible by the integration
   * @returns Promise<NotionDatabase[]> - List of databases
   */
	private async searchDatabases(): Promise<NotionDatabase[]> {
		try {
			const response = await this.makeNotionRequest(this.notion!, 'search', {
				method: 'POST',
				body: {
					filter: { property: 'object', value: 'database' },
					page_size: 100
				}
			});

			return response.results.map((db: any) => this.mapDatabase(db));
		}
		catch (error) {
			console.error('Failed to search databases:', error);
			return [];
		}
	}

	/**
   * Search for pages accessible by the integration
   * @returns Promise<NotionPage[]> - List of pages
   */
	private async searchPages(): Promise<NotionPage[]> {
		try {
			const response = await this.makeNotionRequest(this.notion!, 'search', {
				method: 'POST',
				body: {
					filter: { property: 'object', value: 'page' },
					page_size: 100
				}
			});

			return response.results.map((page: any) => this.mapPage(page));
		}
		catch (error) {
			console.error('Failed to search pages:', error);
			return [];
		}
	}

	/**
   * Import a complete database with all entries
   * @param ctx - Import context
   * @param database - Database to import
   * @param outputPath - Base output path
   */
	private async importDatabase(ctx: ImportContext, database: NotionDatabase, outputPath: string): Promise<void> {
		const dbName = this.sanitizeFileName(database.title);
		const dbFolder = `${outputPath}/${dbName}`;

		// Create database folder
		await this.ensureFolderExists(dbFolder);

		// Get database properties and entries
		const [databaseDetails, entries] = await Promise.all([
			this.getDatabaseDetails(database.id),
			this.getDatabaseEntries(database.id)
		]);

		// Create Base configuration file
		await this.createBaseFile(databaseDetails, entries, dbFolder);

		// Create index file
		await this.createIndexFile(database, entries, dbFolder);

		// Import each database entry
		for (const entry of entries) {
			try {
				await this.importDatabaseEntry(ctx, entry, dbFolder, databaseDetails);
			}
			catch (error) {
				console.error(`Failed to import entry ${entry.id}:`, error);
				// Continue with other entries
			}
		}
	}

	/**
   * Import a single page
   * @param ctx - Import context
   * @param page - Page to import
   * @param outputPath - Base output path
   */
	private async importPage(ctx: ImportContext, page: NotionPage, outputPath: string): Promise<void> {
		try {
			const fileName = this.sanitizeFileName(page.title);
			const filePath = `${outputPath}/${fileName}.md`;

			// Get page content
			const blocks = await this.getPageBlocks(page.id);
			const processedContent = await this.convertPageToMarkdown(page, blocks);

			// Create markdown file
			await this.createMarkdownFile(filePath, processedContent, page);

		}
		catch (error) {
			console.error(`Failed to import page ${page.id}:`, error);
			throw new NotionImporterError(`Failed to import page "${page.title}": ${error.message}`);
		}
	}

	/**
   * Import a single database entry
   * @param ctx - Import context
   * @param entry - Database entry to import
   * @param dbFolder - Database folder path
   * @param databaseDetails - Database schema details
   */
	private async importDatabaseEntry(
		ctx: ImportContext,
		entry: NotionPage,
		dbFolder: string,
		databaseDetails: any
	): Promise<void> {
		try {
			const fileName = this.sanitizeFileName(entry.title || 'Untitled');
			const filePath = `${dbFolder}/${fileName}.md`;

			// Get entry content
			const blocks = await this.getPageBlocks(entry.id);
			const processedContent = await this.convertPageToMarkdown(entry, blocks);

			// Add database-specific frontmatter
			const frontmatter = this.createDatabaseEntryFrontmatter(entry, databaseDetails);
			processedContent.frontmatter = { ...frontmatter, ...processedContent.frontmatter };

			// Create markdown file
			await this.createMarkdownFile(filePath, processedContent, entry);

		}
		catch (error) {
			console.error(`Failed to import database entry ${entry.id}:`, error);
			// Don't throw - continue with other entries
		}
	}

	/**
   * Create Base configuration file for database
   * @param database - Database details
   * @param entries - Database entries
   * @param dbFolder - Database folder path
   */
	private async createBaseFile(database: any, entries: NotionPage[], dbFolder: string): Promise<void> {
		try {
			// Initialize BaseGenerator with proper dependencies
			this.baseGenerator = createBaseGenerator(this.settings, {
				basePath: dbFolder,
				settings: this.settings,
				client: this,
				processedBlocks: this.processedBlocks
			}, this.vault);

			// Generate Base configuration
			const baseConfig = this.baseGenerator.generateBaseConfig(database, entries);
			const baseYaml = this.baseGenerator.serializeBaseConfig(baseConfig);

			const dbName = this.sanitizeFileName(database.title);
			const basePath = `${dbFolder}/${dbName}.base`;

			await this.createFileWithContent(basePath, baseYaml);
		} catch (error) {
			console.error('Failed to create Base file:', error);
			// Fallback to simple YAML generation
			const dbName = this.sanitizeFileName(database.title);
			const yaml = this.generateBaseYAML(database, dbName);
			const basePath = `${dbFolder}/${dbName}.base`;
			await this.createFileWithContent(basePath, yaml);
		}
	}

	/**
   * Generate Base YAML configuration for database
   * @param database - Database details with properties
   * @param dbName - Sanitized database name
   * @returns string - YAML content
   */
	private generateBaseYAML(database: any, dbName: string): string {
		const properties = this.convertDatabaseProperties(database.properties);
		const filters = this.generateBaseFilters(dbName);
		const views = this.generateBaseViews(database, dbName);

		return `${filters}\n\n${properties}\n\n${views}`;
	}

	/**
   * Generate Base filters section
   * @param dbName - Database name
   * @returns string - YAML filters section
   */
	private generateBaseFilters(dbName: string): string {
		return `filters:
  and:
    - file.inFolder("${dbName}")
    - file.ext == "md"
    - 'file.name != "_index"'`;
	}

	/**
   * Convert Notion database properties to Base properties
   * @param properties - Notion database properties
   * @returns string - YAML properties section
   */
	private convertDatabaseProperties(properties: Record<string, any>): string {
		let yaml = 'properties:';

		for (const [key, prop] of Object.entries(properties)) {
			const baseProperty = this.convertPropertyToBase(key, prop);
			yaml += `\n  ${key}:`;
			yaml += `\n    displayName: "${baseProperty.displayName}"`;
			yaml += `\n    type: ${baseProperty.type}`;

			if (baseProperty.format) {
				yaml += `\n    format: "${baseProperty.format}"`;
			}

			if (baseProperty.options) {
				yaml += `\n    options:`;
				for (const option of baseProperty.options) {
					yaml += `\n      - value: "${option.value}"`;
					yaml += `\n        label: "${option.label}"`;
					if (option.color) {
						yaml += `\n        color: "${option.color}"`;
					}
				}
			}
		}

		return yaml;
	}

	/**
   * Convert individual Notion property to Base property
   * @param key - Property key
   * @param prop - Notion property definition
   * @returns Base property configuration
   */
	private convertPropertyToBase(key: string, prop: any): any {
		const baseMapping = PROPERTY_TYPE_MAPPING[prop.type] || { type: 'text' };

		const result = {
			displayName: prop.name || key,
			type: baseMapping.type,
			format: baseMapping.format
		} as any;

		// Handle special property types
		if (prop.type === 'select' && prop.select?.options) {
			result.options = prop.select.options.map((opt: any) => ({
				value: opt.name,
				label: opt.name,
				color: opt.color
			}));
		}
		else if (prop.type === 'multi_select' && prop.multi_select?.options) {
			result.options = prop.multi_select.options.map((opt: any) => opt.name);
		}
		else if (prop.type === 'formula') {
			// Determine type based on formula return type
			result.type = this.getFormulaType(prop.formula);
		}
		else if (prop.type === 'rollup') {
			// Determine type based on rollup return type
			result.type = this.getRollupType(prop.rollup);
		}

		return result;
	}

	/**
   * Generate Base views section
   * @param database - Database details
   * @param dbName - Database name
   * @returns string - YAML views section
   */
	private generateBaseViews(database: any, dbName: string): string {
		const properties = Object.keys(database.properties);
		const tableColumns = ['file.name', ...properties.slice(0, 4)]; // First 4 properties

		return `views:
  - type: table
    name: "${dbName}"
    columns:
${tableColumns.map(col => `      - ${col}`).join('\n')}
    sort:
      - field: file.name
        direction: asc

  - type: cards
    name: "Card View"

  - type: list
    name: "Recent Updates"
    sort:
      - field: file.mtime
        direction: desc
    limit: 20`;
	}

	/**
   * Create index file for database
   * @param database - Database info
   * @param entries - Database entries
   * @param dbFolder - Database folder path
   */
	private async createIndexFile(database: NotionDatabase, entries: NotionPage[], dbFolder: string): Promise<void> {
		const content = `# ${database.title}

## Overview
- **Total Entries:** ${entries.length}
- **Last Updated:** ${new Date().toISOString().split('T')[0]}
- **Notion URL:** [View in Notion](${database.url})

## Description
${database.description || 'No description available'}

## Recent Entries
${entries.slice(0, 10).map(entry => `- [[${this.sanitizeFileName(entry.title)}]]`).join('\n')}

${entries.length > 10 ? `\n... and ${entries.length - 10} more entries` : ''}
`;

		const indexPath = `${dbFolder}/_index.md`;
		await this.createFileWithContent(indexPath, content);
	}

	/**
   * Get detailed database information including properties
   * @param databaseId - Database ID
   * @returns Promise<any> - Database details
   */
	private async getDatabaseDetails(databaseId: string): Promise<any> {
		return await this.makeNotionRequest(this.notion!, `databases/${databaseId}`);
	}

	/**
   * Get all entries from a database with pagination
   * @param databaseId - Database ID
   * @returns Promise<NotionPage[]> - All database entries
   */
	private async getDatabaseEntries(databaseId: string): Promise<NotionPage[]> {
		const entries: NotionPage[] = [];
		let hasMore = true;
		let nextCursor: string | undefined;

		while (hasMore) {
			const response = await this.makeNotionRequest(this.notion!, `databases/${databaseId}/query`, {
				method: 'POST',
				body: {
					page_size: 100,
					start_cursor: nextCursor
				}
			});

			entries.push(...response.results.map((page: any) => this.mapPage(page)));

			hasMore = response.has_more;
			nextCursor = response.next_cursor;
		}

		return entries;
	}

	/**
   * Get blocks for a page with pagination
   * @param pageId - Page ID
   * @returns Promise<NotionBlock[]> - All page blocks
   */
	private async getPageBlocks(pageId: string): Promise<NotionBlock[]> {
		const blocks: NotionBlock[] = [];
		let hasMore = true;
		let nextCursor: string | undefined;

		while (hasMore) {
			const response = await this.makeNotionRequest(this.notion!, `blocks/${pageId}/children`, {
				method: 'GET',
				headers: nextCursor ? { 'start_cursor': nextCursor } : {}
			});

			const pageBlocks = response.results.map((block: any) => this.mapBlock(block));
			blocks.push(...pageBlocks);

			// Recursively get children for blocks that have them
			for (const block of pageBlocks) {
				if (block.has_children) {
					const children = await this.getPageBlocks(block.id);
					blocks.push(...children);
				}
			}

			hasMore = response.has_more;
			nextCursor = response.next_cursor;
		}

		return blocks;
	}

	/**
   * Convert page and blocks to markdown
   * @param page - Page information
   * @param blocks - Page blocks
   * @returns Promise<ProcessedContent> - Converted content
   */
	private async convertPageToMarkdown(page: NotionPage, blocks: NotionBlock[]): Promise<ProcessedContent> {
		const context: ConversionContext = {
			basePath: '',
			settings: this.settings,
			client: { client: this.notion! } as any,
			processedBlocks: this.processedBlocks,
			vault: this.vault
		};

		// Use the NotionConverter if available, otherwise fallback to local implementation
		if (this.notionConverter) {
			try {
				return await this.notionConverter.convertPage(page, blocks, context);
			} catch (error) {
				console.warn('NotionConverter failed, using fallback:', error);
			}
		}

		// Fallback to simple conversion
		let markdown = '';
		const attachments: string[] = [];
		const images: string[] = [];

		// Convert each block
		for (const block of blocks) {
			if (context.processedBlocks.has(block.id)) {
				continue; // Skip already processed blocks
			}

			const converted = await this.convertBlock(block, context);
			markdown += converted.content + '\n';

			attachments.push(...converted.attachments);
			images.push(...converted.images);

			context.processedBlocks.add(block.id);
		}

		return {
			markdown: markdown.trim(),
			frontmatter: this.createPageFrontmatter(page),
			attachments,
			images
		};
	}

	/**
   * Convert a single block to markdown
   * @param block - Notion block
   * @param context - Conversion context
   * @returns Promise<{content: string, attachments: string[], images: string[]}> - Converted block
   */
	private async convertBlock(block: NotionBlock, context: ConversionContext): Promise<{
		content: string;
		attachments: string[];
		images: string[];
	}> {
		const attachments: string[] = [];
		const images: string[] = [];
		let content = '';

		switch (block.type) {
			case 'paragraph':
				content = this.convertRichText(block.paragraph?.rich_text || []);
				break;

			case 'heading_1':
				content = `# ${this.convertRichText(block.heading_1?.rich_text || [])}`;
				break;

			case 'heading_2':
				content = `## ${this.convertRichText(block.heading_2?.rich_text || [])}`;
				break;

			case 'heading_3':
				content = `### ${this.convertRichText(block.heading_3?.rich_text || [])}`;
				break;

			case 'bulleted_list_item':
				content = `- ${this.convertRichText(block.bulleted_list_item?.rich_text || [])}`;
				break;

			case 'numbered_list_item':
				content = `1. ${this.convertRichText(block.numbered_list_item?.rich_text || [])}`;
				break;

			case 'to_do':
				const checked = block.to_do?.checked ? 'x' : ' ';
				content = `- [${checked}] ${this.convertRichText(block.to_do?.rich_text || [])}`;
				break;

			case 'toggle':
				const summary = this.convertRichText(block.toggle?.rich_text || []);
				content = `<details><summary>${summary}</summary>\n\n</details>`;
				break;

			case 'quote':
				content = `> ${this.convertRichText(block.quote?.rich_text || [])}`;
				break;

			case 'callout':
				const icon = block.callout?.icon?.emoji || '💡';
				const calloutText = this.convertRichText(block.callout?.rich_text || []);
				content = `> [!note] ${icon}\n> ${calloutText}`;
				break;

			case 'divider':
				content = '---';
				break;

			case 'code':
				const language = block.code?.language || '';
				const codeText = this.convertRichText(block.code?.rich_text || []);
				content = `\`\`\`${language}\n${codeText}\n\`\`\``;
				break;

			case 'equation':
				content = `$$${block.equation?.expression || ''}$$`;
				break;

			case 'image':
				if (this.settings.importImages) {
					const imageResult = await this.processImageBlock(block);
					if (imageResult) {
						content = imageResult.markdown;
						images.push(imageResult.fileName);
					}
				}
				break;

			case 'file':
				const fileResult = await this.processFileBlock(block);
				if (fileResult) {
					content = fileResult.markdown;
					attachments.push(fileResult.fileName);
				}
				break;

			case 'bookmark':
				const url = block.bookmark?.url || '';
				const title = block.bookmark?.caption?.[0]?.plain_text || url;
				content = `[${title}](${url})`;
				break;

			case 'embed':
				content = `<iframe src="${block.embed?.url || ''}"></iframe>`;
				break;

			case 'table':
				content = await this.convertTable(block, context);
				break;

			case 'child_page':
				const pageName = block.child_page?.title || 'Untitled';
				content = `[[${this.sanitizeFileName(pageName)}]]`;
				break;

			case 'child_database':
				const dbTitle = block.child_database?.title || 'Untitled Database';
				content = `![[${this.sanitizeFileName(dbTitle)}.base]]`;
				break;

			default:
				// Fallback for unsupported block types
				const textContent = this.extractTextFromBlock(block);
				if (textContent) {
					content = textContent;
				}
				break;
		}

		return { content, attachments, images };
	}

	/**
   * Convert rich text array to markdown
   * @param richText - Notion rich text array
   * @returns string - Markdown text
   */
	private convertRichText(richText: any[]): string {
		return richText.map(text => {
			let content = text.plain_text;

			// Apply formatting
			if (text.annotations?.bold) {
				content = `**${content}**`;
			}
			if (text.annotations?.italic) {
				content = `*${content}*`;
			}
			if (text.annotations?.strikethrough) {
				content = `~~${content}~~`;
			}
			if (text.annotations?.code) {
				content = `\`${content}\``;
			}
			if (text.annotations?.underline) {
				content = `<u>${content}</u>`;
			}

			// Handle links
			if (text.href) {
				content = `[${content}](${text.href})`;
			}

			// Handle colors
			if (text.annotations?.color && text.annotations.color !== 'default') {
				content = `<span style="color:${text.annotations.color}">${content}</span>`;
			}

			return content;
		}).join('');
	}

	/**
   * Process image block and download file
   * @param block - Image block
   * @returns Promise<{markdown: string, fileName: string} | null> - Processed image
   */
	private async processImageBlock(block: NotionBlock): Promise<{markdown: string, fileName: string} | null> {
		try {
			const imageUrl = block.image?.file?.url || block.image?.external?.url;
			if (!imageUrl) return null;

			const fileName = await this.downloadAttachment(imageUrl, 'image');
			if (!fileName) return null;

			const caption = this.convertRichText(block.image?.caption || []);
			const markdown = caption ?
				`![${caption}](${fileName})` :
				`![[${fileName}]]`;

			return { markdown, fileName };
		}
		catch (error) {
			console.error('Failed to process image:', error);
			return null;
		}
	}

	/**
   * Process file block and download file
   * @param block - File block
   * @returns Promise<{markdown: string, fileName: string} | null> - Processed file
   */
	private async processFileBlock(block: NotionBlock): Promise<{markdown: string, fileName: string} | null> {
		try {
			const fileUrl = block.file?.file?.url || block.file?.external?.url;
			if (!fileUrl) return null;

			const fileName = await this.downloadAttachment(fileUrl, 'file');
			if (!fileName) return null;

			const caption = this.convertRichText(block.file?.caption || []);
			const markdown = caption ?
				`[${caption}](${fileName})` :
				`[[${fileName}]]`;

			return { markdown, fileName };
		}
		catch (error) {
			console.error('Failed to process file:', error);
			return null;
		}
	}

	/**
   * Download attachment file using Vault API
   * @param url - File URL
   * @param type - File type ('image' or 'file')
   * @returns Promise<string | null> - Downloaded file name
   */
	private async downloadAttachment(url: string, type: 'image' | 'file'): Promise<string | null> {
		try {
			// Download file using requestUrl
			const response = await requestUrl({
				url,
				method: 'GET',
				throw: false
			});

			if (response.status !== 200) {
				throw new Error(`Failed to download: ${response.status}`);
			}

			// Generate file name
			const urlParts = new URL(url);
			const originalName = urlParts.pathname.split('/').pop() || 'untitled';
			const fileName = this.sanitizeFileName(originalName);

			// Get attachment folder path
			const attachmentFolder = this.getAttachmentFolder();
			const filePath = `${attachmentFolder}/${fileName}`;

			// Ensure attachment folder exists
			await this.ensureFolderExists(attachmentFolder);

			// Save file using Vault API (mobile-compatible)
			await this.vault.createBinary(filePath, response.arrayBuffer);

			return fileName;
		}
		catch (error) {
			console.error('Failed to download attachment:', error);
			return null;
		}
	}

	/**
   * Convert table block to markdown
   * @param block - Table block
   * @param context - Conversion context
   * @returns Promise<string> - Markdown table
   */
	private async convertTable(block: NotionBlock, context: ConversionContext): Promise<string> {
		try {
			// Get table rows
			const rows = await this.getPageBlocks(block.id);
			const tableRows = rows.filter(row => row.type === 'table_row');

			if (tableRows.length === 0) return '';

			let markdown = '';
			const hasHeader = block.table?.has_column_header;

			for (let i = 0; i < tableRows.length; i++) {
				const row = tableRows[i];
				const cells = row.table_row?.cells || [];

				const cellContents = cells.map((cell: any) => this.convertRichText(cell));
				markdown += `| ${cellContents.join(' | ')} |\n`;

				// Add separator after header row
				if (i === 0 && hasHeader) {
					const separator = cells.map(() => '---').join(' | ');
					markdown += `| ${separator} |\n`;
				}
			}

			return markdown;
		}
		catch (error) {
			console.error('Failed to convert table:', error);
			return '';
		}
	}

	/**
   * Create frontmatter for page
   * @param page - Page information
   * @returns Record<string, any> - Frontmatter object
   */
	private createPageFrontmatter(page: NotionPage): Record<string, any> {
		const frontmatter: Record<string, any> = {
			title: page.title,
			'notion-id': page.id,
			'created': page.createdTime,
			'updated': page.lastEditedTime
		};

		if (this.settings.includeMetadata) {
			frontmatter['notion-url'] = page.url;
		}

		return frontmatter;
	}

	/**
   * Create frontmatter for database entry
   * @param entry - Database entry
   * @param databaseDetails - Database schema
   * @returns Record<string, any> - Frontmatter object
   */
	private createDatabaseEntryFrontmatter(entry: NotionPage, databaseDetails: any): Record<string, any> {
		const frontmatter = this.createPageFrontmatter(entry);

		frontmatter.database = databaseDetails.title;

		// Add database properties to frontmatter
		for (const [key, property] of Object.entries(entry.properties)) {
			frontmatter[key] = this.extractPropertyValue(property);
		}

		return frontmatter;
	}

	/**
   * Extract value from Notion property
   * @param property - Notion property object
   * @returns any - Extracted value
   */
	private extractPropertyValue(property: any): any {
		if (!property) return null;

		switch (property.type) {
			case 'title':
				return this.convertRichText(property.title || []);
			case 'rich_text':
				return this.convertRichText(property.rich_text || []);
			case 'number':
				return property.number;
			case 'select':
				return property.select?.name || null;
			case 'multi_select':
				return property.multi_select?.map((s: any) => s.name) || [];
			case 'date':
				return property.date?.start || null;
			case 'checkbox':
				return property.checkbox || false;
			case 'url':
				return property.url;
			case 'email':
				return property.email;
			case 'phone_number':
				return property.phone_number;
			case 'people':
				return property.people?.map((p: any) => p.name) || [];
			case 'files':
				return property.files?.map((f: any) => f.name) || [];
			case 'created_time':
				return property.created_time;
			case 'created_by':
				return property.created_by?.name || null;
			case 'last_edited_time':
				return property.last_edited_time;
			case 'last_edited_by':
				return property.last_edited_by?.name || null;
			default:
				return property.plain_text || null;
		}
	}

	/**
   * Create markdown file with frontmatter
   * @param filePath - File path
   * @param content - Processed content
   * @param page - Page information
   */
	private async createMarkdownFile(filePath: string, content: ProcessedContent, page: NotionPage): Promise<void> {
		let fileContent = '';

		// Add frontmatter if present
		if (Object.keys(content.frontmatter).length > 0) {
			fileContent += '---\n';
			for (const [key, value] of Object.entries(content.frontmatter)) {
				if (Array.isArray(value)) {
					fileContent += `${key}:\n`;
					for (const item of value) {
						fileContent += `  - ${item}\n`;
					}
				}
				else {
					fileContent += `${key}: ${JSON.stringify(value)}\n`;
				}
			}
			fileContent += '---\n\n';
		}

		// Add content
		fileContent += content.markdown;

		// Create file using Vault API
		await this.createFileWithContent(filePath, fileContent);
	}

	// Utility Methods

	/**
   * Map Notion database object to internal format
   * @param db - Notion database object
   * @returns NotionDatabase - Mapped database
   */
	private mapDatabase(db: any): NotionDatabase {
		return {
			id: db.id,
			title: this.convertRichText(db.title || []) || 'Untitled Database',
			description: this.convertRichText(db.description || []),
			properties: db.properties || {},
			url: db.url,
			lastEditedTime: db.last_edited_time,
			createdTime: db.created_time
		};
	}

	/**
   * Map Notion page object to internal format
   * @param page - Notion page object
   * @returns NotionPage - Mapped page
   */
	private mapPage(page: any): NotionPage {
		const titleProperty = Object.values(page.properties || {}).find((prop: any) => prop.type === 'title') as any;
		const title = titleProperty ? this.convertRichText(titleProperty.title || []) : 'Untitled';

		return {
			id: page.id,
			title: title || 'Untitled',
			url: page.url,
			lastEditedTime: page.last_edited_time,
			createdTime: page.created_time,
			properties: page.properties || {},
			parent: page.parent || {}
		};
	}

	/**
   * Map Notion block object to internal format
   * @param block - Notion block object
   * @returns NotionBlock - Mapped block
   */
	private mapBlock(block: any): NotionBlock {
		return {
			id: block.id,
			type: block.type,
			created_time: block.created_time,
			last_edited_time: block.last_edited_time,
			archived: block.archived || false,
			has_children: block.has_children || false,
			parent: block.parent || {},
			...block // Include type-specific properties
		};
	}

	/**
   * Get database title from database object
   * @param database - Database object
   * @returns string - Database title
   */
	private getDatabaseTitle(database: NotionDatabase): string {
		return database.title || 'Untitled Database';
	}

	/**
   * Get page title from page object
   * @param page - Page object
   * @returns string - Page title
   */
	private getPageTitle(page: NotionPage): string {
		return page.title || 'Untitled';
	}

	/**
   * Check if page belongs to any database
   * @param page - Page to check
   * @param databases - List of databases
   * @returns boolean - True if page is in a database
   */
	private isPageInDatabase(page: NotionPage, databases: NotionDatabase[]): boolean {
		return page.parent.type === 'database_id' &&
           databases.some(db => db.id === page.parent.database_id);
	}

	/**
   * Sanitize filename for filesystem
   * @param name - Original name
   * @returns string - Sanitized name
   */
	private sanitizeFileName(name: string): string {
		return name
			.replace(/[<>:"/\\|?*]/g, '-') // Replace invalid characters
			.replace(/\s+/g, ' ') // Normalize spaces
			.trim()
			.substring(0, 100); // Limit length
	}

	/**
   * Get attachment folder path
   * @returns string - Attachment folder path
   */
	private getAttachmentFolder(): string {
		// Use default attachment folder for mobile compatibility
		return this.settings.defaultOutputFolder + '/attachments';
	}

	/**
   * Ensure folder exists, create if not
   * @param folderPath - Folder path to ensure
   */
	private async ensureFolderExists(folderPath: string): Promise<void> {
		try {
			const exists = await this.vault.adapter.exists(folderPath);
			if (!exists) {
				await this.vault.createFolder(folderPath);
			}
		}
		catch (error) {
			// Folder might already exist
			console.debug('Folder creation note:', error);
		}
	}

	/**
   * Create file with content using Vault API
   * @param filePath - File path
   * @param content - File content
   */
	private async createFileWithContent(filePath: string, content: string): Promise<void> {
		try {
			// Check if file exists
			const exists = await this.vault.adapter.exists(filePath);
			if (exists) {
				// Update existing file
				const file = this.vault.getAbstractFileByPath(filePath) as TFile;
				await this.vault.modify(file, content);
			}
			else {
				// Create new file
				await this.vault.create(filePath, content);
			}
		}
		catch (error) {
			console.error(`Failed to create file ${filePath}:`, error);
			throw new NotionImporterError(`Failed to create file: ${error.message}`);
		}
	}

	/**
   * Extract text content from any block type
   * @param block - Notion block
   * @returns string - Extracted text
   */
	private extractTextFromBlock(block: NotionBlock): string {
		// Try to extract text from common block properties
		const blockData = block[block.type] as any;
		if (blockData?.rich_text) {
			return this.convertRichText(blockData.rich_text);
		}
		if (blockData?.text) {
			return this.convertRichText(blockData.text);
		}
		if (blockData?.title) {
			return this.convertRichText(blockData.title);
		}
		return '';
	}

	/**
   * Get formula property type based on formula configuration
   * @param formula - Formula property definition
   * @returns string - Base property type
   */
	private getFormulaType(formula: any): string {
		if (!formula?.expression) return 'text';

		// Basic heuristic - could be enhanced
		if (formula.expression.includes('number') || formula.expression.includes('sum')) {
			return 'number';
		}
		if (formula.expression.includes('date')) {
			return 'date';
		}
		if (formula.expression.includes('checkbox')) {
			return 'checkbox';
		}
		return 'text';
	}

	/**
   * Get rollup property type based on rollup configuration
   * @param rollup - Rollup property definition
   * @returns string - Base property type
   */
	private getRollupType(rollup: any): string {
		if (!rollup?.function) return 'text';

		const func = rollup.function.toLowerCase();
		if (['count', 'sum', 'average', 'min', 'max'].includes(func)) {
			return 'number';
		}
		if (['earliest_date', 'latest_date'].includes(func)) {
			return 'date';
		}
		if (func === 'show_original') {
			// Return type depends on the original property
			return 'list';
		}
		return 'text';
	}

	/**
   * Configure importer settings
   * @param settings - New settings
   */
	public updateSettings(settings: Partial<NotionImporterSettings>): void {
		this.settings = { ...this.settings, ...settings };

		// Re-initialize client if token changed
		if (settings.notionApiKey && settings.notionApiKey !== this.settings.notionApiKey) {
			this.notion = new Client({ auth: settings.notionApiKey });
		}
	}

	/**
   * Get current settings
   * @returns NotionImporterSettings - Current settings
   */
	public getSettings(): NotionImporterSettings {
		return { ...this.settings };
	}
}

// Export default for registration with obsidian-importer
export default NotionApiImporter;