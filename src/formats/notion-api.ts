import { FrontMatterCache, Notice, normalizePath, requestUrl, TFile, TFolder, DataWriteOptions } from 'obsidian';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { Client, PageObjectResponse } from '@notionhq/client';
import { extractErrorMessage, sanitizeFileName, serializeFrontMatter, getUniqueFilePath, plural } from '../util';
import { areAnySelected } from '../tree';
import { describeRequestFailure } from '../request-failure';
import { TreePicker } from '../tree-view';
import type { FormulaImportStrategy } from '../base';
import { parseFilePath } from '../filesystem';

// Import helper modules
import { NOTION_ID_PROPERTY } from '../constants';
import { createPlaceholder, PlaceholderType } from './notion-api/utils';
import {
	makeNotionRequest,
	fetchAllBlocks,
	extractPageTitle,
	extractFrontMatter,
	hasChildPagesOrDatabases
} from './notion-api/api-helpers';
import { convertBlocksToMarkdown } from './notion-api/block-converter';
import { processDatabasePlaceholders, importDatabaseCore, replaceRelationValue } from './notion-api/database-helpers';
import { DatabaseInfo, RelationPlaceholder, DatabaseProcessingContext, FetchAndImportPageParams, NOTION_VERSION } from './notion-api/types';
import { downloadAttachment } from './notion-api/attachment-helpers';
import { buildTree, collectItems, type NotionTreeNode } from './notion-api/discovery';



export class NotionAPIImporter extends FormatImporter {
	interruption = 'pause' as const;

	get notionToken(): string {
		return this.getSecret() ?? '';
	}

	get sourceReady(): boolean {
		return areAnySelected(this.pickedTree);
	}

	formulaStrategy: FormulaImportStrategy = 'hybrid'; // Default strategy
	importLinkedDatabases: boolean = false;
	downloadExternalAttachments: boolean = false; // Download external attachments
	singleLineBreaks: boolean = false; // Single line breaks between blocks (default: disabled)
	coverPropertyName: string = 'cover'; // Custom property name for page cover
	databasePropertyName: string = 'base'; // Property name for linking pages to their database
	get incrementalImport(): boolean {
		return this.duplicateHandling !== DuplicateHandling.CreateCopy;
	}
	private notionClient: Client | null = null;
	private processedPages: Set<string> = new Set();
	private requestCount: number = 0;
	private totalNodesToImport: number = 0; // Total number of nodes selected for import
	private selectedNodeIds: Set<string> = new Set(); // IDs of nodes selected in tree for progress tracking
	private picker: TreePicker<NotionTreeNode>;

	private get pickedTree(): NotionTreeNode[] {
		return this.picker?.nodes ?? [];
	}
	// save output root path for database handling
	//  we will flatten all database in this folder later
	private outputRootPath: string = '';
	// Track all processed databases for relation resolution
	private processedDatabases: Map<string, DatabaseInfo> = new Map();
	// Track all relation placeholders that need to be replaced
	private relationPlaceholders: RelationPlaceholder[] = [];
	private relatedPageTitles: Map<string, string | null> = new Map();
	// Progress counters: separate tracking for pages and attachments
	private processedPagesCount: number = 0; // Total processed (imported + skipped) for progress tracking
	// Track Notion ID (page/database) to file path mapping for mention replacement
	// Stores path relative to vault root without extension: "folder/subfolder/Page Title"
	// This allows wiki links to work correctly even with duplicate filenames: [[folder/Page Title]]
	private notionIdToPath: Map<string, string> = new Map();
	private writtenPaths: Set<string> = new Set();
	private recoveredPaths: Set<string> = new Set();
	// Track mention placeholders for efficient replacement (similar to relationPlaceholders)
	// Maps source file path to the set of mentioned page/database IDs
	// Using file path as key allows O(1) file lookup instead of O(n) search
	private mentionPlaceholders: Map<string, Set<string>> = new Map();
	// Track synced blocks mapping (original block ID -> file path)
	// Used to reference synced block content across the vault
	private syncedBlocksMap: Map<string, string> = new Map();
	// Track synced child placeholders (file path -> Set of child IDs)
	// Used to efficiently replace synced child placeholders without scanning all files
	// Separated by type to avoid unnecessary placeholder checks
	private syncedChildPagePlaceholders: Map<string, Set<string>> = new Map();
	private syncedChildDatabasePlaceholders: Map<string, Set<string>> = new Map();

	init() {
		// No file chooser needed since we're importing via API
		this.defaultOutputFolder = 'Notion';
		this.idProperty = NOTION_ID_PROPERTY;
		this.idLabel = i18n.importer.notionApi.labelId();

		this.addSecretSetting(i18n.importer.notionApi.nameToken(), this.createTokenDescription());

		const contentEl = this.host.sourceEl;
		if (!contentEl) return;

		this.picker = new TreePicker<NotionTreeNode>(contentEl, {
			name: i18n.importer.notionApi.namePages(),
			desc: i18n.importer.notionApi.descPages(),
			hint: i18n.importer.notionApi.hintPages(),
			loading: i18n.importer.notionApi.msgLoadingPages(),
			empty: i18n.importer.notionApi.msgNoPages(),
			failed: error => describeRequestFailure(error, {
				name: i18n.importer.notionApi.labelService(),
				subject: i18n.importer.notionApi.labelSubject(),
				credential: i18n.importer.notionApi.labelCredential(),
			}),
			view: {
				icon: node => node.type === 'database' ? 'database'
					: node.children.length === 0 ? 'file'
						: node.collapsed ? 'folder' : 'folder-open',
			},
			onChange: () => this.sourceChanged(),
		});

		this.picker.onLoad(() => void this.loadPageTree());

		this.duplicateModes = [DuplicateHandling.CreateCopy, DuplicateHandling.Skip];

		// Formula import strategy
		this.addSetting()
			?.setName(i18n.importer.notionApi.nameFormulas())
			.setDesc(this.createFormulaStrategyDescription())
			.addDropdown(dropdown => {
				dropdown
					.addOption('hybrid', i18n.importer.notionApi.optionFormulaHybrid())
					.addOption('static', i18n.importer.notionApi.optionFormulaStatic())
					.setValue('hybrid') // Set default to 'hybrid'
					.onChange(value => {
						this.formulaStrategy = value as FormulaImportStrategy;
					});
			});

		// Download external attachments option
		this.addSetting()
			?.setName(i18n.importer.notionApi.nameDownloadExternal())
			.setDesc(i18n.importer.notionApi.descDownloadExternal())
			.addToggle(toggle => {
				toggle
					.setValue(false)
					.onChange(value => {
						this.downloadExternalAttachments = value;
					});
			});

		// Single line breaks option
		this.addSetting()
			?.setName(i18n.importer.notionApi.nameSingleLineBreaks())
			.setDesc(i18n.importer.notionApi.descSingleLineBreaks())
			.addToggle(toggle => {
				toggle
					.setValue(false)
					.onChange(value => {
						this.singleLineBreaks = value;
					});
			});

		// Cover property name
		this.addSetting()
			?.setName(i18n.importer.notionApi.nameCoverProperty())
			.setDesc(this.createCoverPropertyDescription())
			.addText(text => text
				.setPlaceholder('cover')
				.setValue('cover')
				.onChange(value => {
					this.coverPropertyName = value.trim() || 'cover';
				}));

		// Database property name
		this.addSetting()
			?.setName(i18n.importer.notionApi.nameDatabaseProperty())
			.setDesc(i18n.importer.notionApi.descDatabaseProperty())
			.addText(text => text
				.setPlaceholder('base')
				.setValue('base')
				.onChange(value => {
					this.databasePropertyName = value.trim() || 'base';
				}));

		this.addSetting()
			?.setName(i18n.importer.notionApi.nameLinkedDatabases())
			.setDesc(i18n.importer.notionApi.descLinkedDatabases())
			.addToggle(toggle => toggle
				.setValue(this.importLinkedDatabases)
				.onChange(value => {
					this.importLinkedDatabases = value;
				}));
	}

