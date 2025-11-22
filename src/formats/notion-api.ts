import { Notice, Setting, normalizePath, requestUrl, TFile, TFolder, setIcon } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { Client, PageObjectResponse } from '@notionhq/client';
import { sanitizeFileName, serializeFrontMatter } from '../util';
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
import { getUniqueFolderPath, getUniqueFilePath } from './notion-api/vault-helpers';
import { processDatabasePlaceholders, importDatabaseCore } from './notion-api/database-helpers';
import { DatabaseInfo, RelationPlaceholder, DatabaseProcessingContext, FetchAndImportPageParams } from './notion-api/types';
import { downloadAttachment } from './notion-api/attachment-helpers';

export type FormulaImportStrategy = 'static' | 'hybrid';

// Notion API parent types (based on @notionhq/client internal types)
type NotionParent = 
	| { type: 'page_id', page_id: string }
	| { type: 'data_source_id', data_source_id: string, database_id: string }
	| { type: 'database_id', database_id: string }
	| { type: 'workspace', workspace: true }
	| { type: 'block_id', block_id: string };

// Tree node for page/database selection
interface NotionTreeNode {
	id: string; // For pages: page ID; For databases: data_source ID
	title: string;
	type: 'page' | 'database';
	parentId: string | null;
	children: NotionTreeNode[];
	selected: boolean;
	disabled: boolean; // Disabled when parent is selected
	collapsed: boolean; // Whether the node's children are collapsed
}

export class NotionAPIImporter extends FormatImporter {
	notionToken: string = '';
	formulaStrategy: FormulaImportStrategy = 'hybrid'; // Default strategy
	downloadExternalAttachments: boolean = false; // Download external attachments
	coverPropertyName: string = 'cover'; // Custom property name for page cover
	databasePropertyName: string = 'base'; // Property name for linking pages to their database
	incrementalImport: boolean = false; // Incremental import: skip files with same notion-id (default: disabled)
	private notionClient: Client | null = null;
	private processedPages: Set<string> = new Set();
	private requestCount: number = 0;
	private totalNodesToImport: number = 0; // Total number of nodes selected for import
	private selectedNodeIds: Set<string> = new Set(); // IDs of nodes selected in tree for progress tracking
	// Page/database tree for selection
	private pageTree: NotionTreeNode[] = [];
	private pageTreeContainer: HTMLElement | null = null;
	private listPagesButton: any = null;  // ButtonComponent from obsidian
	private toggleSelectButton: any = null;  // ButtonComponent from obsidian
	// save output root path for database handling
	//  we will flatten all database in this folder later
	private outputRootPath: string = '';
	// Track all processed databases for relation resolution
	private processedDatabases: Map<string, DatabaseInfo> = new Map();
	// Track all relation placeholders that need to be replaced
	private relationPlaceholders: RelationPlaceholder[] = [];
	// Progress counters: separate tracking for pages and attachments
	private processedPagesCount: number = 0; // Total processed (imported + skipped) for progress tracking
	private attachmentsDownloaded: number = 0;
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

		// Notion API Token input
		new Setting(this.modal.contentEl)
			.setName('Notion API token')
			.setDesc(this.createTokenDescription())
			.addText(text => text
				.setPlaceholder('ntn_...')
				.setValue(this.notionToken)
				.onChange(value => {
					this.notionToken = value.trim();
				})
				.then(textComponent => {
					// Set as password input
					textComponent.inputEl.type = 'password';
				}));

		// List pages and toggle selection buttons
		const listPagesSetting = new Setting(this.modal.contentEl)
			.setName('Select pages to import')
			.setDesc('Click "Load" to see all of the importable pages and databases. If a page or database is missing, verify the Notion integration has access to it.');
			
