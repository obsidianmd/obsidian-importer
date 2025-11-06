import { Notice, Setting, normalizePath, requestUrl, TFile } from 'obsidian';
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

export type BaseViewType = 'table' | 'cards' | 'list';

export class NotionAPIImporter extends FormatImporter {
	notionToken: string = '';
	pageId: string = '';
	formulaStrategy: FormulaImportStrategy = 'function'; // Default strategy
	downloadExternalAttachments: boolean = false; // Download external attachments
	coverPropertyName: string = 'cover'; // Custom property name for page cover
	baseViewType: BaseViewType = 'table'; // Default view type for .base files
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
	// Simple progress counter: tracks total imported items (pages + attachments)
	private itemsImported: number = 0;
	// Track Notion ID (page/database) to file path mapping for mention replacement
	// Stores path relative to vault root without extension: "folder/subfolder/Page Title"
	// This allows wiki links to work correctly even with duplicate filenames: [[folder/Page Title]]
	private notionIdToPath: Map<string, string> = new Map();
	// Track mention placeholders for efficient replacement (similar to relationPlaceholders)
	// Maps source file path to the set of mentioned page/database IDs
	// Using file path as key allows O(1) file lookup instead of O(n) search
	private mentionPlaceholders: Map<string, Set<string>> = new Map();
	// Track synced blocks mapping (original block ID -> file path)
	// Used to reference synced block content across the vault
	private syncedBlocksMap: Map<string, string> = new Map();
	// Track synced child placeholders (file path -> Set of child IDs)
	// Used to efficiently replace synced child placeholders without scanning all files
	private syncedChildPlaceholders: Map<string, Set<string>> = new Map();

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

