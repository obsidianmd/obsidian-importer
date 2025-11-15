import { Notice, Setting, normalizePath, requestUrl, TFile, TFolder } from 'obsidian';
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
import { DatabaseInfo, RelationPlaceholder, DatabaseProcessingContext } from './notion-api/types';
import { downloadAttachment } from './notion-api/attachment-helpers';

export type FormulaImportStrategy = 'static' | 'function' | 'hybrid';

export type BaseViewType = 'table' | 'cards' | 'list';

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
	formulaStrategy: FormulaImportStrategy = 'function'; // Default strategy
	downloadExternalAttachments: boolean = false; // Download external attachments
	coverPropertyName: string = 'cover'; // Custom property name for page cover
	baseViewType: BaseViewType = 'table'; // Default view type for .base files
	incrementalImport: boolean = true; // Incremental import: skip files with same notion-id
	private notionClient: Client | null = null;
	private processedPages: Set<string> = new Set();
	private requestCount: number = 0;
	// Page/database tree for selection
	private pageTree: NotionTreeNode[] = [];
	private pageTreeContainer: HTMLElement | null = null;
	private listPagesButton: HTMLButtonElement | null = null;
	// save output root path for database handling
	//  we will flatten all database in this folder later
	private outputRootPath: string = '';
	// Track all processed databases for relation resolution
	private processedDatabases: Map<string, DatabaseInfo> = new Map();
	// Track all relation placeholders that need to be replaced
	private relationPlaceholders: RelationPlaceholder[] = [];
	// Progress counters: separate tracking for pages and attachments
	private pagesImported: number = 0;
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
		this.addOutputLocationSetting('Notion API Import');

		// Notion API Token input
		new Setting(this.modal.contentEl)
			.setName('Notion API token')
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

		// Incremental import setting
		new Setting(this.modal.contentEl)
			.setName('Incremental import')
			.setDesc('Skip files that already exist with the same notion-id. Disable to always import (will rename duplicates).')
			.addToggle(toggle => toggle
				.setValue(true) // Default to enabled
				.onChange(value => {
					this.incrementalImport = value;
				}));

		// List pages button
		const listPagesSetting = new Setting(this.modal.contentEl)
			.setName('Select pages to import')
			.setDesc('Click the button below to list all pages and databases you can import.');
		
		listPagesSetting.addButton(button => {
			button
				.setButtonText('List importable pages')
				.onClick(async () => {
					try {
						// Get button reference at click time
						this.listPagesButton = button.buttonEl;
						await this.loadPageTree();
					}
					catch (error) {
						console.error('[Notion Importer] Error in loadPageTree:', error);
						new Notice(`Failed to load pages: ${error.message}`);
					}
				});
			// Also save initial reference
			this.listPagesButton = button.buttonEl;
		});

		// Page tree container (initially visible with placeholder)
		this.pageTreeContainer = this.modal.contentEl.createDiv();
		this.pageTreeContainer.addClass('notion-page-tree-container');
		this.pageTreeContainer.style.maxHeight = '260px';
		this.pageTreeContainer.style.minHeight = '100px';
		this.pageTreeContainer.style.overflowY = 'auto';
		this.pageTreeContainer.style.border = '1px solid var(--background-modifier-border)';
		this.pageTreeContainer.style.borderRadius = '4px';
		this.pageTreeContainer.style.padding = '10px';
		this.pageTreeContainer.style.marginTop = '10px';
		this.pageTreeContainer.style.marginBottom = '10px';
		
		// Add placeholder text
		const placeholder = this.pageTreeContainer.createDiv();
		placeholder.addClass('notion-tree-placeholder');
		placeholder.style.color = 'var(--text-muted)';
		placeholder.style.textAlign = 'center';
		placeholder.style.padding = '30px 10px';
		placeholder.setText('Click "List importable pages" to load your Notion pages and databases.');

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
			.setName('Default view type')
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
			href: 'https://www.notion.so/profile/integrations',
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

	/**
	 * Initialize Notion client if not already initialized
	 */
	private initializeNotionClient(): void {
		if (this.notionClient) return;

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
		this.listPagesButton.disabled = true;
		this.listPagesButton.setText('Loading...');

		try {
			this.initializeNotionClient();

			// Create a minimal context for makeNotionRequest
			const tempCtx = {
				status: (msg: string) => {
					// Update button text with status
					if (this.listPagesButton) {
						this.listPagesButton.setText(msg);
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

			// Render tree
			this.renderPageTree();

			new Notice(`Found ${allItems.length} pages and databases.`);
		}
		catch (error) {
			console.error('[Notion Importer] Failed to load pages:', error);
			new Notice(`Failed to load pages: ${error.message || 'Unknown error'}`);
		}
		finally {
			// Re-enable button
			if (this.listPagesButton) {
				this.listPagesButton.disabled = false;
				this.listPagesButton.setText('Refresh list');
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
			this.pageTreeContainer = this.modal.contentEl.querySelector('.notion-page-tree-container') as HTMLElement;
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
		const treeEl = this.pageTreeContainer.createDiv('notion-tree');
		for (const node of this.pageTree) {
			this.renderTreeNode(treeEl, node, 0);
		}
	}

	/**
	 * Render a single tree node
	 */
	private renderTreeNode(container: HTMLElement, node: NotionTreeNode, level: number): void {
		
		const nodeEl = container.createDiv('notion-tree-node');
		nodeEl.style.display = 'flex';
		nodeEl.style.alignItems = 'center';
		nodeEl.style.paddingTop = '4px';
		nodeEl.style.paddingBottom = '4px';
		nodeEl.style.paddingLeft = `${8 + level * 20}px`; // 8px base + 20px per level
		nodeEl.style.paddingRight = '8px';
		nodeEl.style.cursor = node.disabled ? 'not-allowed' : 'pointer';
		
		// Apply disabled styling
		if (node.disabled) {
			nodeEl.style.opacity = '0.5';
			nodeEl.style.pointerEvents = 'none'; // Prevent clicking on the entire row
		}

		// Collapse/Expand arrow (only if has children)
		if (node.children.length > 0) {
			const arrow = nodeEl.createSpan();
			arrow.setText(node.collapsed ? '▶' : '▼');
			arrow.style.marginRight = '4px';
			arrow.style.cursor = 'pointer';
			arrow.style.userSelect = 'none';
			arrow.style.fontSize = '10px';
			arrow.style.width = '20px'; // Increased from 12px
			arrow.style.height = '20px';
			arrow.style.display = 'inline-flex';
			arrow.style.alignItems = 'center';
			arrow.style.justifyContent = 'center';
			arrow.style.padding = '2px';
			arrow.style.borderRadius = '3px';
			
			// Hover effect
			arrow.addEventListener('mouseenter', () => {
				arrow.style.backgroundColor = 'var(--background-modifier-hover)';
			});
			arrow.addEventListener('mouseleave', () => {
				arrow.style.backgroundColor = 'transparent';
			});
			
			// Allow arrow click even when disabled (to expand/collapse)
			// But need to override the pointerEvents: none from parent
			if (node.disabled) {
				arrow.style.pointerEvents = 'auto';
			}
			
			arrow.addEventListener('click', (e) => {
				e.stopPropagation(); // Prevent triggering row click
				node.collapsed = !node.collapsed;
				this.renderPageTree(); // Re-render to show/hide children
			});
		}
		else {
			// Add spacing for nodes without children to align with those that have arrows
			const spacer = nodeEl.createSpan();
			spacer.style.width = '24px'; // Match arrow width (20px) + marginRight (4px)
			spacer.style.display = 'inline-block';
		}

		// Checkbox
		const checkbox = nodeEl.createEl('input', { type: 'checkbox' });
		checkbox.checked = node.selected;
		checkbox.disabled = node.disabled;
		checkbox.style.marginRight = '8px';
		checkbox.style.cursor = node.disabled ? 'not-allowed' : 'pointer';
		
		if (!node.disabled) {
			checkbox.addEventListener('change', () => {
				this.toggleNodeSelection(node, checkbox.checked);
				this.renderPageTree(); // Re-render to update disabled states
			});
		}

		// Icon
		const icon = nodeEl.createSpan();
		icon.style.marginRight = '6px';
		if (node.type === 'database') {
			icon.setText('🗄️');
		}
		else {
			icon.setText(node.children.length > 0 ? '📁' : '📄');
		}

		// Title
		const title = nodeEl.createSpan();
		title.setText(node.title);
		title.style.flex = '1';

		// Render children (only if not collapsed)
		if (node.children.length > 0 && !node.collapsed) {
			for (const child of node.children) {
				this.renderTreeNode(container, child, level + 1);
			}
		}
	}

	/**
	 * Toggle node selection and update children/parent states
	 */
	private toggleNodeSelection(node: NotionTreeNode, selected: boolean): void {
		node.selected = selected;

		// If selected, disable and select all children
		if (selected) {
			// Expand the node to show children
			if (node.children.length > 0) {
				node.collapsed = false;
			}
			this.selectAllChildren(node, true);
		}
		// If deselected, enable all children (but keep them deselected)
		else {
			this.enableAllChildren(node);
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
	 * Get all selected node IDs (flattened)
	 */
	private getSelectedNodeIds(): string[] {
		const selected: string[] = [];
		
		const collectSelected = (nodes: NotionTreeNode[]) => {
			for (const node of nodes) {
				// Only collect nodes that are directly selected by user (not disabled)
				// Disabled nodes are auto-selected because their parent is selected
				// and will be imported recursively with their parent
				if (node.selected && !node.disabled) {
					selected.push(node.id);
				}
				collectSelected(node.children);
			}
		};
		
		collectSelected(this.pageTree);
		return selected;
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
			// Initialize Notion client
			this.initializeNotionClient();

			ctx.status('Fetching page content from Notion...');
		
			// Reset processed pages tracker
			this.processedPages.clear();
			this.processedDatabases.clear();
			this.relationPlaceholders = [];
			this.pagesImported = 0;
			this.attachmentsDownloaded = 0;
	
			// Initialize progress display (indeterminate - we don't know total count)
			ctx.reportProgressIndeterminate(0);
		
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
						await this.fetchAndImportPage(ctx, itemId, folder.path);
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
			
				// Check for incremental import
				const fileName = `${sanitizedTitle}.md`;
				const potentialFilePath = normalizePath(`${pageFolderPath}/${fileName}`);
				shouldSkipParentFile = await this.shouldSkipFileForIncrementalImport(potentialFilePath, pageId, ctx);
			
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
				client: this.notionClient!,
				vault: this.vault,
				downloadExternalAttachments: this.downloadExternalAttachments,
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
					await this.fetchAndImportPage(ctx, childPageId, parentPath);
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
					onPagesDiscovered: (newPagesCount: number) => {
						// Callback provided but not used - progress is reported per page/attachment
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
							currentFolderPath: currentFileFolderPath,
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

				await this.vault.create(normalizePath(mdFilePath), fullContent);

				// Update progress: page imported successfully
				this.pagesImported++;
				ctx.notes = this.pagesImported;
				ctx.reportProgressIndeterminate(this.pagesImported);

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
			// Note: Even if parent file is skipped, child pages have already been processed
			// by the importPageCallback in convertBlocksToMarkdown
			
		}
		catch (error) {
			console.error(`Failed to import page ${pageId}:`, error);
			const pageTitle = 'Unknown page';
			const errorMsg = error instanceof Error ? error.message : String(error);
			ctx.reportFailed(pageTitle, errorMsg);
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
				client: this.notionClient!,
				vault: this.vault,
				outputRootPath: this.outputRootPath,
				formulaStrategy: this.formulaStrategy,
				processedDatabases: this.processedDatabases,
				relationPlaceholders: this.relationPlaceholders,
				importPageCallback: async (pageId: string, parentPath: string, databaseTag?: string) => {
					await this.fetchAndImportPage(ctx, pageId, parentPath, databaseTag);
				},
				// onPagesDiscovered callback not provided - not needed for unimported databases
				baseViewType: this.baseViewType,
				coverPropertyName: this.coverPropertyName
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
 * 2. If not imported → try to import to Notion Synced Blocks folder
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
						// Try to import the page
							try {
								const { parent: parentPath } = parseFilePath(this.outputRootPath);
								const syncedBlocksFolder = normalizePath(
									parentPath ? `${parentPath}/Notion Synced Blocks` : 'Notion Synced Blocks'
								);
								await this.fetchAndImportPage(ctx, pageId, syncedBlocksFolder);
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
						// Try to import the database
							try {
								const { parent: parentPath } = parseFilePath(this.outputRootPath);
								const syncedBlocksFolder = normalizePath(
									parentPath ? `${parentPath}/Notion Synced Blocks` : 'Notion Synced Blocks'
								);
								await this.importTopLevelDatabase(ctx, databaseId, syncedBlocksFolder);
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
	 * Check if a file should be skipped for incremental import
	 * @param filePath - Path to the file to check
	 * @param notionId - Notion ID of the page being imported
	 * @param ctx - Import context for reporting
	 * @returns true if file should be skipped, false otherwise
	 */
	private async shouldSkipFileForIncrementalImport(
		filePath: string,
		notionId: string,
		ctx: ImportContext
	): Promise<boolean> {
		// If not incremental import, never skip
		if (!this.incrementalImport) {
			return false;
		}

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
					ctx.reportSkipped(basename, 'already exists with same notion-id (incremental import)');
					return true;
				}
			}
			// Different notion-id or no notion-id, don't skip (will rename)
			return false;
		}
		catch (error) {
			console.error(`Failed to read file ${filePath} for incremental check:`, error);
			return false; // On error, don't skip
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
		
		// Check if base path should be skipped
		const shouldSkip = await this.shouldSkipFileForIncrementalImport(basePath, notionId, ctx);
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
	
}
