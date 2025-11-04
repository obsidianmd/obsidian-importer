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
	extractFrontMatter,
	hasChildPagesOrDatabases
} from './notion-api/api-helpers';
import { convertBlocksToMarkdown } from './notion-api/block-converter';
import { pageExistsInVault, getUniqueFolderPath, getUniqueFilePath } from './notion-api/vault-helpers';
import { processDatabasePlaceholders, convertChildDatabase, createBaseFile, processRelationProperties } from './notion-api/database-helpers';
import { DatabaseInfo, RelationPlaceholder } from './notion-api/types';
import { downloadAttachment } from './notion-api/attachment-helpers';

export type FormulaImportStrategy = 'static' | 'function' | 'hybrid';

export class NotionAPIImporter extends FormatImporter {
	notionToken: string = '';
	pageId: string = '';
	formulaStrategy: FormulaImportStrategy = 'function'; // Default strategy
	downloadExternalAttachments: boolean = false; // Download external attachments
	coverPropertyName: string = 'cover'; // Custom property name for page cover
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

		// Download external attachments option
		new Setting(this.modal.contentEl)
			.setName('Download external attachments')
			.setDesc(this.createAttachmentDescription())
			.addToggle(toggle => {
				toggle
					.setValue(false)
					.onChange(value => {
						this.downloadExternalAttachments = value;
					});
			});

		// Cover property name
		new Setting(this.modal.contentEl)
			.setName('Cover property name')
			.setDesc(this.createCoverPropertyDescription())
			.addText(text => text
				.setPlaceholder('cover')
				.setValue('cover')
				.onChange(value => {
					this.coverPropertyName = value.trim() || 'cover';
				}));

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

