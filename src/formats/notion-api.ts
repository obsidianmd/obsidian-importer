import { ButtonComponent, FrontMatterCache, Notice, Setting, normalizePath, requestUrl, TFile, TFolder, setIcon, DataWriteOptions, Vault } from 'obsidian';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { Client, PageObjectResponse } from '@notionhq/client';
import { extractErrorMessage, sanitizeFileName, serializeFrontMatter, getUniqueFilePath, plural } from '../util';
import { areAllSelected, redrawTree, setAllSelection, setNodeSelection } from '../tree';
import type { FormulaImportStrategy } from '../base';
import { parseFilePath } from '../filesystem';

// Import helper modules
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

/** Frontmatter property holding the Notion page a note was imported from. */
const NOTION_ID_PROPERTY = 'notion-id';

export class NotionAPIImporter extends FormatImporter {
	interruption = 'pause' as const;

	/** Resolved from the keychain on each read, so unlinking the secret takes effect immediately */
	get notionToken(): string {
		return this.getSecret() ?? '';
	}

	formulaStrategy: FormulaImportStrategy = 'hybrid'; // Default strategy
	/**
	 * Whether a relation into a database the user did not select may import it.
	 *
	 * Off by default: an import doing more than was asked of it is the thing a
	 * user cannot undo or predict, and a relation with nowhere to point now
	 * reads as the page's name rather than as its id.
	 */
	importLinkedDatabases: boolean = false;
	downloadExternalAttachments: boolean = false; // Download external attachments
	singleLineBreaks: boolean = false; // Single line breaks between blocks (default: disabled)
	coverPropertyName: string = 'cover'; // Custom property name for page cover
	databasePropertyName: string = 'base'; // Property name for linking pages to their database
	/** Whether a note carries notion-id, and an import may skip one it wrote. */
	get incrementalImport(): boolean {
		return this.duplicateHandling !== DuplicateHandling.CreateCopy;
	}
	private notionClient: Client | null = null;
	private processedPages: Set<string> = new Set();
	private requestCount: number = 0;
	private totalNodesToImport: number = 0; // Total number of nodes selected for import
	private selectedNodeIds: Set<string> = new Set(); // IDs of nodes selected in tree for progress tracking
	// Page/database tree for selection
	private pageTree: NotionTreeNode[] = [];
	private pageTreeContainer: HTMLElement | null = null;
	private listPagesButton: ButtonComponent | null = null;
	private toggleSelectButton: ButtonComponent | null = null;
	// save output root path for database handling
	//  we will flatten all database in this folder later
	private outputRootPath: string = '';
	// Track all processed databases for relation resolution
	private processedDatabases: Map<string, DatabaseInfo> = new Map();
	// Track all relation placeholders that need to be replaced
	private relationPlaceholders: RelationPlaceholder[] = [];
	/** Titles of pages no note is written for, by id; see relatedPageTitle. */
	private relatedPageTitles: Map<string, string | null> = new Map();
	// Progress counters: separate tracking for pages and attachments
	private processedPagesCount: number = 0; // Total processed (imported + skipped) for progress tracking
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
	// Separated by type to avoid unnecessary placeholder checks
	private syncedChildPagePlaceholders: Map<string, Set<string>> = new Map();
	private syncedChildDatabasePlaceholders: Map<string, Set<string>> = new Map();