	private createTokenDescription(): DocumentFragment {
		const frag = createFragment();
		frag.appendText(i18n.importer.notionApi.descToken());
		frag.createEl('a', {
			text: i18n.importer.notionApi.linkGetToken(),
			href: 'https://app.notion.com/developers/connections',
		});
		return frag;
	}

	private createFormulaStrategyDescription(): DocumentFragment {
		const frag = createFragment();
		frag.appendText(i18n.importer.notionApi.descFormulas());
		return frag;
	}

	private createCoverPropertyDescription(): DocumentFragment {
		const frag = createFragment();
		frag.appendText(i18n.importer.notionApi.descCoverProperty());
		frag.createEl('br');
		frag.appendText(i18n.importer.notionApi.descCoverPropertyConflicts());
		return frag;
	}

	/**
	 * Initialize Notion client if not already initialized
	 */
	private initializeNotionClient(): void {
		this.notionClient = new Client({
			auth: this.notionToken,
			notionVersion: NOTION_VERSION,
			fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
				const urlString = url instanceof URL ? url.href : typeof url === 'string' ? url : url.url;

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
	}

	private async loadPageTree(): Promise<void> {
		if (!this.notionToken) {
			new Notice(i18n.importer.notionApi.msgTokenFirst());
			return;
		}

		try {
			await this.picker.load(() => this.readPages());
		}
		catch (error) {
			console.error('[Notion Importer] Failed to load pages:', error);
			new Notice(i18n.importer.notionApi.msgLoadPagesFailed({
				error: extractErrorMessage(error) ?? i18n.common.msgUnknownError(),
			}));
		}
	}

	private async readPages(): Promise<NotionTreeNode[]> {
		this.initializeNotionClient();

		const tempCtx = {
			status: (msg: string) => this.picker.setStatus(msg),
			isCancelled: () => false,
			reportFailed: (name: string, error: any) => {
				console.error(`Failed: ${name}`, error);
			},
			statusMessage: '',
		} as unknown as ImportContext;

		const allRawItems: any[] = [];
		let cursor: string | undefined = undefined;
		let pageCount = 0;

		do {
			pageCount++;
			tempCtx.status(i18n.importer.notionApi.statusLoadingItems({
				items: i18n.nouns.itemWithCount({ count: allRawItems.length }),
				page: pageCount,
			}));

			const response = await makeNotionRequest(
				() => this.notionClient!.search({
					start_cursor: cursor,
					page_size: 100,
				}),
				tempCtx
			);

			allRawItems.push(...response.results);
			cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
		} while (cursor);

		const allItems = collectItems(allRawItems);
		new Notice(i18n.importer.notionApi.msgFound({ count: allItems.length }));

		return buildTree(allItems);
	}

	/**
	 * Find a node by ID in the tree (recursive search)
	 */
	private findNodeById(nodes: NotionTreeNode[], id: string): NotionTreeNode | null {
		for (const node of nodes) {
			if (node.id === id) {
				return node;
			}
			if (node.children.length > 0) {
				const found = this.findNodeById(node.children, id);
				if (found) return found;
			}
		}
		return null;
	}

	/**
	 * Get all selected node IDs and populate selectedNodeIds for progress tracking
	 * Returns only top-level selected nodes (not disabled children) for import loop
	 * Side effect: Populates this.selectedNodeIds with ALL selected PAGE nodes (excluding databases)
	 * and sets this.totalNodesToImport
	 * Note: Databases are not counted because they are containers, not pages to import
	 */
	private getSelectedNodeIds(): string[] {
		const topLevelSelected: string[] = [];
		let totalPageCount = 0;
		this.selectedNodeIds.clear(); // Reset the set

		const collectNodes = (nodes: NotionTreeNode[]) => {
			for (const node of nodes) {
				if (node.selected) {
					// Only count pages for progress tracking (databases are just containers)
					if (node.type === 'page') {
						totalPageCount++;
						this.selectedNodeIds.add(node.id);
					}

					// Add to return array if it's a top-level selection (not disabled)
					// This includes both pages and databases for the import loop
					if (!node.disabled) {
						topLevelSelected.push(node.id);
					}
				}
				collectNodes(node.children);
			}
		};

		collectNodes(this.pickedTree);
		this.totalNodesToImport = totalPageCount; // Set total count for progress tracking (pages only)	
		return topLevelSelected;
	}

	async import(ctx: ImportContext): Promise<void> {
		this.writtenPaths.clear();
		this.recoveredPaths.clear();

		// Validate inputs
		if (!this.notionToken) {
			new Notice(i18n.importer.notionApi.msgTokenMissing());
			return;
		}

		// Get selected pages/databases
		const selectedIds = this.getSelectedNodeIds();
		if (selectedIds.length === 0) {
			new Notice(i18n.importer.notionApi.msgPickPage());
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		ctx.status(i18n.importer.notionApi.statusConnecting());

		try {
			// Re-initialize client to ensure current token is used
			this.initializeNotionClient();

			ctx.status(i18n.importer.notionApi.statusFetching());

			// Reset processed pages tracker
			this.processedPages.clear();
			this.processedDatabases.clear();
			this.relationPlaceholders = [];
			this.relatedPageTitles.clear();
			this.processedPagesCount = 0;

			// Note: getSelectedNodeIds() already populated this.selectedNodeIds and this.totalNodesToImport
			ctx.status(i18n.importer.notionApi.statusPreparing({
				items: i18n.nouns.itemWithCount({ count: this.totalNodesToImport }),
			}));

			// Initialize progress display with known total count
			ctx.reportProgress(0, this.totalNodesToImport);

			// Save output root path for database handling
			this.outputRootPath = folder.path;

			// Import all selected pages/databases
			ctx.status(i18n.importer.notionApi.statusImportingItems({
				items: i18n.nouns.itemWithCount({ count: selectedIds.length }),
			}));

			for (let i = 0; i < selectedIds.length; i++) {
				if (await ctx.shouldStop()) break;

				const itemId = selectedIds[i];
				ctx.status(i18n.importer.notionApi.statusImportingItem({ index: i + 1, total: selectedIds.length }));

				try {
					// Find the node in the tree to determine its type
					const node = this.findNodeById(this.pickedTree, itemId);

					if (!node) {
						console.warn(`Could not find node with ID: ${itemId}`);
						ctx.reportFailed(i18n.importer.notionApi.labelItem({ id: itemId }), i18n.importer.notionApi.reasonNotInTree());
						continue;
					}

					if (node.type === 'database') {
						// It's a database (data_source)!
						// Use the data_source ID directly - no need to call databases.retrieve()
						// The importDatabaseCore will use this as data_source_id
						await this.importTopLevelDatabase(ctx, itemId, folder.path, {
							isDataSourceId: true
						});
					}
					else if (node.type === 'page') {
						// It's a page, import as page
						await this.fetchAndImportPage({ ctx, pageId: itemId, parentPath: folder.path });
					}
					else {
						console.warn(`Unknown node type: ${String(node.type)} (ID: ${itemId})`);
						ctx.reportFailed(
							i18n.importer.notionApi.labelItem({ id: itemId }),
							i18n.importer.notionApi.reasonUnknownType({ type: String(node.type) })
						);
					}
				}
				catch (error) {
					console.error(`Failed to import item ${itemId}:`, error);
					ctx.reportFailed(i18n.importer.notionApi.labelItem({ id: itemId }), error);
					// Continue with next item
				}
			}

			// After all pages are imported, replace relation placeholders
			ctx.status(i18n.importer.notionApi.statusRelationLinks());
			await this.replaceRelationPlaceholders(ctx);

			ctx.status(i18n.importer.notionApi.statusMentionLinks());
			await this.replaceMentionPlaceholdersInAllFiles(ctx);

			ctx.status(i18n.importer.notionApi.statusSyncedBlocks());
			await this.replaceSyncedChildPlaceholders(ctx);

			if (!this.saveSourceId) {
				ctx.status(i18n.importer.notionApi.statusCleaningIds());
				await this.cleanupNotionIds(ctx);
			}

			if (!ctx.isCancelled()) ctx.status(i18n.importer.notionApi.statusDone());

		}
		catch (error) {
			console.error('Notion API import error:', error);
			ctx.reportFailed(i18n.importer.notionApi.labelImport(), error);
			new Notice(i18n.importer.notionApi.msgImportFailed({ error: extractErrorMessage(error) ?? '' }));
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
	private async importTopLevelDatabase(
		ctx: ImportContext,
		databaseId: string,
		parentPath: string,
		options: {
			isDataSourceId?: boolean;
		} = {}
	): Promise<void> {
		if (await ctx.shouldStop()) return;

		const { isDataSourceId = false } = options;

		try {
			// Import the database directly using importDatabaseCore
			await importDatabaseCore(
				databaseId,
				{
					ctx,
					currentPageFolderPath: parentPath,
					currentFilePath: undefined, // Top-level database, no parent file
					client: this.notionClient!,
					vault: this.vault,
					app: this.app,
					outputRootPath: this.outputRootPath,
					formulaStrategy: this.formulaStrategy,
					processedDatabases: this.processedDatabases,
					relationPlaceholders: this.relationPlaceholders,
					databasePropertyName: this.databasePropertyName,
					importPageCallback: async (pageId: string, parentPath: string, databaseTag?: string, customFileName?: string) => {
						await this.fetchAndImportPage({ ctx, pageId, parentPath, databaseTag, customFileName });
					},
					onPagesDiscovered: (count: number) => {
						// Callback provided but not used - progress is reported per page/attachment
					}
				},
				isDataSourceId // Pass the flag to indicate if this is a data_source_id
			);
		}
		catch (error) {
			console.error(`Failed to import database ${databaseId}:`, error);
			throw error;
		}
	}


	/**
	 * Fetch and import a Notion page recursively
	 */
	private async fetchAndImportPage(params: FetchAndImportPageParams): Promise<void> {
		const { ctx, pageId, parentPath, databaseTag, customFileName } = params;

		if (await ctx.shouldStop()) return;

		// Check if already processed
		if (this.processedPages.has(pageId)) {
			return;
		}

		this.processedPages.add(pageId);

		// Keep the full ID if fetching the title fails.
		let reportedName = i18n.importer.notionApi.labelPage({ id: pageId });

		try {
			// Fetch page metadata with rate limit handling
			const page = await makeNotionRequest(
				() => this.notionClient!.pages.retrieve({ page_id: pageId }) as Promise<PageObjectResponse>,
				ctx
			);

			// Extract page title
			const pageTitle = extractPageTitle(page);
			// Use custom file name if provided, otherwise use page title
			const sanitizedTitle = customFileName ? sanitizeFileName(customFileName) : sanitizeFileName(pageTitle);
			reportedName = i18n.importer.notionApi.labelPageWithTitle({ title: pageTitle, id: pageId });

			// Update status with page title instead of ID
			ctx.status(i18n.importer.notionApi.statusImportingTitle({ title: sanitizedTitle }));

			// Create a cache to store fetched blocks and avoid duplicate API calls
			// This cache will be used both for checking if page has children and for converting blocks
			const blocksCache = new Map<string, any[]>();

			// Fetch page blocks (content) with rate limit handling
			const blocks = await fetchAllBlocks(this.notionClient!, pageId, ctx);
			// Cache the root page blocks immediately
			blocksCache.set(pageId, blocks);

			// Note: We no longer check pageExistsInVault here because:
			// 1. For incremental import, we need to check the specific file path (not global vault search)
			// 2. This allows re-importing deleted files while skipping existing ones at the correct location
			// The incremental import check happens later when determining the file path

			// Check if page has child pages or child databases (recursively check nested blocks)
			// This will check not only top-level blocks, but also blocks nested in lists, toggles, etc.
			// The blocksCache will be populated during this check
			const hasChildren = await hasChildPagesOrDatabases(this.notionClient!, blocks, ctx, blocksCache);

			// Determine file structure based on whether page has children
			let pageFolderPath: string; // Folder for child pages/databases
			let mdFilePath: string;
			let shouldSkipParentFile = false; // Flag to track if parent file should be skipped

			if (hasChildren) {
				// Create folder structure for pages with children
				// The folder will contain the page content file and child pages/databases
				// For incremental import: reuse existing folder if it exists, otherwise create a unique one
				const baseFolderPath = normalizePath(parentPath ? `${parentPath}/${sanitizedTitle}` : sanitizedTitle);
				const existingFolder = this.vault.getAbstractFileByPath(baseFolderPath);

				if (existingFolder instanceof TFolder) {
					// Reuse existing folder for incremental import
					pageFolderPath = baseFolderPath;
				}
				else {
					// Create new folder with unique name if needed
					pageFolderPath = getUniqueFilePath(this.vault, parentPath, sanitizedTitle);
					await this.createFolders(pageFolderPath);
				}

				// Check if file already exists with same notion-id
				const fileName = `${sanitizedTitle}.md`;
				const potentialFilePath = normalizePath(`${pageFolderPath}/${fileName}`);
				shouldSkipParentFile = await this.shouldSkipExistingFile(potentialFilePath, pageId, ctx);

				mdFilePath = potentialFilePath;
			}
			else {
				// Create file directly for pages without children
				// No folder needed since there are no child pages or databases
				pageFolderPath = parentPath;
				// Check for incremental import before creating file
				const filePathOrNull = await this.getUniqueFilePathWithIncrementalCheck(
					parentPath,
					`${sanitizedTitle}.md`,
					pageId,
					ctx
				);
				if (!filePathOrNull) {
					// File skipped due to incremental import (no children, so nothing else to do)
					// Update progress for skipped page
					if (this.selectedNodeIds.has(pageId)) {
						this.processedPagesCount++;
						ctx.reportProgress(this.processedPagesCount, this.totalNodesToImport);
					}
					return;
				}
				mdFilePath = filePathOrNull;
			}

			// Extract the folder path from the markdown file path for attachments
			// This ensures attachments are placed relative to where the file actually is
			const { parent: currentFileFolderPath } = parseFilePath(mdFilePath);

			// Convert blocks to markdown with nested children support
			// Pass the blocksCache to reuse already fetched blocks
			// Create a set to collect mentioned page/database IDs
			const mentionedIds = new Set<string>();

			let markdownContent = await convertBlocksToMarkdown(blocks, {
				ctx,
				currentFolderPath: currentFileFolderPath,
				currentFilePath: mdFilePath, // for link generation
				client: this.notionClient!,
				vault: this.vault,
				app: this.app,
				downloadExternalAttachments: this.downloadExternalAttachments,
				singleLineBreaks: this.singleLineBreaks, // Single line breaks mode
				incrementalImport: this.incrementalImport, // Skip attachments with same path and size
				indentLevel: 0,
				blocksCache, // reuse cached blocks
				mentionedIds, // collect mentioned IDs
				syncedBlocksMap: this.syncedBlocksMap, // for synced blocks
				outputRootPath: this.outputRootPath, // for synced blocks folder
				syncedChildPagePlaceholders: this.syncedChildPagePlaceholders, // for efficient synced child page replacement
				syncedChildDatabasePlaceholders: this.syncedChildDatabasePlaceholders, // for efficient synced child database replacement
				currentPageTitle: sanitizedTitle, // for attachment naming fallback
				// Callback to import child pages
				importPageCallback: async (childPageId: string, parentPath: string) => {
					await this.fetchAndImportPage({ ctx, pageId: childPageId, parentPath });
				},
				// Callback when an attachment is downloaded
				onAttachmentDownloaded: (filename: string) => ctx.reportAttachmentSuccess(filename),
				// Function to get available attachment path using FormatImporter's method
				// Pass mdFilePath so attachments are placed relative to the actual page file
				getAvailableAttachmentPath: async (filename: string) => {
					return await this.getAvailablePathForAttachment(filename, [], mdFilePath);
				},
				writeMarkdownFile: async (path: string, content: string) => {
					return await this.createMarkdown(path, content);
				},
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
					currentFilePath: mdFilePath, // For link generation
					client: this.notionClient!,
					vault: this.vault,
					app: this.app,
					outputRootPath: this.outputRootPath,
					formulaStrategy: this.formulaStrategy,
					processedDatabases: this.processedDatabases,
					relationPlaceholders: this.relationPlaceholders,
					databasePropertyName: this.databasePropertyName, // Add database property name for child databases
					blocksCache, // Pass blocks cache for recursive block search
					// Callback to import database pages
					importPageCallback: async (pageId: string, parentPath: string, databaseTag?: string, customFileName?: string) => {
						await this.fetchAndImportPage({ ctx, pageId, parentPath, databaseTag, customFileName });
					},
					onPagesDiscovered: (newPagesCount: number) => {
						// Callback provided but not used - progress is reported per page/attachment
					}
				}
			);

			// Clear the cache after processing this page to free memory
			blocksCache.clear();

			// Prepare YAML frontmatter
			// Start with notion-id and database link at the top
			const frontMatter: FrontMatterCache = {
				[NOTION_ID_PROPERTY]: page.id,
			};

			// Add database .base file link if this page belongs to a database (right after notion-id)
			if (databaseTag) {
				frontMatter[this.databasePropertyName] = `[[${databaseTag}]]`;
			}

			// Extract all other properties from the page
			const extractedProps = await extractFrontMatter({
				page,
				formulaStrategy: this.formulaStrategy,
				client: this.notionClient!,
				ctx,
				// Parameters for downloading file property attachments
				vault: this.vault,
				app: this.app,
				currentFilePath: mdFilePath,
				currentFolderPath: pageFolderPath,
				downloadExternalAttachments: this.downloadExternalAttachments,
				incrementalImport: this.incrementalImport,
				onAttachmentDownloaded: (filename: string) => ctx.reportAttachmentSuccess(filename),
				// Pass mdFilePath so attachments are placed relative to the actual page file
				getAvailableAttachmentPath: async (filename: string) => {
					return await this.getAvailablePathForAttachment(filename, [], mdFilePath);
				}
			});
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
							currentFolderPath: currentFileFolderPath,
							currentFilePath: mdFilePath,
							client: this.notionClient!,
							vault: this.vault,
							app: this.app,
							downloadExternalAttachments: true, // Always download cover images
							incrementalImport: this.incrementalImport,
							currentPageTitle: sanitizedTitle,
							// Pass mdFilePath so attachments are placed relative to the actual page file
							getAvailableAttachmentPath: async (filename: string) => {
								return await this.getAvailablePathForAttachment(filename, [], mdFilePath);
							},
							writeMarkdownFile: async (path: string, content: string) => {
								return await this.createMarkdown(path, content);
							},
						}
					);

					// For frontmatter, use wiki link syntax with double quotes for proper rendering
					// Cover images should always be downloaded locally
					if (result.isLocal && result.filename) {
						// Report progress for cover image download
						ctx.reportAttachmentSuccess(result.filename);

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

			// Create the markdown file (only if not skipped)
			if (!shouldSkipParentFile) {
				const fullContent = serializeFrontMatter(frontMatter) + markdownContent;


				// Get unique file path (will append " 1", " 2", etc. if file exists)
				const { parent: parentPath, name: fileName } = parseFilePath(mdFilePath);
				const finalPath = getUniqueFilePath(this.vault, parentPath, fileName);


				try {
					const options: DataWriteOptions = {};
					if (page.created_time) options.ctime = new Date(page.created_time).getTime();
					if (page.last_edited_time) options.mtime = new Date(page.last_edited_time).getTime();
					await this.createMarkdown(normalizePath(finalPath), fullContent, options);
				}
				catch (error) {
					console.error(`[CREATE FILE] Failed to create file: ${finalPath}`);
					console.error(`[CREATE FILE] Page ID: ${pageId}, Page Title: ${sanitizedTitle}`);
					console.error(`[CREATE FILE] Error:`, error);
					throw error;
				}

				// Record page ID to path mapping for mention replacement
				// Store path without extension for wiki link generation
				const pathWithoutExt = finalPath.replace(/\.md$/, '');
				this.notionIdToPath.set(pageId, pathWithoutExt);
				this.writtenPaths.add(pathWithoutExt);

				// Record mention placeholders if any mentions were found
				// Use file path as key for O(1) lookup during replacement
				if (mentionedIds.size > 0) {
					this.mentionPlaceholders.set(finalPath, mentionedIds);
				}
			}

			// Update progress: count all processed pages (imported + skipped)
			// Only count nodes that were selected in the tree (not recursively discovered pages)
			if (this.selectedNodeIds.has(pageId)) {
				this.processedPagesCount++;
				// reportProgress updates the UI: "imported" label shows processedPagesCount (all processed pages)
				// This ensures remaining = total - processed = 0 when all pages are done
				ctx.reportProgress(this.processedPagesCount, this.totalNodesToImport);
			}
			// Note: Even if parent file is skipped, child pages have already been processed
			// by the importPageCallback in convertBlocksToMarkdown

		}
		catch (error) {
			console.error(`Failed to import page ${pageId}:`, error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			// Log more details for debugging
			console.error(`Error details - Page ID: ${pageId}, Error: ${errorMsg}`);
			if (error instanceof Error && error.stack) {
				console.error('Stack trace:', error.stack);
			}
			ctx.reportFailed(reportedName, errorMsg);
			if (this.selectedNodeIds.has(pageId)) {
				// Update progress for failed page to ensure remaining reaches 0
				this.processedPagesCount++;
				ctx.reportProgress(this.processedPagesCount, this.totalNodesToImport);
			}
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

		ctx.status(i18n.importer.notionApi.statusReplacingRelations({
			placeholders: i18n.nouns.relationPlaceholderWithCount({ count: this.relationPlaceholders.length }),
		}));

		if (this.importLinkedDatabases) {
			await this.importDatabasesRelationsPointAt(ctx);
		}

		// Final pass: replace all placeholders with links
		// This happens after all rounds of database imports are complete
		ctx.status(i18n.importer.notionApi.statusReplacingRelationLinks());
		for (const placeholder of this.relationPlaceholders) {
			if (await ctx.shouldStop()) break;

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

				const replacements = new Map<string, string>();

				for (const relatedPageId of placeholder.relatedPageIds) {
					// Get the related page file path from mapping (O(1) lookup)
					const relatedPagePath = this.notionIdToPath.get(relatedPageId);
					if (relatedPagePath) {
						const relatedPageFile = this.vault.getAbstractFileByPath(relatedPagePath + '.md');
						if (relatedPageFile instanceof TFile) {
							// YAML frontmatter doesn't support Markdown syntax, so always use Wiki links
							// regardless of user's global link format setting
							// Use Obsidian wiki link with display text: [[path/to/file|display name]]
							// This ensures precise linking (no ambiguity with duplicate names)
							// while displaying only the clean file name
							const displayName = relatedPageFile.basename; // Just the file name for display
							replacements.set(relatedPageId, `[[${relatedPagePath}|${displayName}]]`);
							continue;
						}

						console.warn(`Could not find related page file: ${relatedPagePath}`);
					}

					const title = await this.relatedPageTitle(relatedPageId);
					if (title) {
						replacements.set(relatedPageId, title);
					}
				}

				const newContent = replaceRelationValue(content, placeholder.propertyKey, replacements);

				// Write back to file if content changed
				if (newContent !== content) {
					await this.modifyPreservingTimestamps(pageFile, newContent);
				}
			}
			catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to replace relation placeholder for page ${placeholder.pageId}:`, error);
				ctx.reportFailed(i18n.importer.notionApi.labelRelationPage({ id: placeholder.pageId }), errorMessage);
			}
		}
	}

	private async importDatabasesRelationsPointAt(ctx: ImportContext): Promise<void> {
		const missingDatabaseIds = new Set<string>();

		for (const placeholder of this.relationPlaceholders) {
			if (!placeholder.targetDatabaseId) continue;
			if (this.processedDatabases.has(placeholder.targetDatabaseId)) continue;

			const anyMissing = placeholder.relatedPageIds.some(id => !this.notionIdToPath.get(id));
			if (anyMissing) missingDatabaseIds.add(placeholder.targetDatabaseId);
		}

		if (missingDatabaseIds.size === 0) return;

		ctx.status(i18n.importer.notionApi.statusImportingLinkedDatabases({
			databases: i18n.nouns.linkedDatabaseWithCount({ count: missingDatabaseIds.size }),
		}));

		for (const databaseId of missingDatabaseIds) {
			if (await ctx.shouldStop()) return;
			if (this.processedDatabases.has(databaseId)) continue;

			await this.importUnimportedDatabase(ctx, databaseId, this.outputRootPath);
		}
	}

	private async relatedPageTitle(pageId: string): Promise<string | null> {
		const cached = this.relatedPageTitles.get(pageId);
		if (cached !== undefined) return cached;

		let title: string | null = null;

		try {
			const page = await this.notionClient!.pages.retrieve({ page_id: pageId });
			title = extractPageTitle(page as PageObjectResponse);
		}
		catch (error) {
			console.warn(`Could not read the title of related page ${pageId}:`, error);
		}

		this.relatedPageTitles.set(pageId, title);
		return title;
	}

	/**
	 * Import a database that was not in the original import scope
	 * but is needed for relation links
	 */
	private async importUnimportedDatabase(ctx: ImportContext, databaseId: string, parentPath: string): Promise<void> {
		let databaseTitle = 'Untitled Database'; // Default title for error reporting

		try {
			ctx.status(i18n.importer.notionApi.statusImportingUnimported({ id: databaseId }));

			// Build context for the core import logic
			const context: DatabaseProcessingContext = {
				ctx,
				currentPageFolderPath: parentPath,
				currentFilePath: undefined, // Unimported database, no parent file
				client: this.notionClient!,
				vault: this.vault,
				app: this.app,
				outputRootPath: this.outputRootPath,
				formulaStrategy: this.formulaStrategy,
				processedDatabases: this.processedDatabases,
				relationPlaceholders: this.relationPlaceholders,
				importPageCallback: async (pageId: string, parentPath: string, databaseTag?: string, customFileName?: string) => {
					await this.fetchAndImportPage({ ctx, pageId, parentPath, databaseTag, customFileName });
				},
				// onPagesDiscovered callback not provided - not needed for unimported databases
				databasePropertyName: this.databasePropertyName
			};

			// Use the core import logic
			const result = await importDatabaseCore(databaseId, context);
			databaseTitle = result.sanitizedTitle;
		}
		catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error(`Failed to import unimported database "${databaseTitle}":`, error);
			ctx.reportFailed(i18n.importer.notionApi.labelDatabaseWithId({ title: databaseTitle, id: databaseId }), errorMsg);
		}
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

		ctx.status(i18n.importer.notionApi.statusReplacingMentions());

		let replacedCount = 0;
		let filesModified = 0;

		// Iterate through files that have mentions (using file path as key for O(1) lookup)
		for (const [sourceFilePath, mentionedIds] of this.mentionPlaceholders) {
			if (await ctx.shouldStop()) break;

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
					await this.modifyPreservingTimestamps(sourceFile, content);
					filesModified++;
				}
			}
			catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to process mentions in file ${sourceFilePath}:`, error);
				ctx.reportFailed(i18n.importer.notionApi.labelMentionFile({ path: sourceFilePath }), errorMessage);
			}
		}

		ctx.status(i18n.importer.notionApi.statusReplacedMentions({
			links: i18n.nouns.mentionLinkWithCount({ count: replacedCount }),
			files: i18n.nouns.fileWithCount({ count: filesModified }),
		}));
	}

	/**
 * Replace synced child placeholders (pages/databases referenced in synced blocks)
 * Strategy:
 * 1. Check if already imported → use existing path
 * 2. If not imported → try to import to output root folder
 * 3. If import fails → show friendly message
 * 
 * Performance: Only processes files that contain synced child placeholders (O(n) where n = files with placeholders)
 */
	private async replaceSyncedChildPlaceholders(ctx: ImportContext): Promise<void> {
		if (this.syncedChildPagePlaceholders.size === 0 && this.syncedChildDatabasePlaceholders.size === 0) {
			return;
		}

		ctx.status(i18n.importer.notionApi.statusReplacingSynced());

		let replacedCount = 0;
		let filesModified = 0;
		let importedCount = 0;

		// Process page placeholders
		for (const [filePath, pageIds] of this.syncedChildPagePlaceholders) {
			if (await ctx.shouldStop()) break;

			try {
				// Get the file directly by path (O(1) lookup)
				const file = this.vault.getAbstractFileByPath(normalizePath(filePath));
				if (!file || !(file instanceof TFile)) {
					console.warn(`Could not find synced block file: ${filePath}`);
					continue;
				}

				let content = await this.vault.read(file);
				const originalContent = content;

				// Process each page ID that was recorded for this file
				for (const pageId of pageIds) {
					const pagePlaceholder = createPlaceholder(PlaceholderType.SYNCED_CHILD_PAGE, pageId);

					// Check if this page placeholder exists
					if (content.includes(pagePlaceholder)) {
						// Check if page is already imported
						let pagePath = this.notionIdToPath.get(pageId);

						if (!pagePath) {
							// Try to import the page to the output root folder
							try {
								await this.fetchAndImportPage({ ctx, pageId, parentPath: this.outputRootPath });
								importedCount++;
							}
							catch (error) {
								// Failed to import (no access or error)
								console.warn(`Failed to import synced child page ${pageId}:`, error);
								content = content.replace(pagePlaceholder, `**Page** _(no access)_`);
								continue; // Skip to next page ID
							}
						}

						// Now get the path (either already existed or just imported)
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
				}

				// Save the file if it was modified
				if (content !== originalContent) {
					await this.modifyPreservingTimestamps(file, content);
					filesModified++;
				}
			}
			catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to process synced child page placeholders in file ${filePath}:`, error);
				ctx.reportFailed(i18n.importer.notionApi.labelSyncedBlockFile({ path: filePath }), errorMessage);
			}
		}

		// Process database placeholders
		for (const [filePath, databaseIds] of this.syncedChildDatabasePlaceholders) {
			if (await ctx.shouldStop()) break;

			try {
				// Get the file directly by path (O(1) lookup)
				const file = this.vault.getAbstractFileByPath(normalizePath(filePath));
				if (!file || !(file instanceof TFile)) {
					console.warn(`Could not find synced block file: ${filePath}`);
					continue;
				}

				let content = await this.vault.read(file);
				const originalContent = content;

				// Process each database ID that was recorded for this file
				for (const databaseId of databaseIds) {
					const dbPlaceholder = createPlaceholder(PlaceholderType.SYNCED_CHILD_DATABASE, databaseId);

					if (content.includes(dbPlaceholder)) {
						// Check if database is already imported
						let dbInfo = this.processedDatabases.get(databaseId);

						if (!dbInfo) {
							// Try to import the database to the output root folder
							try {
								await this.importTopLevelDatabase(ctx, databaseId, this.outputRootPath);
								importedCount++;
							}
							catch (error) {
								// Failed to import (no access or error)
								console.warn(`Failed to import synced child database ${databaseId}:`, error);
								content = content.replace(dbPlaceholder, `**Database** _(no access)_`);
								continue; // Skip to next database ID
							}
						}

						// Now get the database info (either already existed or just imported)
						dbInfo = this.processedDatabases.get(databaseId);
						if (dbInfo) {
							const baseFilePath = dbInfo.baseFilePath.replace(/\.base$/, '');
							const targetFile = this.vault.getAbstractFileByPath(baseFilePath + '.base');
							if (targetFile && targetFile instanceof TFile) {
								const link = this.app.fileManager.generateMarkdownLink(targetFile, file.path);
								content = content.replace(dbPlaceholder, link);
								replacedCount++;
							}
						}
					}
				}

				// Save the file if it was modified
				if (content !== originalContent) {
					await this.modifyPreservingTimestamps(file, content);
					filesModified++;
				}
			}
			catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to process synced child database placeholders in file ${filePath}:`, error);
				ctx.reportFailed(i18n.importer.notionApi.labelSyncedBlockFile({ path: filePath }), errorMessage);
			}
		}

		ctx.status(i18n.importer.notionApi.statusReplacedSynced({
			references: i18n.nouns.syncedReferenceWithCount({ count: replacedCount }),
			files: i18n.nouns.fileWithCount({ count: filesModified }),
			imported: i18n.nouns.newItemWithCount({ count: importedCount }),
		}));
	}

	/** Find a page left by an unfinished import. */
	private async alreadyWrittenByAnUnfinishedImport(
		filePath: string,
		notionId: string,
		ctx: ImportContext
	): Promise<boolean> {
		if (this.saveSourceId) return false;

		const file = this.vault.getAbstractFileByPath(normalizePath(filePath));
		if (!(file instanceof TFile)) return false;

		try {
			const content = await this.vault.read(file);
			if (this.sourceIdIn(content, NOTION_ID_PROPERTY) !== notionId) return false;

			const { basename } = parseFilePath(file.path);
			ctx.reportSkipped(basename, i18n.importer.notionApi.reasonEarlierImport());

			const pathWithoutExt = file.path.replace(/\.md$/, '');
			this.notionIdToPath.set(notionId, pathWithoutExt);
			this.recoveredPaths.add(pathWithoutExt);
			await this.collectUnresolvedPlaceholders(content, notionId, file.path);

			return true;
		}
		catch (error) {
			console.error(`Failed to read file ${filePath} for duplicate check:`, error);
			return false;
		}
	}

	protected async shouldSkipExistingFile(
		filePath: string,
		notionId: string,
		ctx: ImportContext
	): Promise<boolean> {
		if (this.duplicateHandling === DuplicateHandling.CreateCopy) {
			return await this.alreadyWrittenByAnUnfinishedImport(filePath, notionId, ctx);
		}

		const file = this.previouslyImported(normalizePath(filePath), notionId);
		if (!file) {
			return false; // Not imported before, don't skip
		}

		try {
			const content = await this.vault.read(file);
			const { basename } = parseFilePath(file.path);
			ctx.reportSkipped(basename, i18n.reason.alreadyInVault());

			const filePathWithoutExtension = file.path.replace(/\.md$/, '');
			this.notionIdToPath.set(notionId, filePathWithoutExtension);

			await this.collectUnresolvedPlaceholders(content, notionId, file.path);

			return true;
		}
		catch (error) {
			console.error(`Failed to read file ${filePath} for duplicate check:`, error);
			return false; // On error, don't skip
		}
	}

	/** Remove temporary IDs from pages owned by this run. */
	protected async cleanupNotionIds(ctx: ImportContext): Promise<void> {
		const written = new Set([...this.writtenPaths, ...this.recoveredPaths]);
		if (written.size === 0) {
			return;
		}

		let failedCount = 0;

		for (const filePath of written) {
			if (await ctx.shouldStop()) break;

			try {
				const file = this.vault.getAbstractFileByPath(filePath + '.md');
				if (!file || !(file instanceof TFile)) {
					continue;
				}

				const content = await this.vault.read(file);

				const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
				const match = content.match(frontmatterRegex);

				if (!match) {
					continue; // No frontmatter, skip
				}

				const frontmatter = match[1];
				const notionIdRegex = /^notion-id:\s*.+$/m;

				if (!notionIdRegex.test(frontmatter)) {
					continue; // No notion-id in frontmatter, skip
				}

				const newFrontmatter = frontmatter
					.split('\n')
					.filter(line => !line.match(/^notion-id:\s*.+$/))
					.join('\n');

				const newContent = content.replace(
					frontmatterRegex,
					`---\n${newFrontmatter}\n---`
				);

				await this.modifyMarkdown(file, newContent, {
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
				});
			}
			catch (error) {
				console.error(`Failed to clean notion-id from file: ${filePath}`, error);
				failedCount++;
			}
		}

		if (failedCount > 0) {
			console.warn(`⚠️ Failed to clean notion-id from ${plural(failedCount, 'file')}`);
		}
	}

	/**
	 * Scan file content for unresolved placeholders and add them to respective tracking structures
	 * This handles the case where a previous import left unresolved placeholders
	 * @param content - File content to scan
	 * @param pageId - Notion page ID of the file
	 * @param filePath - File path for tracking mention/synced placeholders
	 */
	private async collectUnresolvedPlaceholders(content: string, pageId: string, filePath: string): Promise<void> {
		// 1. Collect unresolved relation placeholders (in frontmatter, as UUIDs)
		const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
		const frontmatterMatch = content.match(frontmatterRegex);

		if (frontmatterMatch) {
			const frontmatter = frontmatterMatch[1];

			// Look for relation properties that still contain page IDs (UUIDs)
			// UUID format: 8-4-4-4-12 hexadecimal characters with hyphens
			const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
			const uuidMatches = frontmatter.match(uuidRegex);

			if (uuidMatches && uuidMatches.length > 0) {
				// Parse frontmatter to find which properties contain these UUIDs
				const lines = frontmatter.split('\n');
				let currentPropertyKey: string | null = null;
				const unresolvedRelations: Map<string, string[]> = new Map();

				for (const line of lines) {
					// Check if this line defines a property (e.g., "Related Pages:")
					const propertyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*$/);
					if (propertyMatch) {
						currentPropertyKey = propertyMatch[1];
						continue;
					}

					// Check if this line contains a UUID (list item or inline value)
					if (currentPropertyKey) {
						const lineUuids = line.match(uuidRegex);
						if (lineUuids) {
							for (const uuid of lineUuids) {
								// Check if this UUID is NOT already a wiki link (i.e., it's an unresolved placeholder)
								if (!line.includes(`[[${uuid}`)) {
									if (!unresolvedRelations.has(currentPropertyKey)) {
										unresolvedRelations.set(currentPropertyKey, []);
									}
									unresolvedRelations.get(currentPropertyKey)!.push(uuid);
								}
							}
						}
					}
				}

				// Add unresolved relations to relationPlaceholders
				for (const [propertyKey, relatedPageIds] of unresolvedRelations.entries()) {
					if (relatedPageIds.length > 0) {
						this.relationPlaceholders.push({
							pageId: pageId,
							propertyKey: propertyKey,
							relatedPageIds: relatedPageIds,
							targetDatabaseId: '', // Unknown, but not needed for replacement
						});
					}
				}

			}
		}

		// 2. Collect unresolved mention placeholders (in content, as [[NOTION_PAGE:id]] or [[NOTION_DB:id]])
		const mentionPageRegex = /\[\[NOTION_PAGE:([a-f0-9-]+)\]\]/g;
		const mentionDbRegex = /\[\[NOTION_DB:([a-f0-9-]+)\]\]/g;

		const mentionedIds = new Set<string>();
		let match;

		while ((match = mentionPageRegex.exec(content)) !== null) {
			mentionedIds.add(match[1]);
		}

		while ((match = mentionDbRegex.exec(content)) !== null) {
			mentionedIds.add(match[1]);
		}

		if (mentionedIds.size > 0) {
			this.mentionPlaceholders.set(filePath, mentionedIds);
		}

		// 3. Collect unresolved synced child placeholders (in content, as [[SYNCED_CHILD_PAGE:id]] or [[SYNCED_CHILD_DATABASE:id]])
		const syncedPageRegex = /\[\[SYNCED_CHILD_PAGE:([a-f0-9-]+)\]\]/g;
		const syncedDbRegex = /\[\[SYNCED_CHILD_DATABASE:([a-f0-9-]+)\]\]/g;

		const syncedPageIds = new Set<string>();
		const syncedDbIds = new Set<string>();

		while ((match = syncedPageRegex.exec(content)) !== null) {
			syncedPageIds.add(match[1]);
		}

		while ((match = syncedDbRegex.exec(content)) !== null) {
			syncedDbIds.add(match[1]);
		}

		if (syncedPageIds.size > 0) {
			this.syncedChildPagePlaceholders.set(filePath, syncedPageIds);
		}

		if (syncedDbIds.size > 0) {
			this.syncedChildDatabasePlaceholders.set(filePath, syncedDbIds);
		}
	}

	/**
	 * Get unique file path with incremental import check
	 * @param parentPath - Parent folder path
	 * @param fileName - File name
	 * @param notionId - Notion ID of the page being imported
	 * @param ctx - Import context for reporting
	 * @returns File path or null if should be skipped
	 */
	private async getUniqueFilePathWithIncrementalCheck(
		parentPath: string,
		fileName: string,
		notionId: string,
		ctx: ImportContext
	): Promise<string | null> {
		const basePath = parentPath ? `${parentPath}/${fileName}` : fileName;

		// Check if file already exists with same notion-id
		const shouldSkip = await this.shouldSkipExistingFile(basePath, notionId, ctx);
		if (shouldSkip) {
			return null;
		}

		// If file doesn't exist, return base path
		const file = this.vault.getAbstractFileByPath(normalizePath(basePath));
		if (!file) {
			return basePath;
		}

		// File exists but has different notion-id (or no notion-id)
		// Use standard unique path logic
		return getUniqueFilePath(this.vault, parentPath, fileName);
	}

	private async modifyPreservingTimestamps(file: TFile, content: string): Promise<void> {
		await this.modifyMarkdown(file, content, {
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
		});
	}

}