		// Store button references in closure to avoid constructor timing issues
		let toggleButtonRef: any = null;
		let listButtonRef: any = null;

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
				button.buttonEl.addClass('notion-toggle-button');
				button.buttonEl.style.display = 'none'; // Hide until tree is loaded
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
						new Notice(`Failed to load pages: ${error.message}`);
					}
				});
		
			// Add custom class for fixed width
			if (button.buttonEl) {
				button.buttonEl.addClass('notion-load-button');
				button.buttonEl.addClass('mod-cta');
			}
		
			return button;
		});


		// Page tree container (using Publish plugin's style with proper hierarchy)
		// Create the section wrapper
		const publishSection = this.modal.contentEl.createDiv();
		publishSection.addClass('file-tree', 'publish-section');
	
		// Create the change list container
		this.pageTreeContainer = publishSection.createDiv('publish-change-list');
		this.pageTreeContainer.style.maxHeight = '400px';
		this.pageTreeContainer.style.overflowY = 'auto';
		
		// Add placeholder text
		const placeholder = this.pageTreeContainer.createDiv();
		placeholder.style.color = 'var(--text-muted)';
		placeholder.style.textAlign = 'center';
		placeholder.style.padding = '30px 10px';
		placeholder.setText('Click "Load" to load your Notion pages and databases.');

		// Incremental import setting
		new Setting(this.modal.contentEl)
			.setName('Incremental import')
			.setDesc('Incremental imports will add an extra notion-id attribute to pages, ensuring that future imports can skip pages that have already been imported.')
			.addToggle(toggle => toggle
				.setValue(false) // Default to disabled
				.onChange(value => {
					this.incrementalImport = value;
				}));

		// Formula import strategy
		new Setting(this.modal.contentEl)
			.setName('Convert formulas')
			.setDesc(this.createFormulaStrategyDescription())
			.addDropdown(dropdown => {
				dropdown
					.addOption('static', 'To static values')
					.addOption('hybrid', 'To Obsidian syntax')
					.setValue('hybrid') // Set default to 'hybrid'
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

		// Database property name
		new Setting(this.modal.contentEl)
			.setName('Database property name')
			.setDesc('Property name in page frontmatter to link pages to their database .base file (default: "base")')
			.addText(text => text
				.setPlaceholder('base')
				.setValue('base')
				.onChange(value => {
					this.databasePropertyName = value.trim() || 'base';
				}));
	}

	private createTokenDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('To get an API token create an integration in Notion and give it access to pages in your workspace. ');
		frag.createEl('a', {
			text: 'Get API token',
			href: 'https://www.notion.so/profile/integrations',
		});
		return frag;
	}

	private createFormulaStrategyDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('By default Notion formulas are converted to Obsidian syntax. If any Notion syntax is not supported the static values will be saved instead. Alternatively you can import all formulas as static values.');
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

	/**
	 * Initialize Notion client if not already initialized
	 */
	private initializeNotionClient(): void {
		this.notionClient = new Client({
			auth: this.notionToken,
			notionVersion: '2025-09-03',
			fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
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
			const allItems: Array<{ id: string, title: string, type: 'page' | 'database', parentId: string | null }> = [];
			let cursor: string | undefined = undefined;
			let pageCount = 0;

			do {
				pageCount++;
				
				// Update button text with progress
				tempCtx.status(`Loading... (${allItems.length} items, page ${pageCount})`);

				// Use makeNotionRequest for rate limiting and error handling
				// Note: Not using filter to get both pages and databases
				const response: any = await makeNotionRequest(
					() => this.notionClient!.search({
						start_cursor: cursor,
						page_size: 100,
					}),
					tempCtx
				);

				// Process results immediately
				for (const item of response.results) {
					// Skip items with block_id parent - these are child pages/databases within blocks
					// They will be imported automatically when their parent page is imported
					if (item.parent && item.parent.type === 'block_id') {
						continue;
					}
					
					// Process page or data_source (database)
					if (item.object === 'page' || item.object === 'data_source') {
						const isDatabase = item.object === 'data_source';
						const title = this.extractItemTitle(item, isDatabase ? 'Untitled Database' : 'Untitled');
						const parentObj = isDatabase ? item.database_parent : item.parent;
						const parentId = this.extractParentId(parentObj, isDatabase ? 'database' : 'page');
						
						allItems.push({
							id: item.id,
							title,
							type: isDatabase ? 'database' : 'page',
							parentId
						});
					}
				}

				cursor = response.has_more ? response.next_cursor : undefined;
			} while (cursor);
			// Build tree structure
			this.pageTree = this.buildTree(allItems);

			// Render tree (this will also update button text)
			this.renderPageTree();
		
			// Show the Select all button now that we have content
			if (this.toggleSelectButton && this.toggleSelectButton.buttonEl) {
				this.toggleSelectButton.buttonEl.style.display = '';
			}

			new Notice(`Found ${allItems.length} pages and databases.`);
		}
		catch (error) {
			console.error('[Notion Importer] Failed to load pages:', error);
			new Notice(`Failed to load pages: ${error.message || 'Unknown error'}`);
		}
		finally {
			// Re-enable button
			if (this.listPagesButton) {
				this.listPagesButton.setDisabled(false);
				this.listPagesButton.setButtonText('Refresh');
			}
		}
	}

	/**
	 * Extract title from a Notion item (page or data_source)
	 * Both use the same title array structure with rich text
	 */
	private extractItemTitle(item: any, defaultTitle: string = 'Untitled'): string {
		let titleArray: any[] | undefined;
		
		// data_source has title directly
		if (item.title) {
			titleArray = item.title;
		}
		// page has title in properties object
		// properties is an object where one of the keys has type: 'title'
		else if (item.properties) {
			// Find the property with type 'title'
			for (const key in item.properties) {
				const prop = item.properties[key];
				if (prop.type === 'title' && prop.title) {
					titleArray = prop.title;
					break;
				}
			}
		}
		
		if (!titleArray || !Array.isArray(titleArray)) {
			return defaultTitle;
		}
		
		const title = titleArray
			.map((t: any) => t.text?.content || t.plain_text || '')
			.join('')
			.trim();
		
		return title || defaultTitle;
	}

	/**
	 * Extract parent ID from a parent object (used for both page.parent and data_source.database_parent)
	 * Note: Items with block_id parent should be filtered out before calling this
	 */
	private extractParentId(
		parentObj: NotionParent | null | undefined,
		context: 'page' | 'database'
	): string | null {
		if (!parentObj) {
			return null;
		}
		
		switch (parentObj.type) {
			case 'page_id':
				return parentObj.page_id;
			
			case 'data_source_id':
				// Pages in a database have data_source_id as parent
				return parentObj.data_source_id;
			
			case 'database_id':
				// Databases can have database_id as parent (nested databases)
				return parentObj.database_id;
			
			case 'workspace':
				// Top-level item
				return null;
			
			case 'block_id':
				// This should have been filtered out before calling this function
				console.warn(`[Notion Importer] block_id parent should be filtered before calling extractParentId`);
				return null;
			
			default:
				// TypeScript exhaustiveness check
				const _exhaustive: never = parentObj;
				console.warn(`[Notion Importer] Unexpected parent type for ${context}:`, _exhaustive);
				return null;
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
	 * Build tree structure from flat list
	 */
	private buildTree(items: Array<{ id: string, title: string, type: 'page' | 'database', parentId: string | null }>): NotionTreeNode[] {
		const nodeMap = new Map<string, NotionTreeNode>();
		const roots: NotionTreeNode[] = [];

		// Create all nodes
		for (const item of items) {
			nodeMap.set(item.id, {
				id: item.id,
				title: item.title,
				type: item.type,
				parentId: item.parentId,
				children: [],
				selected: false,
				disabled: false,
				collapsed: true, // Default to collapsed
			});
		}

		// Build tree relationships
		for (const node of nodeMap.values()) {
			if (node.parentId && nodeMap.has(node.parentId)) {
				const parent = nodeMap.get(node.parentId)!;
				parent.children.push(node);
			}
			else {
				// No parent or parent not in list -> root node
				roots.push(node);
			}
		}

		// Sort children by title
		const sortNodes = (nodes: NotionTreeNode[]) => {
			nodes.sort((a, b) => a.title.localeCompare(b.title));
			for (const node of nodes) {
				sortNodes(node.children);
			}
		};
		sortNodes(roots);

		return roots;
	}

	/**
	 * Render page tree UI
	 */
	private renderPageTree(): void {
		// Try to get container reference if lost
		if (!this.pageTreeContainer) {
			this.pageTreeContainer = this.modal.contentEl.querySelector('.publish-change-list') as HTMLElement;
		}
		
		if (!this.pageTreeContainer) {
			console.error('[Notion Importer] Container not found!');
			return;
		}

		this.pageTreeContainer.empty();

		if (this.pageTree.length === 0) {
			this.pageTreeContainer.createEl('div', {
				text: 'No pages or databases found. Make sure your integration has access to the pages you want to import.',
				cls: 'notion-tree-empty'
			});
			return;
		}
	
		// Render tree (buttons are now outside the scrollable container)
		for (const node of this.pageTree) {
			this.renderTreeNode(this.pageTreeContainer, node, 0);
		}
	
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
		
		// Apply disabled styling
		if (node.disabled) {
			treeItemSelf.addClass('is-disabled');
			treeItemSelf.style.opacity = '0.5';
			treeItemSelf.style.pointerEvents = 'none';
		}
	
		// Collapse/Expand arrow (only if has children)
		if (node.children.length > 0) {
			const collapseIcon = treeItemSelf.createDiv('tree-item-icon collapse-icon');
		
			// Use right-triangle icon (Obsidian's standard)
			setIcon(collapseIcon, 'right-triangle');
		
			// Add is-collapsed class for CSS control
			if (node.collapsed) {
				collapseIcon.addClass('is-collapsed');
				treeItem.addClass('is-collapsed');
			}
		
			// Allow arrow click even when disabled
			if (node.disabled) {
				collapseIcon.style.pointerEvents = 'auto';
			}
		
			// Store references for event handler
			const treeItemRef = treeItem;
			let childrenContainer: HTMLElement;
			let iconContainer: HTMLElement;
		
			// Toggle collapse state with pure DOM manipulation (no re-render)
			collapseIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				node.collapsed = !node.collapsed;
			
				// Get references if not set yet
				if (!childrenContainer) {
					childrenContainer = treeItemRef.querySelector('.tree-item-children') as HTMLElement;
				}
				if (!iconContainer) {
					iconContainer = treeItemRef.querySelector('.file-tree-item-icon') as HTMLElement;
				}
			
				// Toggle CSS classes and visibility
				if (node.collapsed) {
					collapseIcon.addClass('is-collapsed');
					treeItemRef.addClass('is-collapsed');
					if (childrenContainer) childrenContainer.style.display = 'none';
					// Update folder icon
					if (node.type !== 'database' && iconContainer) {
						iconContainer.empty();
						setIcon(iconContainer, 'folder');
					}
				}
				else {
					collapseIcon.removeClass('is-collapsed');
					treeItemRef.removeClass('is-collapsed');
					if (childrenContainer) childrenContainer.style.display = '';
					// Update folder icon
					if (node.type !== 'database' && iconContainer) {
						iconContainer.empty();
						setIcon(iconContainer, 'folder-open');
					}
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
				this.toggleNodeSelection(node, checkbox.checked);
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
			childrenContainer.style.display = 'none';
		}
	
		// Render children (always render, but hide if collapsed)
		if (node.children.length > 0) {
			for (const child of node.children) {
				this.renderTreeNode(childrenContainer, child, level + 1);
			}
		}
	}

	/**
	 * Toggle node selection and update children/parent states
	 */
	private toggleNodeSelection(node: NotionTreeNode, selected: boolean): void {
		node.selected = selected;

		// If selected, disable and select all children (but don't expand)
		if (selected) {
			this.selectAllChildren(node, true);
		}
		// If deselected, enable all children (but keep them deselected)
		else {
			this.enableAllChildren(node);
		}
	}

	/**
	 * Select or deselect all nodes in the tree
	 */
	private selectAllNodes(selected: boolean): void {
		const processNode = (node: NotionTreeNode) => {
			// Only modify nodes that are not disabled
			if (!node.disabled) {
				node.selected = selected;
				// If selecting, select children (but don't expand)
				if (selected) {
					this.selectAllChildren(node, true);
				}
				// If deselecting, enable all children
				else {
					this.enableAllChildren(node);
				}
			}
			// Process children even if parent is disabled
			for (const child of node.children) {
				processNode(child);
			}
		};
		
		for (const node of this.pageTree) {
			processNode(node);
		}
	}

	/**
	 * Select/deselect all children recursively
	 */
	private selectAllChildren(node: NotionTreeNode, selected: boolean): void {
		for (const child of node.children) {
			child.selected = selected;
			child.disabled = selected;
			this.selectAllChildren(child, selected);
		}
	}

	/**
	 * Enable all children recursively (remove disabled state)
	 */
	private enableAllChildren(node: NotionTreeNode): void {
		for (const child of node.children) {
			child.disabled = false;
			child.selected = false;
			this.enableAllChildren(child);
		}
	}

	/**
	 * Check if all nodes in the tree are selected
	 * Used to determine button text and behavior (Select all vs Deselect all)
	 * Returns true if ALL nodes (including disabled children) are selected
	 */
	private areAllNodesSelected(): boolean {
		const checkNode = (nodes: NotionTreeNode[]): boolean => {
			for (const node of nodes) {
				// If any node is not selected, return false
				if (!node.selected) {
					return false;
				}
				// Recursively check children
				if (!checkNode(node.children)) {
					return false;
				}
			}
			return true;
		};
		
		return checkNode(this.pageTree);
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
		const allSelected = this.areAllNodesSelected();
		
		if (allSelected) {
			// All selected, deselect all
			this.selectAllNodes(false);
		}
		else {
			// Not all selected (some or none), select all
			this.selectAllNodes(true);
		}
		
		this.renderPageTree(); // This will call updateToggleButtonText()
	}

	/**
	 * Update toggle select button text based on current selection state
	 */
	private updateToggleButtonText(): void {
		if (!this.toggleSelectButton) {
			return;
		}
		const allSelected = this.areAllNodesSelected();
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
			this.processedPagesCount = 0;
			this.attachmentsDownloaded = 0;
	
			// Note: getSelectedNodeIds() already populated this.selectedNodeIds and this.totalNodesToImport
			ctx.status(`Preparing to import ${this.totalNodesToImport} item(s)...`);
		
			// Initialize progress display with known total count
			ctx.reportProgress(0, this.totalNodesToImport);
	
			// Save output root path for database handling
			this.outputRootPath = folder.path;
		
			// Import all selected pages/databases
			ctx.status(`Importing ${selectedIds.length} item(s)...`);
			
			for (let i = 0; i < selectedIds.length; i++) {
				if (ctx.isCancelled()) break;
				
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
						console.warn(`Unknown node type: ${node.type} (ID: ${itemId})`);
						ctx.reportFailed(`Import item ${itemId}`, `Unknown type: ${node.type}`);
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
	private async importTopLevelDatabase(
		ctx: ImportContext,
		databaseId: string,
		parentPath: string,
		options: {
			isDataSourceId?: boolean;
		} = {}
	): Promise<void> {
		if (ctx.isCancelled()) return;
		
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
			// Use custom file name if provided, otherwise use page title
			const sanitizedTitle = customFileName ? sanitizeFileName(customFileName) : sanitizeFileName(pageTitle || 'Untitled');
	
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
					pageFolderPath = getUniqueFolderPath(this.vault, parentPath, sanitizedTitle);
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
				onAttachmentDownloaded: () => {
					this.attachmentsDownloaded++;
					ctx.attachments = this.attachmentsDownloaded;
					ctx.attachmentCountEl.setText(this.attachmentsDownloaded.toString());
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
			const frontMatter: Record<string, any> = {
				'notion-id': page.id,
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
				ctx
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
							currentPageTitle: sanitizedTitle
						}
					);
		
					// For frontmatter, use wiki link syntax with double quotes for proper rendering
					// Cover images should always be downloaded locally
					if (result.isLocal && result.filename) {
						// Report progress for cover image download
						this.attachmentsDownloaded++;
						ctx.attachments = this.attachmentsDownloaded;
						ctx.attachmentCountEl.setText(this.attachmentsDownloaded.toString());
					
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

				console.log(`[CREATE FILE] About to create file: ${mdFilePath}, Page ID: ${pageId}, Page Title: ${sanitizedTitle}`);
				console.log(`[CREATE FILE] File exists check: ${this.vault.getAbstractFileByPath(normalizePath(mdFilePath)) ? 'YES' : 'NO'}`);
			
				try {
					await this.vault.create(normalizePath(mdFilePath), fullContent);
					console.log(`[CREATE FILE] Successfully created: ${mdFilePath}`);
				}
				catch (error) {
					console.error(`[CREATE FILE] Failed to create file: ${mdFilePath}`);
					console.error(`[CREATE FILE] Page ID: ${pageId}, Page Title: ${sanitizedTitle}`);
					console.error(`[CREATE FILE] Error:`, error);
					throw error;
				}

				// Record page ID to path mapping for mention replacement
				// Store path without extension for wiki link generation
				const pathWithoutExt = mdFilePath.replace(/\.md$/, '');
				this.notionIdToPath.set(pageId, pathWithoutExt);
		
				// Record mention placeholders if any mentions were found
				// Use file path as key for O(1) lookup during replacement
				if (mentionedIds.size > 0) {
					this.mentionPlaceholders.set(mdFilePath, mentionedIds);
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
				
				// Import to the user-selected output root folder (e.g., "Notion")
				// No need to create a separate "Relation Unimported Databases" subfolder
				const unimportedDbPath = this.outputRootPath;
				
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
							// YAML frontmatter doesn't support Markdown syntax, so always use Wiki links
							// regardless of user's global link format setting
							// Use Obsidian wiki link with display text: [[path/to/file|display name]]
							// This ensures precise linking (no ambiguity with duplicate names)
							// while displaying only the clean file name
							const displayName = relatedPageFile.basename; // Just the file name for display
							const wikiLink = `"[[${relatedPagePath}|${displayName}]]"`;
			
							// Replace the page ID with the link in the YAML
							// Note: stringifyYaml does NOT add quotes to UUID strings, so we search for unquoted IDs
							// and replace them with quoted links
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
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to replace relation placeholder for page ${placeholder.pageId}:`, error);
				ctx.reportFailed(`Relation page ${placeholder.pageId}`, errorMessage);
			}
		}
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
					await this.vault.modify(file, content);
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
					await this.vault.modify(file, content);
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

		// Read file and extract notion-id from frontmatter
		try {
			const content = await this.vault.read(file);
			const notionIdMatch = content.match(/^notion-id:\s*(.+)$/m);
		
			if (notionIdMatch) {
				const existingNotionId = notionIdMatch[1].trim();
				if (existingNotionId === notionId) {
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
			}
			// Different notion-id or no notion-id, don't skip (will rename with unique path)
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
				
				if (unresolvedRelations.size > 0) {
					console.log(`[Incremental Import] Collected ${unresolvedRelations.size} unresolved relation(s) from skipped file: ${pageId}`);
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
			console.log(`[Incremental Import] Collected ${mentionedIds.size} unresolved mention(s) from skipped file: ${filePath}`);
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
			console.log(`[Incremental Import] Collected ${syncedPageIds.size} unresolved synced child page(s) from skipped file: ${filePath}`);
		}
		
		if (syncedDbIds.size > 0) {
			this.syncedChildDatabasePlaceholders.set(filePath, syncedDbIds);
			console.log(`[Incremental Import] Collected ${syncedDbIds.size} unresolved synced child database(s) from skipped file: ${filePath}`);
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

		let cleanedCount = 0;
		let failedCount = 0;

		// Iterate through all pages we've tracked (including skipped ones)
		for (const filePath of this.notionIdToPath.values()) {
			if (ctx.isCancelled()) break;

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
				await this.vault.modify(file, newContent);
				cleanedCount++;
			}
			catch (error) {
				console.error(`Failed to clean notion-id from file: ${filePath}`, error);
				failedCount++;
			}
		}

		if (cleanedCount > 0) {
			console.log(`✓ Cleaned notion-id from ${cleanedCount} file(s)`);
		}
		if (failedCount > 0) {
			console.warn(`⚠️ Failed to clean notion-id from ${failedCount} file(s)`);
		}
	}
	
}
