import { Notice, Setting, normalizePath, requestUrl } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { Client, PageObjectResponse } from '@notionhq/client';
import { sanitizeFileName, serializeFrontMatter } from '../util';

// Import helper modules
import { extractPageId } from './notion-api/utils';
import { 
	makeNotionRequest, 
	fetchAllBlocks, 
	extractPageTitle, 
	extractFrontMatter 
} from './notion-api/api-helpers';
import { convertBlocksToMarkdown } from './notion-api/block-converter';
import { pageExistsInVault, getUniqueFolderPath } from './notion-api/vault-helpers';
import { processDatabasePlaceholders, convertChildDatabase } from './notion-api/database-helpers';
import { DatabaseInfo, RelationPlaceholder } from './notion-api/types';

export type FormulaImportStrategy = 'static' | 'function' | 'hybrid';

export class NotionAPIImporter extends FormatImporter {
	notionToken: string = '';
	pageId: string = '';
	formulaStrategy: FormulaImportStrategy = 'function'; // Default strategy
	private notionClient: Client | null = null;
	private processedPages: Set<string> = new Set();
	private requestCount: number = 0;
	// save output root path for database handling
	//  we will flatten all database in this folder later
	private outputRootPath: string = '';
	// Track all processed databases for relation resolution
	private processedDatabases: Map<string, DatabaseInfo> = new Map();
	// Track all relation placeholders that need to be replaced
	private relationPlaceholders: RelationPlaceholder[] = [];
	// Track discovered pages for dynamic progress updates
	private totalPagesDiscovered: number = 0;
	private pagesCompleted: number = 0;

	init() {
		// No file chooser needed since we're importing via API
		this.addOutputLocationSetting('Notion API Import');

		// Notion API Token input
		new Setting(this.modal.contentEl)
			.setName('Notion API Token')
			.setDesc(this.createTokenDescription())
			.addText(text => text
				.setPlaceholder('secret_...')
				.setValue(this.notionToken)
				.onChange(value => {
					this.notionToken = value.trim();
				})
				.then(textComponent => {
					// Set as password input
					textComponent.inputEl.type = 'password';
				}));

		// Page ID input
		new Setting(this.modal.contentEl)
			.setName('Page ID')
			.setDesc(this.createPageIdDescription())
			.addText(text => text
				.setPlaceholder('Enter Notion page ID Or Page URL')
				.setValue(this.pageId)
				.onChange(value => {
					this.pageId = value.trim();
				}));

		// Formula import strategy
		new Setting(this.modal.contentEl)
			.setName('Formula import strategy')
			.setDesc(this.createFormulaStrategyDescription())
			.addDropdown(dropdown => {
				dropdown
					.addOption('static', 'Static values (YAML only)')
					.addOption('function', 'Base functions (default)')
					.addOption('hybrid', 'Hybrid (functions + fallback to static)')
					.setValue('function') // Explicitly set default to 'function'
					.onChange(value => {
						this.formulaStrategy = value as FormulaImportStrategy;
					});
			});

		// Description text
		new Setting(this.modal.contentEl)
			.setName('Import notes')
			.setDesc(this.createImportDescription())
			.setHeading();
	}