	init() {
		// No file chooser needed since we're importing via API
		this.addOutputLocationSetting('Notion');

		// Notion API token, held in Obsidian's keychain so it is remembered
		// between sessions
		this.addSecretSetting('Notion API token', this.createTokenDescription());

		// List pages and toggle selection buttons
		// Everything below is the tree the user picks pages from. An import
		// driven without a dialog sets what it wants directly.
		const contentEl = this.host.contentEl;
		if (!contentEl) return;

		const listPagesSetting = new Setting(contentEl)
			.setName('Select pages to import')
			.setDesc('Click "Load" to see data you can import. If a page or database is missing, check that your Notion integration has access to it.');

		// Store button references in closure to avoid constructor timing issues
		let toggleButtonRef: ButtonComponent | null = null;
		let listButtonRef: ButtonComponent | null = null;

		// Toggle select all/none button
		listPagesSetting.addButton(button => {
			toggleButtonRef = button;
			button
				.setButtonText('Select all')
				.onClick(() => {
					this.toggleSelectButton = toggleButtonRef;
					this.handleToggleSelectClick();
				});

			// Add custom class for fixed width and initially hide
			if (button.buttonEl) {
				button.buttonEl.addClass('importer-tree-button');
				button.buttonEl.hide(); // Hide until tree is loaded
			}

			return button;
		});

		// List pages button
		listPagesSetting.addButton(button => {
			listButtonRef = button;
			button
				.setButtonText('Load')
				.onClick(async () => {
					try {
						this.listPagesButton = listButtonRef;
						this.toggleSelectButton = toggleButtonRef;
						await this.loadPageTree();
					}
					catch (error) {
						console.error('[Notion Importer] Error in loadPageTree:', error);
						new Notice(`Failed to load pages: ${extractErrorMessage(error)}`);
					}
				});

			// Add custom class for fixed width
			if (button.buttonEl) {
				button.buttonEl.addClass('importer-tree-button');
				button.buttonEl.addClass('mod-cta');
			}

			return button;
		});


		// Page tree container (using Publish plugin's style with proper hierarchy)
		// Create the section wrapper
		const importSection = contentEl.createDiv();
		importSection.addClass('import-section', 'file-tree', 'publish-section');

		// Create the change list container
		this.pageTreeContainer = importSection.createDiv('publish-change-list');
		// Add placeholder text
		const placeholder = this.pageTreeContainer.createDiv('publish-placeholder');
		placeholder.setText('Click "Load" to load your Notion pages and databases.');

		// Notion skips a page it wrote before, but does not compare times
		this.addDuplicateHandlingSetting({ idProperty: NOTION_ID_PROPERTY, modes: [DuplicateHandling.Skip, DuplicateHandling.CreateCopy] });

		// Formula import strategy
		this.addSetting()
			?.setName('Convert formulas')
			.setDesc(this.createFormulaStrategyDescription())
			.addDropdown(dropdown => {
				dropdown
					.addOption('hybrid', 'Obsidian syntax')
					.addOption('static', 'Static values')
					.setValue('hybrid') // Set default to 'hybrid'
					.onChange(value => {
						this.formulaStrategy = value as FormulaImportStrategy;
					});
			});

		// Download external attachments option
		this.addSetting()
			?.setName('Download external attachments')
			.setDesc(this.createAttachmentDescription())
			.addToggle(toggle => {
				toggle
					.setValue(false)
					.onChange(value => {
						this.downloadExternalAttachments = value;
					});
			});

		// Single line breaks option
		this.addSetting()
			?.setName('Single line breaks')
			.setDesc('Separate Notion blocks with only one line break instead of two. Some blocks (lists, toggles, tables) will still use double line breaks when required for proper Markdown syntax.')
			.addToggle(toggle => {
				toggle
					.setValue(false)
					.onChange(value => {
						this.singleLineBreaks = value;
					});
			});

		// Cover property name
		this.addSetting()
			?.setName('Cover property name')
			.setDesc(this.createCoverPropertyDescription())
			.addText(text => text
				.setPlaceholder('cover')
				.setValue('cover')
				.onChange(value => {
					this.coverPropertyName = value.trim() || 'cover';
				}));

		// Database property name
		this.addSetting()
			?.setName('Database property name')
			.setDesc('Property name in page frontmatter to link pages to their database .base file (default: "base")')
			.addText(text => text
				.setPlaceholder('base')
				.setValue('base')
				.onChange(value => {
					this.databasePropertyName = value.trim() || 'base';
				}));

		// Whether a relation may pull in a database that was not selected
		this.addSetting()
			?.setName('Import linked databases')
			.setDesc('Also import databases that the selected pages link to, so relations become links rather than names. This imports pages you did not select.')
			.addToggle(toggle => toggle
				.setValue(this.importLinkedDatabases)
				.onChange(value => {
					this.importLinkedDatabases = value;
				}));
	}

	private createTokenDescription(): DocumentFragment {
		const frag = createFragment();
		frag.appendText('To get an API token create a connection in Notion and give it access to pages in your workspace. ');
		frag.createEl('a', {
			text: 'Get API token.',
			href: 'https://app.notion.com/developers/connections',
		});
		return frag;
	}