		// Base view type setting
		new Setting(this.modal.contentEl)
			.setName('Database view type')
			.setDesc(this.createBaseViewTypeDescription())
			.addDropdown(dropdown => dropdown
				.addOption('table', 'Table')
				.addOption('cards', 'Cards')
				.addOption('list', 'List')
				.setValue('table')
				.onChange(value => {
					this.baseViewType = value as BaseViewType;
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

	private createBaseViewTypeDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Choose the default view type for database .base files:');
		frag.createEl('br');
		frag.createEl('br');
		frag.appendText('• Table: Default table view, suitable for all database types');
		frag.createEl('br');
		frag.appendText('• Cards: Best for pages with cover images');
		frag.createEl('br');
		frag.appendText('• List: Display pages as an unordered list');
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
		const attachmentLi = ul.createEl('li');
		attachmentLi.appendText('Attachments, videos, images, and files from Notion will be placed according to your vault\'s ');
		attachmentLi.createEl('strong', { text: 'attachment folder settings' });
		attachmentLi.appendText('.');
		
		// Link format
		const linkLi = ul.createEl('li');
		linkLi.appendText('Links and embeds will use your vault\'s ');
		linkLi.createEl('strong', { text: 'link format settings' });
		linkLi.appendText(' (Wiki links or Markdown links). Check Settings → Files & Links.');
		
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
			this.itemsImported = 0;
		
			// Initialize progress display (indeterminate - we don't know total count)
			ctx.reportProgressIndeterminate(0);
		
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
				await this.importTopLevelDatabase(ctx, extractedPageId, folder.path, true); // isRootImport = true
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
		
			ctx.status('Processing mention links...');
			await this.replaceMentionPlaceholdersInAllFiles(ctx);
		
			ctx.status('Processing synced block child references...');
			await this.replaceSyncedChildPlaceholders(ctx);

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
	private async importTopLevelDatabase(ctx: ImportContext, databaseId: string, parentPath: string, isRootImport: boolean = false): Promise<void> {
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
					baseViewType: this.baseViewType,
					coverPropertyName: this.coverPropertyName,
					importPageCallback: async (pageId: string, parentPath: string, databaseTag?: string) => {
						await this.fetchAndImportPage(ctx, pageId, parentPath, databaseTag);
					},
					onPagesDiscovered: (count: number) => {
					// No longer need to track total count - using indeterminate progress
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
	 * @param databaseTag Optional database tag to add to page frontmatter (for database pages)
	 */
	private async fetchAndImportPage(ctx: ImportContext, pageId: string, parentPath: string, databaseTag?: string): Promise<void> {
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
		
			// Create a cache to store fetched blocks and avoid duplicate API calls
			// This cache will be used both for checking if page has children and for converting blocks
			const blocksCache = new Map<string, any[]>();
		
			// Fetch page blocks (content) with rate limit handling
			const blocks = await fetchAllBlocks(this.notionClient!, pageId, ctx);
			// Cache the root page blocks immediately
			blocksCache.set(pageId, blocks);
		
			// Check if page already exists in vault (by notion-id)
			if (await pageExistsInVault(this.app, this.vault, pageId)) {
				ctx.reportSkipped(sanitizedTitle, 'already exists in vault (notion-id match)');
				// Still count as imported (skipped items are also "processed")
				this.itemsImported++;
				ctx.reportProgressIndeterminate(this.itemsImported);
				return;
			}
		
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
			// Create a set to collect mentioned page/database IDs
			const mentionedIds = new Set<string>();
		
			let markdownContent = await convertBlocksToMarkdown(blocks, {
				ctx,
				currentFolderPath: pageFolderPath,
				client: this.notionClient!,
				vault: this.vault,
				downloadExternalAttachments: this.downloadExternalAttachments,
				indentLevel: 0,
				blocksCache, // reuse cached blocks
				mentionedIds, // collect mentioned IDs
				syncedBlocksMap: this.syncedBlocksMap, // for synced blocks
				outputRootPath: this.outputRootPath, // for synced blocks folder
				syncedChildPlaceholders: this.syncedChildPlaceholders, // for efficient synced child replacement
				currentPageTitle: sanitizedTitle, // for attachment naming fallback
				// Callback to import child pages
				importPageCallback: async (childPageId: string, parentPath: string) => {
					await this.fetchAndImportPage(ctx, childPageId, parentPath);
				},
				// Callback when an attachment is downloaded
				onAttachmentDownloaded: () => {
					this.itemsImported++;
					ctx.reportProgressIndeterminate(this.itemsImported);
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
					baseViewType: this.baseViewType,
					coverPropertyName: this.coverPropertyName,
					// Callback to import database pages
					importPageCallback: async (pageId: string, parentPath: string, databaseTag?: string) => {
						await this.fetchAndImportPage(ctx, pageId, parentPath, databaseTag);
					},
					// Callback to update discovered pages count
					onPagesDiscovered: (newPagesCount: number) => {
						// Don't update total dynamically to avoid confusing progress jumps
						// Child pages will be counted as they are imported
					}
				}
			);
			
			// Clear the cache after processing this page to free memory
			blocksCache.clear();
			
			// Prepare YAML frontmatter
			// Start with notion-id and notion-db at the top
			const frontMatter: Record<string, any> = {
				'notion-id': page.id,
			};
		
			// Add database tag if this page belongs to a database (right after notion-id)
			if (databaseTag) {
				frontMatter['notion-db'] = databaseTag;
			}
		
			// Extract all other properties from the page
			const extractedProps = extractFrontMatter(page, this.formulaStrategy);
			// Merge extracted properties (skip notion-id as we already added it)
			for (const key in extractedProps) {
				if (key !== 'notion-id') {
					frontMatter[key] = extractedProps[key];
				}
			}
		
			// Process cover image if present
			if (frontMatter.cover && typeof frontMatter.cover === 'string') {
				try {
				// Determine cover type based on URL
					const coverUrl = frontMatter.cover;
					const isExternal = !coverUrl.includes('secure.notion-static.com');
				
					// Cover images are always downloaded, regardless of downloadExternalAttachments setting
					// This is because Notion covers often use external URLs even for Notion-hosted images
					// Use the page title as the cover filename for better organization
					const result = await downloadAttachment(
						{
							type: isExternal ? 'external' : 'file',
							url: coverUrl,
							name: sanitizedTitle // Use page title as cover filename
						},
						{
							ctx,
							currentFolderPath: pageFolderPath,
							client: this.notionClient!,
							vault: this.vault,
							downloadExternalAttachments: true, // Always download cover images
							currentPageTitle: sanitizedTitle
						}
					);
		
					// For frontmatter, use wiki link syntax with double quotes for proper rendering
					// Cover images should always be downloaded locally
					if (result.isLocal && result.filename) {
					// Report progress for cover image download
						this.itemsImported++;
						ctx.reportProgressIndeterminate(this.itemsImported);
					
						// Extract extension from filename
						const ext = result.filename.substring(result.filename.lastIndexOf('.'));
						const fullPath = result.path + ext;
						// Use wiki link syntax with double quotes: "[[path]]"
						// The double quotes are necessary for YAML to render it as a link
						const coverValue = `[[${fullPath}]]`;
				
						// Update cover in frontmatter
						if (this.coverPropertyName !== 'cover') {
							delete frontMatter.cover;
							frontMatter[this.coverPropertyName] = coverValue;
						}
						else {
							frontMatter.cover = coverValue;
						}
					}
					else {
					// Download failed - log warning and keep original URL as fallback
						console.warn(`Failed to download cover image, keeping original URL: ${result.path}`);
						// Keep the original URL in frontmatter (without wiki link syntax)
						// This allows Dataview Cards view to attempt loading the external image
						// Note: This should rarely happen as we force download for covers
						if (this.coverPropertyName !== 'cover') {
						// If using custom property name, move the URL to the custom property
							const originalUrl = frontMatter.cover;
							delete frontMatter.cover;
							frontMatter[this.coverPropertyName] = originalUrl;
						}
					// If using default 'cover' property, the original URL is already there, no change needed
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
		
			// Update progress: page imported successfully
			this.itemsImported++;
			ctx.reportProgressIndeterminate(this.itemsImported);
	
			// Record page ID to path mapping for mention replacement
			// Store path without extension for wiki link generation
			const pathWithoutExt = mdFilePath.replace(/\.md$/, '');
			this.notionIdToPath.set(pageId, pathWithoutExt);
		
			// Record mention placeholders if any mentions were found
			// Use file path as key for O(1) lookup during replacement
			if (mentionedIds.size > 0) {
				this.mentionPlaceholders.set(mdFilePath, mentionedIds);
			}
	
			// Progress already updated above after successful creation
			
		}
		catch (error) {
			console.error(`Failed to import page ${pageId}:`, error);
			const pageTitle = 'Unknown page';
			ctx.reportFailed(pageTitle, error.message);
			// Count failed pages as processed
			this.itemsImported++;
			ctx.reportProgressIndeterminate(this.itemsImported);
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
					// Check if we have the file path mapping for this page (O(1) lookup)
					const relatedPagePath = this.notionIdToPath.get(relatedPageId);
					if (!relatedPagePath) {
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
			// Get the page file path from mapping (O(1) lookup)
				const pageFilePath = this.notionIdToPath.get(placeholder.pageId);
				if (!pageFilePath) {
					console.warn(`Could not find file path for page: ${placeholder.pageId}`);
					continue;
				}
			
				// Get the file directly by path (O(1) lookup)
				const pageFile = this.vault.getAbstractFileByPath(pageFilePath + '.md');
				if (!pageFile || !(pageFile instanceof TFile)) {
					console.warn(`Could not find page file: ${pageFilePath}`);
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
					// Get the related page file path from mapping (O(1) lookup)
					const relatedPagePath = this.notionIdToPath.get(relatedPageId);
					if (relatedPagePath) {
						const relatedPageFile = this.vault.getAbstractFileByPath(relatedPagePath + '.md');
						if (relatedPageFile instanceof TFile) {
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
							console.warn(`Could not find related page file: ${relatedPagePath}`);
						}
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
		
			// Note: Don't update progress for unimported database pages
			// Only root page and its direct children are counted in progress
		
			// Import each database page
			for (const page of databasePages) {
				if (ctx.isCancelled()) break;
				
				// Import the page
				await this.fetchAndImportPage(ctx, page.id, databaseFolderPath);
			}
			
			// Create .base file
			const baseFilePath = await createBaseFile({
				vault: this.vault,
				databaseName: sanitizedTitle,
				databaseFolderPath,
				outputRootPath: this.outputRootPath,
				dataSourceProperties,
				formulaStrategy: this.formulaStrategy,
				viewType: this.baseViewType,
				coverPropertyName: this.coverPropertyName
			});
			
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
	
		// Note: Don't call reportNoteSuccess here, progress is managed by reportProgress
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
	 * Replace mention placeholders ([[NOTION_PAGE:id]] and [[NOTION_DB:id]]) 
	 * Only processes files that have mentions (efficient like relationPlaceholders)
	 * Uses Obsidian's link generation to respect user's link format settings
	 */
	private async replaceMentionPlaceholdersInAllFiles(ctx: ImportContext): Promise<void> {
		if (this.mentionPlaceholders.size === 0) {
			return;
		}

		ctx.status(`Replacing mention placeholders...`);

		let replacedCount = 0;
		let filesModified = 0;

		// Iterate through files that have mentions (using file path as key for O(1) lookup)
		for (const [sourceFilePath, mentionedIds] of this.mentionPlaceholders) {
			if (ctx.isCancelled()) break;

			try {
				// Get the source file directly by path (O(1) lookup)
				const sourceFile = this.vault.getAbstractFileByPath(normalizePath(sourceFilePath));
				if (!sourceFile || !(sourceFile instanceof TFile)) {
					console.warn(`Could not find source file: ${sourceFilePath}`);
					continue;
				}

				// Read the file content
				let content = await this.vault.read(sourceFile);
				const originalContent = content;

				// Replace all mentioned page/database IDs in this file
				for (const mentionedId of mentionedIds) {
					let targetPath: string | undefined;
					
					// Try to find in pages first
					targetPath = this.notionIdToPath.get(mentionedId);
					
					// If not found, try databases
					if (!targetPath) {
						const dbInfo = this.processedDatabases.get(mentionedId);
						if (dbInfo) {
							targetPath = dbInfo.baseFilePath.replace(/\.base$/, '');
						}
					}
					
					if (!targetPath) {
						console.warn(`No mapping found for mention: ${mentionedId}`);
						continue;
					}

					// Try to find the target file (could be .md or .base)
					let targetFile = this.vault.getAbstractFileByPath(targetPath + '.md');
					if (!targetFile) {
						targetFile = this.vault.getAbstractFileByPath(targetPath + '.base');
					}

					if (targetFile instanceof TFile) {
						// Use Obsidian's API to generate link according to user's settings
						const link = this.app.fileManager.generateMarkdownLink(
							targetFile,
							sourceFile.path
						);
						
						// Replace all occurrences of this mention (global replace)
						// A page might mention the same page/database multiple times
						const regex = new RegExp(`\\[\\[NOTION_(PAGE|DB):${mentionedId}\\]\\]`, 'g');
						const matches = content.match(regex);
						if (matches) {
							content = content.replace(regex, link);
							replacedCount += matches.length;
						}
					}
					else {
						console.warn(`Target file not found: ${targetPath}`);
					}
				}

				// Save the file if it was modified
				if (content !== originalContent) {
					await this.vault.modify(sourceFile, content);
					filesModified++;
				}
			}
			catch (error) {
				console.error(`Failed to process mentions in file ${sourceFilePath}:`, error);
			}
		}

		ctx.status(`Replaced ${replacedCount} mention links in ${filesModified} files.`);
	}

	/**
 * Replace synced child placeholders (pages/databases referenced in synced blocks)
 * Strategy:
 * 1. Check if already imported → use existing path
 * 2. If not imported → try to import to Notion Synced Blocks folder
 * 3. If import fails → show friendly message
 * 
 * Performance: Only processes files that contain synced child placeholders (O(n) where n = files with placeholders)
 */
	private async replaceSyncedChildPlaceholders(ctx: ImportContext): Promise<void> {
		if (this.syncedChildPlaceholders.size === 0) {
			return;
		}
	
		ctx.status('Replacing synced block child references...');
	
		let replacedCount = 0;
		let filesModified = 0;
		let importedCount = 0;
	
		// Iterate through files that have synced child placeholders (efficient O(1) lookup)
		for (const [filePath, childIds] of this.syncedChildPlaceholders) {
			if (ctx.isCancelled()) break;
		
			try {
			// Get the file directly by path (O(1) lookup)
				const file = this.vault.getAbstractFileByPath(normalizePath(filePath));
				if (!file || !(file instanceof TFile)) {
					console.warn(`Could not find synced block file: ${filePath}`);
					continue;
				}
		
				let content = await this.vault.read(file);
				const originalContent = content;
			
				// Process each child ID that was recorded for this file
				for (const childId of childIds) {
				// Try as page first
					const pageId = childId;
					const pagePlaceholder = `[[SYNCED_CHILD_PAGE:${pageId}]]`;
				
					// Check if this is a page placeholder
					if (content.includes(pagePlaceholder)) {
						// Check if page is already imported
						let pagePath = this.notionIdToPath.get(pageId);
				
						if (pagePath) {
							// Already imported, use existing path
							const targetFile = this.vault.getAbstractFileByPath(pagePath + '.md');
							if (targetFile && targetFile instanceof TFile) {
								const link = this.app.fileManager.generateMarkdownLink(targetFile, file.path);
								content = content.replace(pagePlaceholder, link);
								replacedCount++;
							}
						}
						else {
							// Not imported yet, try to import to Notion Synced Blocks folder
							try {
								const syncedBlocksFolder = this.outputRootPath.split('/').slice(0, -1).join('/') + '/Notion Synced Blocks';
								await this.fetchAndImportPage(ctx, pageId, syncedBlocksFolder);
								importedCount++;
						
								// Now get the path
								pagePath = this.notionIdToPath.get(pageId);
								if (pagePath) {
									const targetFile = this.vault.getAbstractFileByPath(pagePath + '.md');
									if (targetFile && targetFile instanceof TFile) {
										const link = this.app.fileManager.generateMarkdownLink(targetFile, file.path);
										content = content.replace(pagePlaceholder, link);
										replacedCount++;
									}
								}
							}
							catch (error) {
								// Failed to import (no access or error)
								console.warn(`Failed to import synced child page ${pageId}:`, error);
								content = content.replace(pagePlaceholder, `**Page** _(no access)_`);
							}
						}
					}
			
					// Check if this is a database placeholder
					const databaseId = childId;
					const dbPlaceholder = `[[SYNCED_CHILD_DATABASE:${databaseId}]]`;
			
					if (content.includes(dbPlaceholder)) {
						// Check if database is already imported
						const dbInfo = this.processedDatabases.get(databaseId);
				
						if (dbInfo) {
							// Already imported, use existing .base file
							const baseFilePath = dbInfo.baseFilePath.replace(/\.base$/, '');
							const targetFile = this.vault.getAbstractFileByPath(baseFilePath + '.base');
							if (targetFile && targetFile instanceof TFile) {
								const link = this.app.fileManager.generateMarkdownLink(targetFile, file.path);
								content = content.replace(dbPlaceholder, link);
								replacedCount++;
							}
						}
						else {
							// Not imported yet, try to import
							try {
								const syncedBlocksFolder = this.outputRootPath.split('/').slice(0, -1).join('/') + '/Notion Synced Blocks';
						
								// Import database using importTopLevelDatabase
								await this.importTopLevelDatabase(ctx, databaseId, syncedBlocksFolder);
								importedCount++;
						
								// Now get the database info
								const newDbInfo = this.processedDatabases.get(databaseId);
								if (newDbInfo) {
									const baseFilePath = newDbInfo.baseFilePath.replace(/\.base$/, '');
									const targetFile = this.vault.getAbstractFileByPath(baseFilePath + '.base');
									if (targetFile && targetFile instanceof TFile) {
										const link = this.app.fileManager.generateMarkdownLink(targetFile, file.path);
										content = content.replace(dbPlaceholder, link);
										replacedCount++;
									}
								}
							}
							catch (error) {
								// Failed to import (no access or error)
								console.warn(`Failed to import synced child database ${databaseId}:`, error);
								content = content.replace(dbPlaceholder, `**Database** _(no access)_`);
							}
						}
					}
				}
			
				// Save the file if it was modified
				if (content !== originalContent) {
					await this.vault.modify(file, content);
					filesModified++;
				}
			}
			catch (error) {
				console.error(`Failed to process synced child placeholders in file ${filePath}:`, error);
			}
		}
	
		ctx.status(`Replaced ${replacedCount} synced child references in ${filesModified} files (imported ${importedCount} new items).`);
	}
	
}