	private createTokenDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Enter your Notion integration token. ');
		frag.createEl('a', {
			text: 'Learn how to get your token',
			href: 'https://developers.notion.com/docs/create-a-notion-integration',
		});
		frag.appendText('.');
		return frag;
	}

	private createFormulaStrategyDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Choose how to import Notion formulas: ');
		frag.createEl('br');
		frag.appendText('• Static: Formula results as text in page YAML');
		frag.createEl('br');
		frag.appendText('• Function: Convert to Base functions (may fail for complex formulas)');
		frag.createEl('br');
		frag.appendText('• Hybrid: Try functions, fallback to static for complex formulas');
		return frag;
	}

	private createPageIdDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Enter the ID of the page you want to import. You can paste the full URL or just the ID. ');
		frag.createEl('a', {
			text: 'Learn how to find your page ID',
			href: 'https://developers.notion.com/docs/working-with-page-content#creating-a-page-with-content',
		});
		frag.appendText('.');
		return frag;
	}

	private createImportDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		const ul = frag.createEl('ul');
		
		// Attachment handling
		ul.createEl('li', { 
			text: 'Attachments, videos (non-YouTube), audio, images, and files from Notion will be placed according to your vault\'s attachment folder settings.' 
		});
		
		// File structure explanation
		const structureLi = ul.createEl('li');
		structureLi.appendText('Due to differences between Notion and Obsidian\'s file systems, Notion Pages and Databases will be represented as folders in Obsidian. ');
		structureLi.appendText('Page content will be stored in a ');
		structureLi.createEl('code', { text: 'Content.md' });
		structureLi.appendText(' file within the folder. If a Page contains Databases, they will be rendered as links in ');
		structureLi.createEl('code', { text: 'Content.md' });
		structureLi.appendText(', pointing to ');
		structureLi.createEl('code', { text: '.base' });
		structureLi.appendText(' files (Notion databases in Obsidian format with filter conditions) under the Page folder.');
		
		// API rate limit warning
		ul.createEl('li', { 
			text: 'Due to Notion API rate limits, importing large workspaces may take considerable time. Please be patient.' 
		});
		
		return frag;
	}

	async import(ctx: ImportContext): Promise<void> {
		// Validate inputs
		if (!this.notionToken) {
			new Notice('Please enter your Notion API token.');
			return;
		}

		if (!this.pageId) {
			new Notice('Please enter a Notion page ID.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		// Extract Page ID (if user pasted full URL)
		const extractedPageId = extractPageId(this.pageId);
		if (!extractedPageId) {
			new Notice('Invalid page ID or URL format.');
			return;
		}

		ctx.status('Connecting to Notion API...');

		try {
			// Initialize Notion client with latest API version
			// Using 2025-09-03 for better database/data source support
			// Use Obsidian's requestUrl instead of fetch to avoid context issues in some environments
			this.notionClient = new Client({ 
				auth: this.notionToken,
				notionVersion: '2025-09-03',
				fetch: async (url: RequestInfo | URL, init?: RequestInit) => { // we need custom fetch to avoid context issues in some environments
					const urlString = url.toString();
					
					try {
						const response = await requestUrl({
							url: urlString,
							method: (init?.method as any) || 'GET',
							headers: init?.headers as Record<string, string>,
							body: init?.body as string | ArrayBuffer,
							throw: false,
						});
						
						// Convert Obsidian response to fetch Response format
						return new Response(response.arrayBuffer, {
							status: response.status,
							statusText: response.status.toString(),
							headers: new Headers(response.headers),
						});
					}
					catch (error) {
						console.error('Request failed:', error);
						throw error;
					}
				},
			});

			ctx.status('Fetching page content from Notion...');
		
			// Reset processed pages tracker
			this.processedPages.clear();
			this.processedDatabases.clear();
			this.relationPlaceholders = [];
			this.totalPagesDiscovered = 0; // Will be updated as we discover pages
			this.pagesCompleted = 0;
		
			// Initialize progress display
			ctx.reportProgress(0, 0);
		
			// Save output root path for database handling
			this.outputRootPath = folder.path;
		
			// Check if the input is a database or a page by retrieving block info
			ctx.status('Checking block type...');
			const block = await makeNotionRequest(
				() => this.notionClient!.blocks.retrieve({ block_id: extractedPageId }) as Promise<any>,
				ctx
			);
		
			// Check block type and handle accordingly
			if (block.type === 'child_database') {
			// It's a database! Import it as a top-level database
				ctx.status('Input is a database, importing as top-level database...');
				await this.importTopLevelDatabase(ctx, extractedPageId, folder.path);
			}
			else if (block.type === 'child_page') {
			// It's a child page, import as page
				ctx.status('Input is a page, importing...');
				await this.fetchAndImportPage(ctx, extractedPageId, folder.path);
			}
			else {
			// Other block types (paragraph, heading, etc.) are not supported as entry points
				throw new Error(`Unsupported block type: ${block.type}. Please provide a page ID or database ID.`);
			}
		
			// After all pages are imported, replace relation placeholders
			ctx.status('Processing relation links...');
			await this.replaceRelationPlaceholders(ctx);
		
			ctx.status('Import completed successfully!');
		
		}
		catch (error) {
			console.error('Notion API import error:', error);
			ctx.reportFailed('Notion API import', error);
			new Notice(`Import failed: ${error.message}`);
		}
	}

	/**
	 * Import a top-level database (when user provides a database ID directly)
	 * 
	 * Note: We create a fake block object because convertChildDatabase() expects a BlockObjectResponse.
	 * This is a design limitation - convertChildDatabase() was originally designed to handle databases
	 * that are children of pages (from the blocks array), but we're reusing it for top-level databases.
	 * The fake block only needs the 'id' and 'type' fields, as the rest of the information is fetched
	 * from the Notion API inside convertChildDatabase().
	 */
	private async importTopLevelDatabase(ctx: ImportContext, databaseId: string, parentPath: string): Promise<void> {
		if (ctx.isCancelled()) return;
		
		try {
			// Create a minimal block object that satisfies convertChildDatabase()'s requirements
			// Only 'id' and 'type' are actually used by the function
			const fakeBlock: any = {
				id: databaseId,
				type: 'child_database',
				child_database: {
					title: 'Database'  // Placeholder, will be replaced by actual title from API
				}
			};
			
			// Import the database using the existing logic
			await convertChildDatabase(
				fakeBlock,
				{
					ctx,
					currentPageFolderPath: parentPath,
					client: this.notionClient!,
					vault: this.vault,
					outputRootPath: this.outputRootPath,
					formulaStrategy: this.formulaStrategy,
					processedDatabases: this.processedDatabases,
					relationPlaceholders: this.relationPlaceholders,
					importPageCallback: async (pageId: string, parentPath: string) => {
						await this.fetchAndImportPage(ctx, pageId, parentPath);
					},
					onPagesDiscovered: (count: number) => {
						this.totalPagesDiscovered += count;
						// Update progress immediately when discovering pages to show correct total
						ctx.reportProgress(this.pagesCompleted, this.totalPagesDiscovered);
					}
				}
			);
			
			// Note: Don't increment pagesCompleted for the database itself, 
			// only for the pages within it (which are counted in fetchAndImportPage)
		}
		catch (error) {
			console.error(`Failed to import database ${databaseId}:`, error);
			throw error;
		}
	}

	/**
	 * Fetch and import a Notion page recursively
	 */
	private async fetchAndImportPage(ctx: ImportContext, pageId: string, parentPath: string): Promise<void> {
		if (ctx.isCancelled()) return;
		
		// Check if already processed
		if (this.processedPages.has(pageId)) {
			return;
		}
		
		this.processedPages.add(pageId);
		
		try {
			// Fetch page metadata with rate limit handling
			const page = await makeNotionRequest(
				() => this.notionClient!.pages.retrieve({ page_id: pageId }) as Promise<PageObjectResponse>,
				ctx
			);
			
			// Extract page title
			const pageTitle = extractPageTitle(page);
			const sanitizedTitle = sanitizeFileName(pageTitle || 'Untitled');
			
			// Update status with page title instead of ID
			ctx.status(`Importing: ${pageTitle || 'Untitled'}...`);
			
			// Check if page already exists in vault (by notion-id)
			if (await pageExistsInVault(this.app, this.vault, pageId)) {
				ctx.reportSkipped(sanitizedTitle, 'already exists in vault (notion-id match)');
				this.pagesCompleted++;
				ctx.reportProgress(this.pagesCompleted, this.totalPagesDiscovered);
				return;
			}
			
			// Create page folder with unique name
			const pageFolderPath = getUniqueFolderPath(this.vault, parentPath, sanitizedTitle);
			await this.createFolders(pageFolderPath);
			
			// Fetch page blocks (content) with rate limit handling
			const blocks = await fetchAllBlocks(this.notionClient!, pageId, ctx);
			
			// Convert blocks to markdown with nested children support
			let markdownContent = await convertBlocksToMarkdown(blocks, ctx, pageFolderPath, this.notionClient!);
		
			// Process database placeholders
			markdownContent = await processDatabasePlaceholders(
				markdownContent,
				blocks,
				{
					ctx,
					currentPageFolderPath: pageFolderPath,
					client: this.notionClient!,
					vault: this.vault,
					outputRootPath: this.outputRootPath,
					formulaStrategy: this.formulaStrategy,
					processedDatabases: this.processedDatabases,
					relationPlaceholders: this.relationPlaceholders,
					// Callback to import database pages
					importPageCallback: async (pageId: string, parentPath: string) => {
						await this.fetchAndImportPage(ctx, pageId, parentPath);
					},
					// Callback to update discovered pages count
					onPagesDiscovered: (newPagesCount: number) => {
						this.totalPagesDiscovered += newPagesCount;
						// Update progress immediately when discovering pages to show correct total
						ctx.reportProgress(this.pagesCompleted, this.totalPagesDiscovered);
					}
				}
			);
			
			// Prepare YAML frontmatter
			const frontMatter = extractFrontMatter(page, this.formulaStrategy);
			
			// Create the markdown file
			const mdFilePath = `${pageFolderPath}/${sanitizedTitle}.md`;
			const fullContent = serializeFrontMatter(frontMatter) + markdownContent;
			
			await this.vault.create(normalizePath(mdFilePath), fullContent);
			ctx.reportNoteSuccess(sanitizedTitle);
			
			// Update progress
			this.pagesCompleted++;
			ctx.reportProgress(this.pagesCompleted, this.totalPagesDiscovered);
			
		}
		catch (error) {
			console.error(`Failed to import page ${pageId}:`, error);
			const pageTitle = 'Unknown page';
			ctx.reportFailed(pageTitle, error.message);
			this.pagesCompleted++;
			ctx.reportProgress(this.pagesCompleted, this.totalPagesDiscovered);
		}
	}
	
	/**
	 * Replace all relation placeholders with actual links after all pages are imported
	 */
	private async replaceRelationPlaceholders(ctx: ImportContext): Promise<void> {
		if (this.relationPlaceholders.length === 0) {
			return;
		}
		
		ctx.status(`Replacing ${this.relationPlaceholders.length} relation placeholders...`);
		
		// First pass: identify missing pages and their databases
		const missingPageIds = new Set<string>();
		const missingDatabaseIds = new Set<string>();
		
		for (const placeholder of this.relationPlaceholders) {
			for (const relatedPageId of placeholder.relatedPageIds) {
				const relatedPageFile = await this.findPageFileByNotionId(relatedPageId);
				if (!relatedPageFile) {
					missingPageIds.add(relatedPageId);
					// If we have target database info, record it
					if (placeholder.targetDatabaseId) {
						missingDatabaseIds.add(placeholder.targetDatabaseId);
					}
				}
			}
		}
		
		// Import missing databases if any
		if (missingDatabaseIds.size > 0) {
			ctx.status(`Found ${missingDatabaseIds.size} unimported databases with relations. Importing...`);
			
			// Create "Relation Unimported Databases" folder
			const unimportedDbPath = `${this.outputRootPath}/Relation Unimported Databases`;
			try {
				await this.vault.createFolder(normalizePath(unimportedDbPath));
			}
			catch (error) {
				// Folder might already exist, that's ok
			}
			
			// Import each missing database
			for (const databaseId of missingDatabaseIds) {
				if (ctx.isCancelled()) break;
				
				// Skip if already processed
				if (this.processedDatabases.has(databaseId)) {
					continue;
				}
				
				try {
					await this.importUnimportedDatabase(ctx, databaseId, unimportedDbPath);
				}
				catch (error) {
					console.error(`Failed to import unimported database ${databaseId}:`, error);
				}
			}
		}
		
		// Second pass: replace all placeholders with links
		for (const placeholder of this.relationPlaceholders) {
			if (ctx.isCancelled()) break;
			
			try {
				// Find the page file by notion-id
				const pageFile = await this.findPageFileByNotionId(placeholder.pageId);
				if (!pageFile) {
					console.warn(`Could not find page file for notion-id: ${placeholder.pageId}`);
					continue;
				}
				
				// Read the file content
				let content = await this.vault.read(pageFile);
				
				// Parse frontmatter
				const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
				const match = content.match(frontmatterRegex);
				
				if (!match) {
					console.warn(`No frontmatter found in file: ${pageFile.path}`);
					continue;
				}
				
				let newContent = content;
				
				// Build the actual links
				for (const relatedPageId of placeholder.relatedPageIds) {
					const relatedPageFile = await this.findPageFileByNotionId(relatedPageId);
					if (relatedPageFile) {
						// Use Obsidian wiki link with display text: [[path/to/file|display name]]
						// This ensures precise linking (no ambiguity with duplicate names)
						// while displaying only the clean file name
						const fullPath = relatedPageFile.path.replace(/\.md$/, ''); // Full path without .md
						const displayName = relatedPageFile.basename; // Just the file name for display
						const wikiLink = `"[[${fullPath}|${displayName}]]"`;
						
						// Replace the page ID with the wiki link in the YAML
						// The page IDs are stored as array items in YAML
						newContent = newContent.replace(
							new RegExp(`"${relatedPageId}"`, 'g'),
							wikiLink
						);
						newContent = newContent.replace(
							new RegExp(`${relatedPageId}`, 'g'),
							wikiLink
						);
					}
					else {
						// Page still not found after importing missing databases
						console.warn(`Could not find related page: ${relatedPageId}`);
					}
				}
				
				// Write back to file if content changed
				if (newContent !== content) {
					await this.vault.modify(pageFile, newContent);
				}
			}
			catch (error) {
				console.error(`Failed to replace relation placeholder for page ${placeholder.pageId}:`, error);
			}
		}
	}
	
	/**
	 * Import a database that was not in the original import scope
	 * but is needed for relation links
	 */
	private async importUnimportedDatabase(ctx: ImportContext, databaseId: string, parentPath: string): Promise<void> {
		try {
			ctx.status(`Importing unimported database ${databaseId}...`);
			
			// Get database details
			const database = await makeNotionRequest(
				() => this.notionClient!.databases.retrieve({ database_id: databaseId }) as Promise<any>,
				ctx
			);
			
			// Extract database title
			const databaseTitle = database.title && database.title.length > 0
				? database.title.map((t: any) => t.plain_text).join('')
				: 'Untitled Database';
			const sanitizedTitle = sanitizeFileName(databaseTitle);
			
			// Get data source information
			let dataSourceProperties: Record<string, any> = {};
			let propertyIds: string[] = [];
			let dataSourceId = databaseId;
			
			if (database.data_sources && database.data_sources.length > 0) {
				dataSourceId = database.data_sources[0].id;
				const dataSource = await makeNotionRequest(
					() => this.notionClient!.dataSources.retrieve({ data_source_id: dataSourceId }),
					ctx
				);
				dataSourceProperties = (dataSource as any).properties || {};
				propertyIds = (dataSource as any).property_ids || [];
			}
			
			// Create database folder
			const databaseFolderPath = getUniqueFolderPath(this.vault, parentPath, sanitizedTitle);
			await this.vault.createFolder(normalizePath(databaseFolderPath));
			
			// Query database to get all pages
			const databasePages = await this.queryDatabasePages(dataSourceId, ctx);
			
			ctx.status(`Found ${databasePages.length} pages in unimported database ${sanitizedTitle}`);
			
			// Update total pages discovered to include these new pages
			this.totalPagesDiscovered += databasePages.length;
			ctx.reportProgress(this.pagesCompleted, this.totalPagesDiscovered);
			
			// Import each database page
			for (const page of databasePages) {
				if (ctx.isCancelled()) break;
				
				// Import the page
				await this.fetchAndImportPage(ctx, page.id, databaseFolderPath);
			}
			
			// Create .base file
			const { createBaseFile } = await import('./notion-api/database-helpers');
			const baseFilePath = await createBaseFile(
				this.vault,
				sanitizedTitle,
				databaseFolderPath,
				this.outputRootPath,
				dataSourceProperties,
				databasePages,
				this.formulaStrategy,
				propertyIds
			);
			
			// Record database information
			const databaseInfo: DatabaseInfo = {
				id: databaseId,
				title: sanitizedTitle,
				folderPath: databaseFolderPath,
				baseFilePath: baseFilePath,
				properties: dataSourceProperties,
				dataSourceId: dataSourceId,
			};
			this.processedDatabases.set(databaseId, databaseInfo);
			
			ctx.reportNoteSuccess(`Database: ${sanitizedTitle}`);
		}
		catch (error) {
			console.error(`Failed to import unimported database ${databaseId}:`, error);
			ctx.reportFailed(`Database ${databaseId}`, error.message);
		}
	}
	
	/**
	 * Query all pages from a database with pagination
	 */
	private async queryDatabasePages(dataSourceId: string, ctx: ImportContext): Promise<any[]> {
		const pages: any[] = [];
		let cursor: string | undefined = undefined;
		
		do {
			const response: any = await makeNotionRequest(
				() => this.notionClient!.dataSources.query({
					data_source_id: dataSourceId,
					start_cursor: cursor,
					page_size: 100,
				}),
				ctx
			);
			
			// Filter to get full page objects
			const fullPages = response.results.filter(
				(page: any) => page.object === 'page'
			);
			
			pages.push(...fullPages);
			cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
			
		} while (cursor);
		
		return pages;
	}
	
	/**
	 * Find a page file by its notion-id in frontmatter
	 */
	private async findPageFileByNotionId(notionId: string): Promise<any> {
		const files = this.vault.getMarkdownFiles();
		
		for (const file of files) {
			try {
				const content = await this.vault.read(file);
				const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
				const match = content.match(frontmatterRegex);
				
				if (match) {
					const frontmatter = match[1];
					// Check if this file has the matching notion-id
					if (frontmatter.includes(`notion-id: ${notionId}`)) {
						return file;
					}
				}
			}
			catch (error) {
				// Skip files that can't be read
				continue;
			}
		}
		
		return null;
	}
	
}