	private createFormulaStrategyDescription(): DocumentFragment {
		const frag = createFragment();
		frag.appendText('By default Notion formulas are converted to Obsidian syntax. If any Notion syntax is not supported the static values will be saved instead. Alternatively you can import all formulas as static values.');
		return frag;
	}

	private createAttachmentDescription(): DocumentFragment {
		const frag = createFragment();
		frag.appendText('Download external attachments (external URLs) to local files. Notion-hosted files are always downloaded. ');
		frag.createEl('br');
		frag.appendText('Attachments will be saved according to your vault\'s attachment folder settings.');
		return frag;
	}

	private createCoverPropertyDescription(): DocumentFragment {
		const frag = createFragment();
		frag.appendText('Property name for page cover image in YAML frontmatter. ');
		frag.createEl('br');
		frag.appendText('Leave as "cover" if you don\'t have conflicts with existing properties.');
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

	/**
	 * Load page tree from Notion API using search
	 */
	private async loadPageTree(): Promise<void> {
		if (!this.notionToken) {
			new Notice('Please enter your Notion API token first.');
			return;
		}

		if (!this.listPagesButton) {
			return;
		}

		// Disable button and show loading state
		this.listPagesButton.setDisabled(true);
		this.listPagesButton.setButtonText('Loading...');

		try {
			// Re-initialize client to ensure current token is used
			this.initializeNotionClient();

			// Create a minimal context for makeNotionRequest
			const tempCtx = {
				status: (msg: string) => {
					// Update button text with status
					if (this.listPagesButton) {
						this.listPagesButton.setButtonText(msg);
					}
				},
				isCancelled: () => false,
				reportFailed: (name: string, error: any) => {
					console.error(`Failed: ${name}`, error);
				},
				statusMessage: '',
			} as unknown as ImportContext;

			// Search for all pages and databases with pagination
			// Two-phase filtering:
			// Phase 1: Collect all items and identify databases that are inside blocks
			// Phase 2: Filter out pages that belong to those databases
			const allRawItems: any[] = [];
			let cursor: string | undefined = undefined;
			let pageCount = 0;

			do {
				pageCount++;

				// Update button text with progress
				tempCtx.status(`Loading... (${allRawItems.length} items, page ${pageCount})`);

				// Use makeNotionRequest for rate limiting and error handling
				// Note: Not using filter to get both pages and databases
				const response = await makeNotionRequest(
					() => this.notionClient!.search({
						start_cursor: cursor,
						page_size: 100,
					}),
					tempCtx
				);

				// Collect all raw items first
				allRawItems.push(...response.results);

				cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
			} while (cursor);

			const allItems = collectItems(allRawItems);

			// Build tree structure
			this.pageTree = buildTree(allItems);

			// Render tree (this will also update button text)
			this.renderPageTree();

			// Show the Select all button now that we have content
			if (this.toggleSelectButton && this.toggleSelectButton.buttonEl) {
				this.toggleSelectButton.buttonEl.show();
			}

			new Notice(`Found ${allItems.length} pages and databases.`);
		}
		catch (error) {
			console.error('[Notion Importer] Failed to load pages:', error);
			new Notice(`Failed to load pages: ${extractErrorMessage(error) ?? 'Unknown error'}`);
		}
		finally {
			// Re-enable button. Compared rather than tested for truthiness: an
			// Obsidian component carries a then() for chaining, which reads to
			// typescript-eslint as testing a promise.
			if (this.listPagesButton !== null) {
				this.listPagesButton.setDisabled(false);
				this.listPagesButton.setButtonText('Refresh');
			}
		}
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
	 * Render page tree UI
	 */
	private renderPageTree(): void {
		// Try to get container reference if lost
		if (!this.pageTreeContainer) {
			this.pageTreeContainer = this.host.contentEl?.querySelector('.publish-change-list') ?? null;
		}

		if (!this.pageTreeContainer) {
			console.error('[Notion Importer] Container not found!');
			return;
		}

		const container = this.pageTreeContainer;

		redrawTree(container, () => {
			if (this.pageTree.length === 0) {
				container.createDiv({
					text: 'No pages or databases found. Make sure your integration has access to the pages you want to import.',
					cls: 'notion-tree-empty'
				});
				return;
			}

			// Render tree (buttons are now outside the scrollable container)
			for (const node of this.pageTree) {
				this.renderTreeNode(container, node, 0);
			}
		});

		// Update toggle button text based on current selection state
		if (this.toggleSelectButton) {
			this.updateToggleButtonText();
		}
	}

	/**
	 * Render a single tree node using Obsidian's standard tree structure
	 */
	private renderTreeNode(container: HTMLElement, node: NotionTreeNode, level: number): void {
		// Main tree item container
		const treeItem = container.createDiv('tree-item');

		// Tree item self (contains the node itself)
		const treeItemSelf = treeItem.createDiv('tree-item-self');
		treeItemSelf.addClass('is-clickable');

		// Add appropriate modifiers
		if (node.children.length > 0) {
			treeItemSelf.addClass('mod-collapsible');
			treeItemSelf.addClass('mod-folder');
		}
		else {
			treeItemSelf.addClass('mod-file');
		}

		// Dimmed and unclickable; see .import-section .tree-item-self.is-disabled
		if (node.disabled) {
			treeItemSelf.addClass('is-disabled');
		}

		// Collapse/Expand arrow (only if has children). Stays clickable on a
		// disabled row, which styles.css restores.
		if (node.children.length > 0) {
			const collapseIcon = treeItemSelf.createDiv('tree-item-icon collapse-icon');

			// Use right-triangle icon (Obsidian's standard)
			setIcon(collapseIcon, 'right-triangle');

			// Add is-collapsed class for CSS control
			collapseIcon.toggleClass('is-collapsed', node.collapsed);
			treeItem.toggleClass('is-collapsed', node.collapsed);

			let childrenContainer: HTMLElement;
			let iconContainer: HTMLElement;

			// Toggle collapse state with pure DOM manipulation (no re-render)
			collapseIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				node.collapsed = !node.collapsed;

				// Get references if not set yet
				if (!childrenContainer) {
					childrenContainer = treeItem.querySelector('.tree-item-children') as HTMLElement;
				}
				if (!iconContainer) {
					iconContainer = treeItem.querySelector('.file-tree-item-icon') as HTMLElement;
				}

				// Toggle CSS classes and visibility
				collapseIcon.toggleClass('is-collapsed', node.collapsed);
				treeItem.toggleClass('is-collapsed', node.collapsed);
				if (childrenContainer) childrenContainer.toggle(!node.collapsed);

				// Update folder icon
				if (node.type !== 'database' && iconContainer) {
					iconContainer.empty();
					setIcon(iconContainer, node.collapsed ? 'folder' : 'folder-open');
				}
			});
		}

		// Inner content (checkbox, icon, title)
		const treeItemInner = treeItemSelf.createDiv('tree-item-inner file-tree-item');

		// Checkbox
		const checkbox = treeItemInner.createEl('input', {
			type: 'checkbox',
			cls: 'file-tree-item-checkbox'
		});
		checkbox.checked = node.selected;
		checkbox.disabled = node.disabled;

		if (!node.disabled) {
			checkbox.addEventListener('change', () => {
				setNodeSelection(node, checkbox.checked);
				this.renderPageTree();
			});
		}

		// Icon
		const iconContainer = treeItemInner.createDiv('file-tree-item-icon');
		if (node.type === 'database') {
			setIcon(iconContainer, 'database');
		}
		else if (node.children.length > 0) {
			// Use folder-open for pages with children
			setIcon(iconContainer, !node.collapsed ? 'folder-open' : 'folder');
		}
		else {
			setIcon(iconContainer, 'file');
		}

		// Title
		const titleEl = treeItemInner.createDiv('file-tree-item-title');
		titleEl.setText(node.title);

		// Children container
		const childrenContainer = treeItem.createDiv('tree-item-children');

		// Hide children container if collapsed
		if (node.collapsed) {
			childrenContainer.hide();
		}

		// Render children (always render, but hide if collapsed)
		if (node.children.length > 0) {
			for (const child of node.children) {
				this.renderTreeNode(childrenContainer, child, level + 1);
			}
		}
	}