	private createAttachmentDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Download external attachments (external URLs) to local files. ');
		frag.createEl('br');
		frag.appendText('Notion-hosted files are always downloaded. ');
		frag.createEl('br');
		frag.appendText('Attachments will be saved according to your vault\'s attachment folder settings.');
		return frag;
	}

	private createCoverPropertyDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Property name for page cover image in YAML frontmatter. ');
		frag.createEl('br');
		frag.appendText('Leave as "cover" if you don\'t have conflicts with existing properties.');
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
		structureLi.appendText('Pages without child pages or databases will be imported as individual ');
		structureLi.createEl('code', { text: '.md' });
		structureLi.appendText(' files. Pages with children will be represented as folders containing a ');
		structureLi.createEl('code', { text: '.md' });
		structureLi.appendText(' file with the same name as the folder. Databases are always represented as folders with ');
		structureLi.createEl('code', { text: '.base' });
		structureLi.appendText(' files (Obsidian database format with filter conditions).');
		
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
							method: init?.method || 'GET',
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
			
			// Fetch page blocks (content) with rate limit handling
			const blocks = await fetchAllBlocks(this.notionClient!, pageId, ctx);
			
			// Create a cache to store fetched blocks and avoid duplicate API calls
			// This cache will be used both for checking if page has children and for converting blocks
			const blocksCache = new Map<string, any[]>();
			
			// Check if page has child pages or child databases (recursively check nested blocks)
			// This will check not only top-level blocks, but also blocks nested in lists, toggles, etc.
			// The blocksCache will be populated during this check
			const hasChildren = await hasChildPagesOrDatabases(this.notionClient!, blocks, ctx, blocksCache);
			
			// Determine file structure based on whether page has children
			let pageFolderPath: string;
			let mdFilePath: string;
			
			if (hasChildren) {
				// Create folder structure for pages with children
				// The folder will contain the page content file and child pages/databases
				pageFolderPath = getUniqueFolderPath(this.vault, parentPath, sanitizedTitle);
				await this.createFolders(pageFolderPath);
				mdFilePath = `${pageFolderPath}/${sanitizedTitle}.md`;
			}
			else {
				// Create file directly for pages without children
				// No folder needed since there are no child pages or databases
				pageFolderPath = parentPath;
				mdFilePath = getUniqueFilePath(this.vault, parentPath, `${sanitizedTitle}.md`);
			}
			
			// Convert blocks to markdown with nested children support
			// Pass the blocksCache to reuse already fetched blocks
			let markdownContent = await convertBlocksToMarkdown(blocks, {
				ctx,
				currentFolderPath: pageFolderPath,
				client: this.notionClient!,
				vault: this.vault,
				downloadExternalAttachments: this.downloadExternalAttachments,
				indentLevel: 0,
				blocksCache, // reuse cached blocks
				// Callback to import child pages
				importPageCallback: async (childPageId: string, parentPath: string) => {
					await this.fetchAndImportPage(ctx, childPageId, parentPath);
				}
			});
		
			// Process database placeholders
			// Note: If hasChildren is false, there won't be any database placeholders to process
			// But we still call this function to maintain consistency
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
			
			// Clear the cache after processing this page to free memory
			blocksCache.clear();
			
			// Prepare YAML frontmatter
			const frontMatter = extractFrontMatter(page, this.formulaStrategy);
			
			// Process cover image if present
			if (frontMatter.cover && typeof frontMatter.cover === 'string') {
				try {
					// Determine cover type based on URL
					const coverUrl = frontMatter.cover;
					const isExternal = !coverUrl.includes('secure.notion-static.com');
					
					const coverPath = await downloadAttachment(
						{
							type: isExternal ? 'external' : 'file',
							url: coverUrl,
							name: 'cover'
						},
						this.vault,
						ctx,
						this.downloadExternalAttachments
					);
					
					// Update cover in frontmatter to use wiki link
					if (!coverPath.startsWith('http://') && !coverPath.startsWith('https://')) {
						// Use custom property name if different from 'cover'
						if (this.coverPropertyName !== 'cover') {
							delete frontMatter.cover;
							frontMatter[this.coverPropertyName] = `"[[${coverPath}]]"`;
						}
						else {
							frontMatter.cover = `"[[${coverPath}]]"`;
						}
					}
					else {
						// Keep as URL if not downloaded
						if (this.coverPropertyName !== 'cover') {
							delete frontMatter.cover;
							frontMatter[this.coverPropertyName] = coverUrl;
						}
						else {
							frontMatter.cover = coverUrl;
						}
					}
				}
				catch (error) {
					console.error(`Failed to download cover image:`, error);
					// Keep original URL on error
				}
			}
			
			// Create the markdown file
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
	 * Supports multi-round processing: if importing unimported databases discovers new relations,
	 * those databases will be imported in subsequent rounds until no new relations are found.
	 */
	private async replaceRelationPlaceholders(ctx: ImportContext): Promise<void> {
		if (this.relationPlaceholders.length === 0) {
			return;
		}
		
		ctx.status(`Replacing ${this.relationPlaceholders.length} relation placeholders...`);
		
		// Multi-round processing: keep importing databases until no new relations are discovered
		let round = 1;
		let previousPlaceholderCount = 0;
		const maxRounds = 10; // Safety limit to prevent infinite loops
		
		while (round <= maxRounds) {
			const currentPlaceholderCount = this.relationPlaceholders.length;
			
			// If no new placeholders were added in the last round, we're done
			if (round > 1 && currentPlaceholderCount === previousPlaceholderCount) {
				ctx.status(`No new relations discovered. Relation processing complete.`);
				break;
			}
			
			ctx.status(`Round ${round}: Processing ${currentPlaceholderCount} relation placeholders...`);
			previousPlaceholderCount = currentPlaceholderCount;
			
			// Identify missing pages and their databases
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
				ctx.status(`Round ${round}: Found ${missingDatabaseIds.size} unimported databases with relations. Importing...`);
				
				// Create "Relation Unimported Databases" folder
				const unimportedDbPath = `${this.outputRootPath}/Relation Unimported Databases`;
				try {
					await this.vault.createFolder(normalizePath(unimportedDbPath));
				}
				catch (error) {
					// Folder might already exist, that's ok
				}
				
				// Import each missing database
				let importedCount = 0;
				for (const databaseId of missingDatabaseIds) {
					if (ctx.isCancelled()) break;
					
					// Skip if already processed
					if (this.processedDatabases.has(databaseId)) {
						continue;
					}
					
					try {
						await this.importUnimportedDatabase(ctx, databaseId, unimportedDbPath);
						importedCount++;
					}
					catch (error) {
						console.error(`Failed to import unimported database ${databaseId}:`, error);
						// Continue with other databases even if one fails
					}
				}
				
				ctx.status(`Round ${round}: Imported ${importedCount} databases.`);
				
				// If we imported any databases, they might have added new relation placeholders
				// Continue to next round to process them
				if (importedCount > 0) {
					round++;
					continue;
				}
			}
			
			// If we reach here and no databases were imported, we're done
			break;
		}
		
		if (round > maxRounds) {
			console.warn(`⚠️ Reached maximum rounds (${maxRounds}) for relation processing. Some relations may not be resolved.`);
		}
		
		// Final pass: replace all placeholders with links
		// This happens after all rounds of database imports are complete
		ctx.status(`Replacing relation placeholders with wiki links...`);
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
			let dataSourceId = databaseId;
			
			if (database.data_sources && database.data_sources.length > 0) {
				dataSourceId = database.data_sources[0].id;
				const dataSource = await makeNotionRequest(
					() => this.notionClient!.dataSources.retrieve({ data_source_id: dataSourceId }),
					ctx
				);
				dataSourceProperties = dataSource.properties || {};
				// Note: Notion API does not provide property order information
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
			const baseFilePath = await createBaseFile(
				this.vault,
				sanitizedTitle,
				databaseFolderPath,
				this.outputRootPath,
				dataSourceProperties,
				this.formulaStrategy
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
		
			// Process relation properties in database pages
			// This will add placeholders to relationPlaceholders array for multi-round processing
			await processRelationProperties(
				databasePages,
				dataSourceProperties,
				this.relationPlaceholders
			);
		
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