	/**
	 * Handle toggle select button click
	 * Selects all nodes if not all selected, deselects all if all selected
	 */
	private handleToggleSelectClick(): void {
		// Check if page tree is loaded
		if (this.pageTree.length === 0) {
			new Notice('Please list importable pages first.');
			return;
		}

		// Check current state - if all nodes are selected, deselect all; otherwise select all
		const allSelected = areAllSelected(this.pageTree);

		setAllSelection(this.pageTree, !allSelected);

		this.renderPageTree(); // This will call updateToggleButtonText()
	}

	/**
	 * Update toggle select button text based on current selection state
	 */
	private updateToggleButtonText(): void {
		if (!this.toggleSelectButton) {
			return;
		}
		const allSelected = areAllSelected(this.pageTree);
		this.toggleSelectButton.setButtonText(allSelected ? 'Deselect all' : 'Select all');
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

		collectNodes(this.pageTree);
		this.totalNodesToImport = totalPageCount; // Set total count for progress tracking (pages only)	
		return topLevelSelected;
	}

	async import(ctx: ImportContext): Promise<void> {
		// Validate inputs
		if (!this.notionToken) {
			new Notice('Please enter your Notion API token.');
			return;
		}

		// Get selected pages/databases
		const selectedIds = this.getSelectedNodeIds();
		if (selectedIds.length === 0) {
			new Notice('Please select at least one page or database to import.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		ctx.status('Connecting to Notion API...');

		try {
			// Re-initialize client to ensure current token is used
			this.initializeNotionClient();

			ctx.status('Fetching page content from Notion...');

			// Reset processed pages tracker
			this.processedPages.clear();
			this.processedDatabases.clear();
			this.relationPlaceholders = [];
			this.relatedPageTitles.clear();
			this.processedPagesCount = 0;

			// Note: getSelectedNodeIds() already populated this.selectedNodeIds and this.totalNodesToImport
			ctx.status(`Preparing to import ${plural(this.totalNodesToImport, 'item')}...`);

			// Initialize progress display with known total count
			ctx.reportProgress(0, this.totalNodesToImport);

			// Save output root path for database handling
			this.outputRootPath = folder.path;

			// Import all selected pages/databases
			ctx.status(`Importing ${plural(selectedIds.length, 'item')}...`);

			for (let i = 0; i < selectedIds.length; i++) {
				if (await ctx.shouldStop()) break;

				const itemId = selectedIds[i];
				ctx.status(`Importing item ${i + 1}/${selectedIds.length}...`);

				try {
					// Find the node in the tree to determine its type
					const node = this.findNodeById(this.pageTree, itemId);

					if (!node) {
						console.warn(`Could not find node with ID: ${itemId}`);
						ctx.reportFailed(`Import item ${itemId}`, 'Item not found in tree');
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
						ctx.reportFailed(`Import item ${itemId}`, `Unknown type: ${String(node.type)}`);
					}
				}
				catch (error) {
					console.error(`Failed to import item ${itemId}:`, error);
					ctx.reportFailed(`Import item ${itemId}`, error);
					// Continue with next item
				}
			}

			// After all pages are imported, replace relation placeholders
			ctx.status('Processing relation links...');
			await this.replaceRelationPlaceholders(ctx);

			ctx.status('Processing mention links...');
			await this.replaceMentionPlaceholdersInAllFiles(ctx);

			ctx.status('Processing synced block child references...');
			await this.replaceSyncedChildPlaceholders(ctx);

			// Clean up notion-id only for full import (not incremental)
			// Strategy: We always write notion-id during import (for both modes) to handle interruptions gracefully.
			// - Incremental import: Keep notion-id for future imports to skip duplicates
			// - Full import: Remove notion-id to avoid cluttering user's frontmatter (one-time import)
			if (!this.incrementalImport) {
				ctx.status('Cleaning up notion-id attributes...');
				await this.cleanupNotionIds(ctx);
			}

			ctx.status('Import completed successfully!');

		}
		catch (error) {
			console.error('Notion API import error:', error);
			ctx.reportFailed('Notion API import', error);
			new Notice(`Import failed: ${extractErrorMessage(error)}`);
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

			// Update status with page title instead of ID
			ctx.status(`Importing: ${sanitizedTitle}`);

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
							}
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
					await this.vault.create(normalizePath(finalPath), fullContent, options);
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
			// Try to get page title from the error context or use page ID
			const pageTitle = `Page ${pageId.substring(0, 8)}...`;
			const errorMsg = error instanceof Error ? error.message : String(error);
			// Log more details for debugging
			console.error(`Error details - Page ID: ${pageId}, Error: ${errorMsg}`);
			if (error instanceof Error && error.stack) {
				console.error('Stack trace:', error.stack);
			}
			ctx.reportFailed(pageTitle, errorMsg);
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

		ctx.status(`Replacing ${plural(this.relationPlaceholders.length, 'relation placeholder')}...`);

		if (this.importLinkedDatabases) {
			await this.importDatabasesRelationsPointAt(ctx);
		}

		// Final pass: replace all placeholders with links
		// This happens after all rounds of database imports are complete
		ctx.status(`Replacing relation placeholders with wiki links...`);
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

				// What each related id should say, worked out before any of it is
				// written so the replacement is one pass over the property
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

					// No note to point at. The page still has a name, and a name
					// is worth more to a reader than the id was.
					const title = await this.relatedPageTitle(relatedPageId);
					if (title) {
						replacements.set(relatedPageId, title);
					}
				}

				const newContent = replaceRelationValue(content, placeholder.propertyKey, replacements);

				// Write back to file if content changed
				if (newContent !== content) {
					await modifyFilePreservingTimestamps(this.vault, pageFile, newContent);
				}
			}
			catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to replace relation placeholder for page ${placeholder.pageId}:`, error);
				ctx.reportFailed(`Relation page ${placeholder.pageId}`, errorMessage);
			}
		}
	}

	/**
	 * Import the databases the selection's relations point into.
	 *
	 * One pass over what is already known, not until nothing new turns up: the
	 * databases these pull in have relations of their own, and following those
	 * too walks as much of a workspace as it is connected to. A direct relation
	 * is the one a user asking for this is thinking of.
	 *
	 * Only relations recorded from a database schema carry the id of what they
	 * point at, so the ones found by re-reading frontmatter cannot be followed
	 * and fall back to a name, as they did before.
	 */
	private async importDatabasesRelationsPointAt(ctx: ImportContext): Promise<void> {
		const missingDatabaseIds = new Set<string>();

		for (const placeholder of this.relationPlaceholders) {
			if (!placeholder.targetDatabaseId) continue;
			if (this.processedDatabases.has(placeholder.targetDatabaseId)) continue;

			// Only where something it points at has no note of its own
			const anyMissing = placeholder.relatedPageIds.some(id => !this.notionIdToPath.get(id));
			if (anyMissing) missingDatabaseIds.add(placeholder.targetDatabaseId);
		}

		if (missingDatabaseIds.size === 0) return;

		ctx.status(`Importing ${plural(missingDatabaseIds.size, 'linked database')}...`);

		for (const databaseId of missingDatabaseIds) {
			if (await ctx.shouldStop()) return;
			if (this.processedDatabases.has(databaseId)) continue;

			await this.importUnimportedDatabase(ctx, databaseId, this.outputRootPath);
		}
	}

	/**
	 * The title of a page the import is not writing a note for.
	 *
	 * A relation carries page ids and nothing else, so the only way to know
	 * what one is called is to ask for it. Cached: a popular page is related to
	 * from many others, and this would otherwise be a request per relation
	 * rather than per page.
	 *
	 * Returns null when it cannot be read - a page in a part of the workspace
	 * the integration was never shared - which leaves the id, as before.
	 */
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
			ctx.status(`Importing unimported database ${databaseId}...`);

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
			ctx.reportFailed(`Database: ${databaseTitle}`, errorMsg);
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

		ctx.status(`Replacing mention placeholders...`);

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
					await modifyFilePreservingTimestamps(this.vault, sourceFile, content);
					filesModified++;
				}
			}
			catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to process mentions in file ${sourceFilePath}:`, error);
				ctx.reportFailed(`Mention file ${sourceFilePath}`, errorMessage);
			}
		}

		ctx.status(`Replaced ${replacedCount} mention links in ${filesModified} files.`);
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

		ctx.status('Replacing synced block child references...');

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
					await modifyFilePreservingTimestamps(this.vault, file, content);
					filesModified++;
				}
			}
			catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to process synced child page placeholders in file ${filePath}:`, error);
				ctx.reportFailed(`Synced block file ${filePath}`, errorMessage);
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
					await modifyFilePreservingTimestamps(this.vault, file, content);
					filesModified++;
				}
			}
			catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to process synced child database placeholders in file ${filePath}:`, error);
				ctx.reportFailed(`Synced block file ${filePath}`, errorMessage);
			}
		}

		ctx.status(`Replaced ${replacedCount} synced child references in ${filesModified} files (imported ${importedCount} new items).`);
	}

	/**
	 * Check if a file should be skipped during import
	 * This applies to BOTH incremental and full import modes
	 * 
	 * @param filePath - Path to the file to check
	 * @param notionId - Notion ID of the page being imported
	 * @param ctx - Import context for reporting
	 * @returns true if file should be skipped, false otherwise
	 */
	private async shouldSkipExistingFile(
		filePath: string,
		notionId: string,
		ctx: ImportContext
	): Promise<boolean> {
		// Check if file exists
		const file = this.vault.getAbstractFileByPath(normalizePath(filePath));
		if (!file || !(file instanceof TFile)) {
			return false; // File doesn't exist, don't skip
		}

		// Read the note's own text rather than the metadata cache, which is
		// filled in afterwards and would report no frontmatter for a note this
		// import wrote moments ago.
		try {
			const content = await this.vault.read(file);

			if (this.sourceIdIn(content, NOTION_ID_PROPERTY) === notionId) {
				// Same notion-id, skip this file
				const { basename } = parseFilePath(filePath);
				ctx.reportSkipped(basename, 'already exists with same notion-id');

				// IMPORTANT: Register this skipped file in notionIdToPath mapping
				// This ensures that relation/mention links can find this page even though it wasn't imported in this session
				// Without this, we would fail to resolve relations to previously imported pages
				const filePathWithoutExtension = filePath.replace(/\.md$/, '');
				this.notionIdToPath.set(notionId, filePathWithoutExtension);

				// IMPORTANT: Scan for unresolved placeholders from previous imports
				// If the file contains placeholders (relation UUIDs, mentions, synced children) that weren't replaced,
				// we need to re-collect them so they can be resolved in this import session
				await this.collectUnresolvedPlaceholders(content, notionId, filePath);

				return true;
			}

			// A different notion-id, or none, is a different page: do not skip it
			return false;
		}
		catch (error) {
			console.error(`Failed to read file ${filePath} for duplicate check:`, error);
			return false; // On error, don't skip
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

	/**
	 * Clean up notion-id from all imported files' frontmatter
	 * This is called ONLY at the end of FULL import (not incremental import)
	 * 
	 * Strategy: We always write notion-id during import (for both modes)
	 * to handle interruptions gracefully. If interrupted, next import can read
	 * notion-id to correctly skip duplicates or resume.
	 * - Incremental import: Keep notion-id for future imports to skip duplicates
	 * - Full import: Remove notion-id after completion to avoid cluttering frontmatter
	 * 
	 * @param ctx - Import context for status updates
	 */
	private async cleanupNotionIds(ctx: ImportContext): Promise<void> {
		if (this.notionIdToPath.size === 0) {
			return;
		}

		let failedCount = 0;

		// Iterate through all pages we've tracked (including skipped ones)
		for (const filePath of this.notionIdToPath.values()) {
			if (await ctx.shouldStop()) break;

			try {
				const file = this.vault.getAbstractFileByPath(filePath + '.md');
				if (!file || !(file instanceof TFile)) {
					continue;
				}

				// Read file content
				const content = await this.vault.read(file);

				// Check if file has frontmatter with notion-id
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

				// Remove the notion-id line from frontmatter
				const newFrontmatter = frontmatter
					.split('\n')
					.filter(line => !line.match(/^notion-id:\s*.+$/))
					.join('\n');

				// Reconstruct the content
				const newContent = content.replace(
					frontmatterRegex,
					`---\n${newFrontmatter}\n---`
				);

				// Write back to file
				await modifyFilePreservingTimestamps(this.vault, file, newContent);
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
}

function modifyFilePreservingTimestamps(vault: Vault, file: TFile, newContent: string): Promise<void> {
	return vault.modify(file, newContent, { mtime: file.stat.mtime, ctime: file.stat.ctime });
}
