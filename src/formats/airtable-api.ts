/**
 * Airtable API Importer
 * Imports tables and records from Airtable using the API
 */

import { Notice, Setting, normalizePath, TFile, setIcon, stringifyYaml, parseYaml } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { sanitizeFileName, serializeFrontMatter } from '../util';
import {
	TemplateConfigurator,
	TemplateConfig,
	TemplateField,
	applyTemplate,
} from '../template';

// Import helper modules
import { fetchBases, fetchTableSchema, fetchAllRecords } from './airtable-api/api-helpers';
import { convertFieldValue } from './airtable-api/field-converter';
import { processAttachmentsForYAML } from './airtable-api/attachment-helpers';
import type {
	FormulaImportStrategy,
	AirtableTreeNode,
	TableInfo,
	LinkedRecordPlaceholder,
	AirtableAttachment,
	PreparedTableData,
	AirtableRecord,
} from './airtable-api/types';

export class AirtableAPIImporter extends FormatImporter {
	airtableToken: string = '';
	formulaStrategy: FormulaImportStrategy = 'hybrid';
	downloadAttachments: boolean = true;
	viewPropertyName: string = 'base'; // Property name to track which views a record belongs to
	incrementalImport: boolean = false; // Incremental import: skip files with same airtable-id (default: disabled)
	
	// Tree for base/table selection
	private tree: AirtableTreeNode[] = [];
	private treeContainer: HTMLElement | null = null;
	private loadButton: any = null;
	private toggleSelectButton: any = null;
	
	// Tracking data
	private outputRootPath: string = '';
	private processedTables: Map<string, TableInfo> = new Map();
	private linkedRecordPlaceholders: LinkedRecordPlaceholder[] = [];
	private recordIdToPath: Map<string, string> = new Map(); // recordId -> file path
	private processedRecordsCount: number = 0;
	private totalRecordsToImport: number = 0;
	private attachmentsDownloaded: number = 0;
	
	// Template configuration
	private templateConfig: TemplateConfig | null = null;
	
	// Track which views each record belongs to
	private recordToViews: Map<string, Set<string>> = new Map(); // recordId -> Set of view names
	
	// Track all views for each table (for creating .base files)
	private tableViews: Map<string, Array<{name: string, type: string, id: string}>> = new Map();
	
	// Store all fields for property type inference
	private allFieldsForTypeInference: Map<string, any> = new Map();
	
	// Prepared data cache for two-phase import
	private preparedData: Map<string, PreparedTableData> = new Map();

	init() {
		this.addOutputLocationSetting('Airtable');

		// Airtable Personal Access Token input
		new Setting(this.modal.contentEl)
			.setName('Airtable Personal Access Token')
			.setDesc(this.createTokenDescription())
			.addText(text => text
				.setPlaceholder('pat...')
				.setValue(this.airtableToken)
				.onChange(value => {
					this.airtableToken = value.trim();
				})
				.then(textComponent => {
					textComponent.inputEl.type = 'password';
				}));

		// Load bases and tables button
		const loadSetting = new Setting(this.modal.contentEl)
			.setName('Select tables to import')
			.setDesc('Click "Load" to browse your Airtable bases and tables.');

		let toggleButtonRef: any = null;
		let loadButtonRef: any = null;

		// Toggle select all/none button
		loadSetting.addButton(button => {
			toggleButtonRef = button;
			button
				.setButtonText('Select all')
				.onClick(() => {
					this.toggleSelectButton = toggleButtonRef;
					this.handleToggleSelectClick();
				});

			if (button.buttonEl) {
				button.buttonEl.addClass('airtable-toggle-button');
				button.buttonEl.style.display = 'none';
			}

			return button;
		});

		// Load button
		loadSetting.addButton(button => {
			loadButtonRef = button;
			button
				.setButtonText('Load')
				.onClick(async () => {
					try {
						this.loadButton = loadButtonRef;
						this.toggleSelectButton = toggleButtonRef;
						await this.loadTree();
					}
					catch (error) {
						console.error('[Airtable Importer] Error loading tree:', error);
						new Notice(`Failed to load bases: ${error.message}`);
					}
				});

			if (button.buttonEl) {
				button.buttonEl.addClass('airtable-load-button');
				button.buttonEl.addClass('mod-cta');
			}

			return button;
		});

		// Tree container
		const treeSection = this.modal.contentEl.createDiv();
		treeSection.addClass('file-tree', 'airtable-section');

		this.treeContainer = treeSection.createDiv('airtable-tree-list');
		this.treeContainer.style.maxHeight = '200px';
		this.treeContainer.style.overflowY = 'auto';
		this.treeContainer.style.border = '1px solid var(--background-modifier-border)';
		this.treeContainer.style.borderRadius = 'var(--radius-s)';
		this.treeContainer.style.backgroundColor = 'var(--background-primary-alt)';
		this.treeContainer.style.padding = 'var(--size-4-2)';

		const placeholder = this.treeContainer.createDiv();
		placeholder.style.color = 'var(--text-muted)';
		placeholder.style.fontSize = 'var(--font-ui-small)';
		placeholder.style.textAlign = 'center';
		placeholder.style.padding = '30px 10px';
		placeholder.setText('Click "Load" to load your Airtable bases and tables.');

		// Formula import strategy
		new Setting(this.modal.contentEl)
			.setName('Convert formulas')
			.setDesc('Try to convert formulas to Obsidian syntax, or import as static values.')
			.addDropdown(dropdown => {
				dropdown
					.addOption('hybrid', 'Obsidian syntax (with fallback)')
					.addOption('static', 'Static values only')
					.setValue('hybrid')
					.onChange(value => {
						this.formulaStrategy = value as FormulaImportStrategy;
					});
			});

		// Download attachments option
		new Setting(this.modal.contentEl)
			.setName('Download attachments')
			.setDesc('Download attachment files to local vault. If disabled or download fails, external URLs will be used.')
			.addToggle(toggle => {
				toggle
					.setValue(true)
					.onChange(value => {
						this.downloadAttachments = value;
					});
			});

		// View property name
		new Setting(this.modal.contentEl)
			.setName('View property name')
			.setDesc('Property name to track which views a record belongs to. Each record will have a list of view names it appears in.')
			.addText(text => text
				.setPlaceholder('base')
				.setValue('base')
				.onChange(value => {
					this.viewPropertyName = value.trim() || 'base';
				}));

		// Incremental import setting
		new Setting(this.modal.contentEl)
			.setName('Incremental import')
			.setDesc('Adds an airtable-id property to records so that future imports can skip records that have already been imported.')
			.addToggle(toggle => toggle
				.setValue(false) // Default to disabled
				.onChange(value => {
					this.incrementalImport = value;
				}));
	}

	private createTokenDescription(): DocumentFragment {
		const frag = document.createDocumentFragment();
		frag.appendText('Create a Personal Access Token in your Airtable account settings. ');
		frag.createEl('a', {
			text: 'Get token',
			href: 'https://airtable.com/create/tokens',
		});
		return frag;
	}

	/**
	 * Load base and table tree from Airtable API
	 */
	private async loadTree(): Promise<void> {
		if (!this.airtableToken) {
			new Notice('Please enter your Airtable Personal Access Token first.');
			return;
		}

		if (!this.loadButton) {
			return;
		}

		this.loadButton.setDisabled(true);
		this.loadButton.setButtonText('Loading...');

		try {
			const tempCtx = {
				status: (msg: string) => {
					if (this.loadButton) {
						this.loadButton.setButtonText(msg);
					}
				},
				isCancelled: () => false,
				reportFailed: (name: string, error: any) => {
					console.error(`Failed: ${name}`, error);
				},
				statusMessage: '',
			} as unknown as ImportContext;

			// Fetch all bases
			const bases = await fetchBases(this.airtableToken, tempCtx);

			if (bases.length === 0) {
				new Notice('No bases found. Make sure your token has proper permissions.');
				return;
			}

			// Build tree structure
			const treeNodes: AirtableTreeNode[] = [];

			for (const base of bases) {
				tempCtx.status(`Loading tables for ${base.name}...`);

				// Fetch tables for this base
				const tables = await fetchTableSchema(base.id, this.airtableToken, tempCtx);

				// Create base node
				const baseNode: AirtableTreeNode = {
					id: base.id,
					title: base.name,
					type: 'base',
					parentId: null,
					children: [],
					selected: false,
					disabled: false,
					collapsed: true,
				};

				// Add table nodes
				for (const table of tables) {
					const tableNode: AirtableTreeNode = {
						id: `${base.id}:${table.id}`,
						title: table.name,
						type: 'table',
						parentId: base.id,
						children: [],  // No longer show views as children in tree
						selected: false,
						disabled: false,
						collapsed: true,
						metadata: {
							baseId: base.id,
							tableName: table.name,
							fields: table.fields,
							views: table.views,  // Store views in metadata for later use
						},
					};

					// Note: Views are not displayed in the tree anymore
					// Instead, we store them in table metadata and process all views when importing a table

					baseNode.children.push(tableNode);
				}

				treeNodes.push(baseNode);
			}

			this.tree = treeNodes;
			this.renderTree();

			if (this.toggleSelectButton && this.toggleSelectButton.buttonEl) {
				this.toggleSelectButton.buttonEl.style.display = '';
			}

			const tableCount = treeNodes.reduce((sum, base) => sum + base.children.length, 0);
			new Notice(`Found ${bases.length} base(s) with ${tableCount} table(s).`);
		}
		catch (error) {
			console.error('[Airtable Importer] Failed to load bases:', error);
			new Notice(`Failed to load bases: ${error.message || 'Unknown error'}`);
		}
		finally {
			if (this.loadButton) {
				this.loadButton.setDisabled(false);
				this.loadButton.setButtonText('Refresh');
			}
		}
	}

	/**
	 * Render tree UI
	 */
	private renderTree(): void {
		if (!this.treeContainer) {
			this.treeContainer = this.modal.contentEl.querySelector('.airtable-tree-list') as HTMLElement;
		}

		if (!this.treeContainer) {
			console.error('[Airtable Importer] Container not found!');
			return;
		}

		this.treeContainer.empty();

		if (this.tree.length === 0) {
			this.treeContainer.createEl('div', {
				text: 'No bases found.',
				cls: 'airtable-tree-empty'
			});
			return;
		}

		for (const node of this.tree) {
			this.renderTreeNode(this.treeContainer, node, 0);
		}

		if (this.toggleSelectButton) {
			this.updateToggleButtonText();
		}
	}

	/**
	 * Render a single tree node
	 */
	private renderTreeNode(container: HTMLElement, node: AirtableTreeNode, level: number): void {
		const treeItem = container.createDiv('tree-item');
		const treeItemSelf = treeItem.createDiv('tree-item-self');
		treeItemSelf.addClass('is-clickable');

		if (node.children.length > 0) {
			treeItemSelf.addClass('mod-collapsible');
			treeItemSelf.addClass('mod-folder');
		}
		else {
			treeItemSelf.addClass('mod-file');
		}

		if (node.disabled) {
			treeItemSelf.addClass('is-disabled');
			treeItemSelf.style.opacity = '0.5';
			treeItemSelf.style.pointerEvents = 'none';
		}

		// Collapse/Expand arrow
		if (node.children.length > 0) {
			const collapseIcon = treeItemSelf.createDiv('tree-item-icon collapse-icon');
			setIcon(collapseIcon, 'right-triangle');

			if (node.collapsed) {
				collapseIcon.addClass('is-collapsed');
				treeItem.addClass('is-collapsed');
			}

			if (node.disabled) {
				collapseIcon.style.pointerEvents = 'auto';
			}

			const treeItemRef = treeItem;
			let childrenContainer: HTMLElement;
			let iconContainer: HTMLElement;

			collapseIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				node.collapsed = !node.collapsed;

				if (!childrenContainer) {
					childrenContainer = treeItemRef.querySelector('.tree-item-children') as HTMLElement;
				}
				if (!iconContainer) {
					iconContainer = treeItemRef.querySelector('.file-tree-item-icon') as HTMLElement;
				}

				if (node.collapsed) {
					collapseIcon.addClass('is-collapsed');
					treeItemRef.addClass('is-collapsed');
					if (childrenContainer) childrenContainer.style.display = 'none';
					if (iconContainer) {
						iconContainer.empty();
						setIcon(iconContainer, 'folder');
					}
				}
				else {
					collapseIcon.removeClass('is-collapsed');
					treeItemRef.removeClass('is-collapsed');
					if (childrenContainer) childrenContainer.style.display = '';
					if (iconContainer) {
						iconContainer.empty();
						setIcon(iconContainer, 'folder-open');
					}
				}
			});
		}

		// Inner content
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
				this.renderTree();
			});
		}

		// Icon
		const iconContainer = treeItemInner.createDiv('file-tree-item-icon');
		if (node.type === 'base') {
			setIcon(iconContainer, 'database');
		}
		else if (node.type === 'table') {
			setIcon(iconContainer, 'folder');
		}

		// Title
		const titleEl = treeItemInner.createDiv('file-tree-item-title');
		titleEl.setText(node.title);

		// Children container
		const childrenContainer = treeItem.createDiv('tree-item-children');

		if (node.collapsed) {
			childrenContainer.style.display = 'none';
		}

		if (node.children.length > 0) {
			for (const child of node.children) {
				this.renderTreeNode(childrenContainer, child, level + 1);
			}
		}
	}

	/**
	 * Toggle node selection
	 */
	private toggleNodeSelection(node: AirtableTreeNode, selected: boolean): void {
		node.selected = selected;

		if (selected) {
			this.selectAllChildren(node, true);
		}
		else {
			this.enableAllChildren(node);
		}
	}

	/**
	 * Select all children recursively
	 */
	private selectAllChildren(node: AirtableTreeNode, selected: boolean): void {
		for (const child of node.children) {
			child.selected = selected;
			child.disabled = selected;
			this.selectAllChildren(child, selected);
		}
	}

	/**
	 * Enable all children recursively
	 */
	private enableAllChildren(node: AirtableTreeNode): void {
		for (const child of node.children) {
			child.disabled = false;
			child.selected = false;
			this.enableAllChildren(child);
		}
	}

	/**
	 * Check if all nodes are selected
	 */
	private areAllNodesSelected(): boolean {
		const checkNode = (nodes: AirtableTreeNode[]): boolean => {
			for (const node of nodes) {
				if (!node.selected) {
					return false;
				}
				if (!checkNode(node.children)) {
					return false;
				}
			}
			return true;
		};

		return checkNode(this.tree);
	}

	/**
	 * Select or deselect all nodes
	 */
	private selectAllNodes(selected: boolean): void {
		const processNode = (node: AirtableTreeNode) => {
			if (!node.disabled) {
				node.selected = selected;
				if (selected) {
					this.selectAllChildren(node, true);
				}
				else {
					this.enableAllChildren(node);
				}
			}
			for (const child of node.children) {
				processNode(child);
			}
		};

		for (const node of this.tree) {
			processNode(node);
		}
	}

	/**
	 * Handle toggle select button click
	 */
	private handleToggleSelectClick(): void {
		if (this.tree.length === 0) {
			new Notice('Please load bases first.');
			return;
		}

		const allSelected = this.areAllNodesSelected();

		if (allSelected) {
			this.selectAllNodes(false);
		}
		else {
			this.selectAllNodes(true);
		}

		this.renderTree();
	}

	/**
	 * Update toggle button text
	 */
	private updateToggleButtonText(): void {
		if (!this.toggleSelectButton) {
			return;
		}
		const allSelected = this.areAllNodesSelected();
		this.toggleSelectButton.setButtonText(allSelected ? 'Deselect all' : 'Select all');
	}

	/**
	 * Get selected nodes for import
	 */
	private getSelectedNodes(): AirtableTreeNode[] {
		const selected: AirtableTreeNode[] = [];

		const collectNodes = (nodes: AirtableTreeNode[]) => {
			for (const node of nodes) {
				if (node.selected && !node.disabled) {
					selected.push(node);
				}
				collectNodes(node.children);
			}
		};

		collectNodes(this.tree);
		return selected;
	}

	/**
	 * Show template configuration UI before import (similar to CSV importer)
	 */
	async showTemplateConfiguration(ctx: ImportContext, container: HTMLElement): Promise<boolean> {
		const selectedNodes = this.getSelectedNodes();
		if (selectedNodes.length === 0) {
			new Notice('Please select at least one table to import.');
			return false;
		}

		// Collect all unique fields from selected tables
		const allFieldsMap = new Map<string, any>();
		const fieldExamples = new Map<string, string>();
		
		const collectFields = (nodes: AirtableTreeNode[]) => {
			for (const node of nodes) {
				// Collect fields from this node
				if (node.metadata?.fields) {
					for (const field of node.metadata.fields) {
						if (!allFieldsMap.has(field.name)) {
							allFieldsMap.set(field.name, field);
							fieldExamples.set(field.name, this.generateExampleValue(field));
						}
					}
				}
				
				// Recursively collect from children
				if (node.children && node.children.length > 0) {
					collectFields(node.children);
				}
			}
		};
		
		collectFields(selectedNodes);

		if (allFieldsMap.size === 0) {
			new Notice('No fields found in selected tables. Please check your selection.');
			return false;
		}

		// Prepare template fields
		const fields: TemplateField[] = Array.from(allFieldsMap.values()).map(field => ({
			id: field.name,
			label: field.name,
			exampleValue: fieldExamples.get(field.name) || '',
		}));

		// Set up defaults - all fields go to properties by default
		// Exclude fields that have the same name as viewPropertyName to avoid conflicts
		const propertyNames = new Map<string, string>();
		const propertyValues = new Map<string, string>();
		
		for (const field of allFieldsMap.values()) {
			const sanitizedName = this.sanitizePropertyName(field.name);
			
			// Skip if the sanitized name conflicts with viewPropertyName
			// The viewPropertyName is managed automatically by the importer
			if (sanitizedName.toLowerCase() === this.viewPropertyName.toLowerCase()) {
				continue;
			}
			
			propertyNames.set(field.name, sanitizedName);
			propertyValues.set(field.name, `{{${field.name}}}`);
		}

		// Note content is empty by default - let user decide what to put there
		const bodyTemplate = '';

		// Get primary field for title (usually the first field)
		const firstField = Array.from(allFieldsMap.keys())[0] || 'Name';
		const titleTemplate = `{{${firstField}}}`;

		// Create and show configurator
		const configurator = new TemplateConfigurator({
			fields,
			defaults: {
				titleTemplate,
				locationTemplate: '',
				bodyTemplate,
				propertyNames,
				propertyValues,
			},
			placeholderSyntax: '{{field_name}}',
			showLocationTemplate: false, // Hide location template for Airtable (records go to table folders)
		});

		this.templateConfig = await configurator.show(container);

		// Return false if user cancelled
		return this.templateConfig !== null;
	}

	/**
	 * Generate example value for a field based on its type
	 */
	private generateExampleValue(field: any): string {
		switch (field.type) {
			case 'aiText':
				return 'AI-generated summary...';
			case 'singleLineText':
				return 'Sample text';
			case 'multilineText':
			case 'richText':
				return 'Long text content...';
			case 'number':
				return '123';
			case 'currency':
				return '$99.99';
			case 'percent':
				return '75%';
			case 'singleSelect':
				return field.options?.choices?.[0]?.name || 'Option 1';
			case 'multipleSelects':
				return field.options?.choices?.slice(0, 2).map((c: any) => c.name).join(', ') || 'Option 1, Option 2';
			case 'date':
				return '2025-01-15';
			case 'dateTime':
				return '2025-01-15 14:30';
			case 'checkbox':
				return 'true';
			case 'email':
				return 'user@example.com';
			case 'url':
				return 'https://example.com';
			case 'phoneNumber':
				return '+1 555-0123';
			case 'multipleRecordLinks':
				return 'Related Record 1, Related Record 2';
			case 'multipleAttachments':
				return 'file1.pdf, image.png';
			case 'singleCollaborator':
			case 'createdBy':
			case 'lastModifiedBy':
				return 'John Doe';
			case 'multipleCollaborators':
				return 'John Doe, Jane Smith';
			case 'formula':
			case 'rollup':
			case 'lookup':
				return 'Computed value';
			case 'count':
				return '5';
			case 'autoNumber':
			case 'rating':
				return '3';
			case 'duration':
				return '2:30:00';
			case 'barcode':
				return '1234567890';
			default:
				return 'Value';
		}
	}

	private sanitizePropertyName(name: string): string {
		// Remove special characters, keep alphanumeric, spaces, hyphens, underscores
		return name.replace(/[^\w\s-]/g, '').trim();
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.airtableToken) {
			new Notice('Please enter your Airtable Personal Access Token.');
			return;
		}

		const selectedNodes = this.getSelectedNodes();
		if (selectedNodes.length === 0) {
			new Notice('Please select at least one table to import.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		ctx.status('Connecting to Airtable API...');

		try {
			this.outputRootPath = folder.path;
			this.processedTables.clear();
			this.linkedRecordPlaceholders = [];
			this.recordIdToPath.clear();
			this.recordToViews.clear();
			this.tableViews.clear();
			this.allFieldsForTypeInference.clear();
			this.preparedData.clear();
			this.processedRecordsCount = 0;
			this.totalRecordsToImport = 0;
			this.attachmentsDownloaded = 0;

			// ============================================================
			// PHASE 1: Fetch all data from Airtable (Network requests)
			// ============================================================
			ctx.status('Phase 1: Fetching data from Airtable...');
		
			try {
				await this.fetchAllDataPhase(ctx, selectedNodes);
			}
			catch (error) {
				console.error('Failed to fetch data from Airtable:', error);
				ctx.reportFailed('Data fetching', error);
				new Notice(`Failed to fetch data: ${error.message}`);
				return;
			}
		
			if (ctx.isCancelled()) {
				ctx.status('Import cancelled.');
				return;
			}

			// ============================================================
			// PHASE 2: Create files locally (File system operations)
			// ============================================================
			ctx.status('Phase 2: Creating files...');
		
			try {
				await this.createFilesPhase(ctx, folder.path);
			}
			catch (error) {
				console.error('Failed to create files:', error);
				ctx.reportFailed('File creation', error);
				new Notice(`Failed to create files: ${error.message}`);
				return;
			}

			// Update property types in Obsidian's types.json
			ctx.status('Updating property types...');
			this.updatePropertyTypes();

			// Clean up airtable-id only for full import (not incremental)
			if (!this.incrementalImport) {
				ctx.status('Cleaning up airtable-id attributes...');
				await this.cleanupAirtableIds(ctx);
			}

			ctx.status('Import completed successfully!');
		}
		catch (error) {
			console.error('Airtable API import error:', error);
			ctx.reportFailed('Airtable API import', error);
			new Notice(`Import failed: ${error.message}`);
		}
	}

	/**
	 * PHASE 1: Fetch all data from Airtable
	 * Fetches all bases, tables, records, and view memberships
	 */
	private async fetchAllDataPhase(ctx: ImportContext, selectedNodes: AirtableTreeNode[]): Promise<void> {
		// Collect all tables to process
		const tablesToProcess: Array<{
			baseId: string;
			baseName: string;
			tableName: string;
			fields: any[];
			views: any[];
		}> = [];
		
		// Flatten selected nodes to table level
		for (const node of selectedNodes) {
			if (ctx.isCancelled()) return;
			
			if (node.type === 'base') {
				// Expand base to all its tables
				for (const tableNode of node.children) {
					tablesToProcess.push({
						baseId: node.id,
						baseName: node.title,
						tableName: tableNode.metadata?.tableName || tableNode.title,
						fields: tableNode.metadata?.fields || [],
						views: tableNode.metadata?.views || [],
					});
				}
			}
			else if (node.type === 'table') {
				// Single table
				tablesToProcess.push({
					baseId: node.metadata?.baseId || '',
					baseName: '', // Will be filled from parent if needed
					tableName: node.metadata?.tableName || node.title,
					fields: node.metadata?.fields || [],
					views: node.metadata?.views || [],
				});
			}
		}
		
		// Reset total count
		this.totalRecordsToImport = 0;
		
		// Fetch data for each table
		for (const table of tablesToProcess) {
			if (ctx.isCancelled()) return;
			
			await this.fetchTableData(ctx, table);
		}
		
		// Report total
		ctx.status(`Data fetching complete. Total records: ${this.totalRecordsToImport}`);
		ctx.reportProgress(0, this.totalRecordsToImport);
	}
	
	/**
	 * Fetch all data for a single table (records + view memberships)
	 */
	private async fetchTableData(
		ctx: ImportContext,
		tableInfo: {
			baseId: string;
			baseName: string;
			tableName: string;
			fields: any[];
			views: any[];
		}
	): Promise<void> {
		const { baseId, baseName, tableName, fields, views } = tableInfo;
		
		if (ctx.isCancelled()) return;
		
		const tableKey = `${baseId}:${tableName}`;
		
		// Filter to supported views only
		const supportedViews = views.filter(view => 
			['grid', 'gallery', 'list'].includes(view.type.toLowerCase())
		);
		
		// Collect fields for type inference
		for (const field of fields) {
			if (!this.allFieldsForTypeInference.has(field.name)) {
				this.allFieldsForTypeInference.set(field.name, field);
			}
		}
		
		// Step 1: Fetch ALL records from the table
		ctx.status(`Fetching ${baseName} > ${tableName}...`);
		const allRecords = await fetchAllRecords(baseId, tableName, this.airtableToken, ctx);
		
		if (ctx.isCancelled()) return;
		
		// Step 2: Fetch view memberships for each record
		const recordViewMemberships = new Map<string, string[]>();
		const sanitizedTableName = sanitizeFileName(tableName);
		
		for (const view of supportedViews) {
			if (ctx.isCancelled()) return;
			
			ctx.status(`Fetching ${baseName} > ${tableName} > ${view.name} (${recordViewMemberships.size} records tagged)...`);
			
			// Fetch only record IDs from this view
			const viewRecordIds = await this.fetchViewRecordIds(baseId, tableName, view.id, ctx);
			
			// Build view reference
			const viewReference = `[[${sanitizedTableName}.base#${view.name}]]`;
			
			// Tag these records with this view
			for (const recordId of viewRecordIds) {
				if (!recordViewMemberships.has(recordId)) {
					recordViewMemberships.set(recordId, []);
				}
				recordViewMemberships.get(recordId)!.push(viewReference);
			}
		}
		
		// Store prepared data
		this.preparedData.set(tableKey, {
			baseId,
			baseName,
			tableName,
			tablePath: '', // Will be set in phase 2
			fields,
			views: supportedViews,
			records: allRecords,
			recordViewMemberships,
		});
		
		// Count total records to import
		this.totalRecordsToImport += allRecords.length;
	}
	
	/**
	 * PHASE 2: Create files locally
	 * Creates .base files and record files from prepared data
	 */
	private async createFilesPhase(ctx: ImportContext, rootPath: string): Promise<void> {
		// Process each table's prepared data
		for (const [, tableData] of this.preparedData.entries()) {
			if (ctx.isCancelled()) return;
			
			await this.createFilesForTable(ctx, tableData, rootPath);
		}
	}
	
	/**
	 * Create files for a single table
	 */
	private async createFilesForTable(
		ctx: ImportContext,
		tableData: PreparedTableData,
		rootPath: string
	): Promise<void> {
		const { baseId, baseName, tableName, fields, views, records, recordViewMemberships } = tableData;
		
		// Build table path
		const tablePath = baseName 
			? normalizePath(`${rootPath}/${sanitizeFileName(baseName)}/${sanitizeFileName(tableName)}`)
			: normalizePath(`${rootPath}/${sanitizeFileName(tableName)}`);
		
		await this.createFolders(tablePath);
		
		ctx.status(`Creating files for ${baseName ? baseName + ' > ' : ''}${tableName}...`);
		
		// Create .base file first
		await this.createViewBaseFiles(tablePath, tableName, views, fields);
		
		if (ctx.isCancelled()) return;
		
		// Pre-process linked records: build record ID -> title mapping
		const recordIdToTitle = new Map<string, string>();
		for (const record of records) {
			const recordFields = record.fields || {};
			const primaryFieldValue = recordFields[fields[0]?.name];
			const title = primaryFieldValue ? String(primaryFieldValue) : `Record ${record.id.substring(0, 8)}`;
			recordIdToTitle.set(record.id, title);
		}
		
		// Create files for all records
		for (const record of records) {
			if (ctx.isCancelled()) return;
			
			try {
				const viewReferences = recordViewMemberships.get(record.id) || [];
				await this.createRecordFile(ctx, record, baseId, tableName, tablePath, fields, viewReferences, recordIdToTitle);
			}
			catch (error) {
				const recordTitle = record.fields?.[fields[0]?.name] || `Record ${record.id.substring(0, 8)}`;
				ctx.reportFailed(recordTitle, error);
				this.processedRecordsCount++;
				ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
			}
		}
		
		// Store table info
		const tableKey = `${baseId}:${tableName}`;
		this.processedTables.set(tableKey, {
			id: tableName,
			baseId,
			name: tableName,
			folderPath: tablePath,
			baseFilePath: `${tablePath}.base`,
			fields,
			primaryFieldId: fields[0]?.id || '',
		});
	}

	/**
	 * Fetch only record IDs from a view (without full field data)
	 * This is more efficient when we only need to know which records belong to a view
	 */
	private async fetchViewRecordIds(
		baseId: string,
		tableName: string,
		viewId: string,
		ctx: ImportContext
	): Promise<string[]> {
		const Airtable = (await import('airtable')).default;
		const base = new Airtable({ apiKey: this.airtableToken }).base(baseId);
		const recordIds: string[] = [];
		
		try {
			// Only fetch the ID field (minimal data transfer)
			await base(tableName)
				.select({
					view: viewId,
					fields: [], // Request no fields, only IDs
				})
				.eachPage((pageRecords: any[], fetchNextPage: () => void) => {
					// Extract only the IDs
					recordIds.push(...pageRecords.map(r => r.id));
					fetchNextPage();
				});
		}
		catch (error) {
			console.error(`Failed to fetch view record IDs for view ${viewId}:`, error);
			throw error;
		}
		
		return recordIds;
	}

	/**
	 * Update an existing record's view property
	 * viewReference format: [[TableName.base#ViewName]]
	 */
	private async updateRecordViewProperty(filePath: string, viewReference: string, ctx: ImportContext): Promise<void> {
		const fullPath = `${filePath}.md`;
		const file = this.vault.getAbstractFileByPath(normalizePath(fullPath));
		
		if (!file || !(file instanceof TFile)) {
			console.warn(`Could not find file to update: ${fullPath}`);
			return;
		}

		try {
			let content = await this.vault.read(file);
			
			// Parse frontmatter
			const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
			const match = content.match(frontmatterRegex);
			
			if (!match) {
				console.warn(`No frontmatter found in file: ${fullPath}`);
				return;
			}

			// Check if view property exists (support both single-line and multi-line YAML formats)
			// Single-line: base: ["value1", "value2"]
			// Multi-line: base:\n  - "value1"\n  - "value2"
			// Note: Use greedy match for array content to handle wiki links with ]]
			const singleLinePattern = new RegExp(`^${this.viewPropertyName}:\\s*\\[([\\s\\S]*)\\]`, 'm');
			const multiLinePattern = new RegExp(`^${this.viewPropertyName}:\\s*$\\n((?:^\\s+-\\s+[^\\n]+$\\n?)+)`, 'm');
			
			const singleLineMatch = content.match(singleLinePattern);
			const multiLineMatch = content.match(multiLinePattern);
			
			if (singleLineMatch || multiLineMatch) {
				// Property exists, extract existing references
				let existingRefs: string[] = [];
				
				if (singleLineMatch) {
					// Single-line format
					existingRefs = singleLineMatch[1]
						.split(',')
						.map(v => v.trim().replace(/^["']|["']$/g, ''))
						.filter(v => v.length > 0);
				}
				else if (multiLineMatch) {
					// Multi-line format
					existingRefs = multiLineMatch[1]
						.split('\n')
						.map(line => line.trim().replace(/^-\s+["']?|["']?$/g, ''))
						.filter(v => v.length > 0);
				}
				
				// Check if view reference already exists
				if (!existingRefs.includes(viewReference)) {
					// Add new view reference to the list
					const updatedRefs = [...existingRefs, viewReference];
					const newValue = `[${updatedRefs.map(v => `"${v}"`).join(', ')}]`;
					
					// Replace both single-line and multi-line formats with single-line format
					if (singleLineMatch) {
						content = content.replace(
							singleLinePattern,
							`${this.viewPropertyName}: ${newValue}`
						);
					}
					else if (multiLineMatch) {
						content = content.replace(
							multiLinePattern,
							`${this.viewPropertyName}: ${newValue}\n`
						);
					}
					
					await this.vault.modify(file, content);
				}
			}
			else {
				// Property doesn't exist, add it after airtable-id or airtable-created
				const newProperty = `${this.viewPropertyName}: ["${viewReference}"]`;
				
				// Try to insert after airtable-id first
				if (content.match(/^airtable-id:/m)) {
					content = content.replace(
						/^(airtable-id:.*\n)/m,
						`$1${newProperty}\n`
					);
				}
				// Otherwise try after airtable-created
				else if (content.match(/^airtable-created:/m)) {
					content = content.replace(
						/^(airtable-created:.*\n)/m,
						`$1${newProperty}\n`
					);
				}
				// Otherwise add at the beginning of frontmatter
				else {
					content = content.replace(
						frontmatterRegex,
						`---\n${newProperty}\n${match[1]}\n---`
					);
				}
				
				await this.vault.modify(file, content);
			}
		}
		catch (error) {
			console.error(`Failed to update view property for ${fullPath}:`, error);
		}
	}

	/**
	 * Create a file for a single record (Phase 2)
	 * Resolves all linked records before writing
	 */
	private async createRecordFile(
		ctx: ImportContext,
		record: AirtableRecord,
		baseId: string,
		tableName: string,
		tablePath: string,
		fields: any[],
		viewReferences: string[],
		recordIdToTitle: Map<string, string>
	): Promise<void> {
		const recordId = record.id;
		const recordFields = record.fields || {};
		
		// Skip completely empty records
		const hasAnyValue = Object.values(recordFields).some(value => {
			if (value === null || value === undefined) return false;
			if (typeof value === 'string' && value.trim() === '') return false;
			if (typeof value === 'object' && !Array.isArray(value)) {
				// For aiText objects, check if they have valid state
				if (value.state && value.state !== 'generated') return false;
				if (value.state === 'generated' && !value.value) return false;
			}
			if (Array.isArray(value) && value.length === 0) return false;
			return true;
		});
		
		if (!hasAnyValue) {
			ctx.reportSkipped(recordId, 'Empty record');
			this.processedRecordsCount++;
			ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
			return;
		}
		
		// Determine title
		const primaryFieldName = fields[0]?.name;
		const primaryFieldValue = recordFields[primaryFieldName];
		let title = primaryFieldValue ? String(primaryFieldValue) : '';
		
		if (!title || title.trim() === '') {
			title = `Record ${recordId.substring(0, 8)}`;
		}
		
		const sanitizedTitle = sanitizeFileName(title);
		const filePath = normalizePath(`${tablePath}/${sanitizedTitle}.md`);
		
		// Check for incremental import
		if (this.incrementalImport) {
			const existingFile = this.vault.getAbstractFileByPath(filePath);
			if (existingFile instanceof TFile) {
				const content = await this.vault.read(existingFile);
				
				// Extract airtable-id from frontmatter
				const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
				if (frontmatterMatch) {
					try {
						const frontmatter = parseYaml(frontmatterMatch[1]);
						const existingId = frontmatter?.['airtable-id'];
						if (existingId === recordId) {
							ctx.reportSkipped(sanitizedTitle, 'Already imported');
							this.processedRecordsCount++;
							ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
							return;
						}
					}
					catch (e) {
						// Failed to parse frontmatter, continue with import
					}
				}
			}
		}
		
		// Build template data for both frontmatter and body
		const templateData: Record<string, string> = {};
		
		// First pass: convert field values for template use
		for (const field of fields) {
			const fieldValue = recordFields[field.name];
			
			if (fieldValue === null || fieldValue === undefined) {
				templateData[field.name] = '';
				continue;
			}

			// Convert to string for template
			if (Array.isArray(fieldValue)) {
				templateData[field.name] = fieldValue.map((item: any) => {
					if (typeof item === 'object' && item.name) return item.name;
					if (typeof item === 'string') return item;
					return String(item);
				}).join(', ');
			}
			else if (typeof fieldValue === 'object') {
				// For objects, try to get name or value
				templateData[field.name] = fieldValue.name || fieldValue.value || String(fieldValue);
			}
			else {
				templateData[field.name] = String(fieldValue);
			}
		}

		// Build frontmatter
		const frontMatter: Record<string, any> = {
			'airtable-id': recordId,
			'airtable-created': record.createdTime,
		};

		// Add view property
		if (viewReferences.length > 0) {
			frontMatter[this.viewPropertyName] = viewReferences;
		}

		// Process fields for frontmatter using template config
		if (this.templateConfig) {
			for (const [fieldId, propertyName] of this.templateConfig.propertyNames) {
				if (!propertyName || !propertyName.trim()) continue;

				// Skip the view property name to avoid duplicates
				if (propertyName === this.viewPropertyName) {
					continue;
				}

				const valueTemplate = this.templateConfig.propertyValues.get(fieldId) || '';
				if (!valueTemplate) continue;

				// Find the field schema
				const field = fields.find((f: any) => f.name === fieldId);
				if (!field) continue;

				const fieldValue = recordFields[field.name];

				// Skip null/undefined
				if (fieldValue === null || fieldValue === undefined) {
					continue;
				}

				// Convert field value with direct linked record resolution
				let convertedValue = convertFieldValue(
					fieldValue,
					field,
					recordId,
					this.formulaStrategy,
					this.linkedRecordPlaceholders, // Not used in phase 2, but needed for signature
					ctx
				);

				// Resolve linked records IMMEDIATELY from recordIdToTitle
				if (field.type === 'multipleRecordLinks' && Array.isArray(fieldValue)) {
					convertedValue = fieldValue.map((linkedRecordId: string) => {
						const linkedTitle = recordIdToTitle.get(linkedRecordId);
						if (linkedTitle) {
							return `[[${sanitizeFileName(linkedTitle)}]]`;
						}
						return `[Unknown Record ${linkedRecordId.substring(0, 8)}]`;
					});
				}

				// Convert property value according to type
				let propertyValue: any = convertedValue;

				// Handle attachments: process to ensure external links are plain URLs
				if (field.type === 'multipleAttachments' && Array.isArray(convertedValue)) {
					propertyValue = convertedValue; // Already handled by convertFieldValue
				}

				// Set property
				frontMatter[propertyName] = propertyValue;
			}
		}

		// Apply body template
		const bodyContent = this.templateConfig
			? applyTemplate(this.templateConfig.bodyTemplate, templateData)
			: '';

		// Generate file content
		const fileContent = `${serializeFrontMatter(frontMatter)}${bodyContent}`.trim();

		// Write or update file
		const existingFile = this.vault.getAbstractFileByPath(filePath);
		if (existingFile instanceof TFile) {
			await this.vault.modify(existingFile, fileContent);
		}
		else {
			await this.vault.create(filePath, fileContent);
		}
		
		// Track record path (without .md extension)
		this.recordIdToPath.set(recordId, filePath.replace(/\.md$/, ''));
		
		ctx.reportNoteSuccess(sanitizedTitle);
		this.processedRecordsCount++;
		ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
	}

	/**
	 * Import a single record as a note
	 */
	private async importRecord(
		ctx: ImportContext,
		record: any,
		baseId: string,
		tableName: string,
		parentPath: string,
		fields: any[],
		viewNames: string[] = []
	): Promise<void> {
		const recordId = record.id;
		const recordFields = record.fields || {};

		// Check if record is completely empty (no field values at all)
		// Skip only if all fields are null/undefined/empty
		const hasAnyValue = Object.keys(recordFields).some(fieldName => {
			const value = recordFields[fieldName];
			if (value === null || value === undefined) return false;
			
			// For objects (like aiText error states), check if they have actual data
			if (typeof value === 'object') {
				// Arrays: check if not empty
				if (Array.isArray(value)) return value.length > 0;
				// Objects with error state: consider empty
				if (value.state === 'error' || value.state === 'empty') return false;
				// Other objects: check if not empty
				return Object.keys(value).length > 0;
			}
			
			// For strings: check if not empty after trimming
			if (typeof value === 'string') return value.trim().length > 0;
			
			// All other types: consider as having value
			return true;
		});

		// Skip only if record has no field values at all
		if (!hasAnyValue) {
			ctx.reportSkipped(`Record ${recordId.substring(0, 8)}`, 'Empty record (no field values)');
			this.processedRecordsCount++;
			ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
			return;
		}

		// Convert all fields to string values for template processing
		const templateData: Record<string, string> = {};
		
		// First pass: convert field values for template use
		for (const field of fields) {
			const fieldValue = recordFields[field.name];
			
			if (fieldValue === null || fieldValue === undefined) {
				templateData[field.name] = '';
				continue;
			}

			// Convert to string for template
			if (Array.isArray(fieldValue)) {
				// For arrays, join with commas
				templateData[field.name] = fieldValue.map(v => {
					if (typeof v === 'object' && v.name) return v.name;
					if (typeof v === 'object' && v.id) return v.id;
					return String(v);
				}).join(', ');
			}
			else if (typeof fieldValue === 'object') {
				// For objects, try to get name or value
				templateData[field.name] = fieldValue.name || fieldValue.value || String(fieldValue);
			}
			else {
				templateData[field.name] = String(fieldValue);
			}
		}

		// Apply title template
		const recordTitle = this.templateConfig
			? applyTemplate(this.templateConfig.titleTemplate, templateData)
			: (templateData[fields[0]?.name] || `Record ${recordId.substring(0, 8)}`);

		// Use fallback title if empty (don't skip, since record has some field values)
		const sanitizedTitle = sanitizeFileName(recordTitle) || `Record ${recordId.substring(0, 8)}`;

		ctx.status(`Importing: ${sanitizedTitle}`);

		// Apply location template
		const locationPath = this.templateConfig
			? applyTemplate(this.templateConfig.locationTemplate, templateData)
			: '';
		
		const targetFolder = locationPath
			? await this.getTargetFolder(parentPath, locationPath)
			: parentPath;

		// Build frontmatter
		const frontMatter: Record<string, any> = {
			'airtable-id': recordId,
			'airtable-created': record.createdTime,
		};

		// Add view property if views are specified
		if (viewNames.length > 0) {
			frontMatter[this.viewPropertyName] = viewNames;
		}

		// Process fields for frontmatter using template config
		if (this.templateConfig) {
			for (const [fieldId, propertyName] of this.templateConfig.propertyNames) {
				if (!propertyName || !propertyName.trim()) continue;

				// Skip the view property name to avoid duplicates
				// The view property is managed separately by the importer
				if (propertyName === this.viewPropertyName) {
					continue;
				}

				const valueTemplate = this.templateConfig.propertyValues.get(fieldId) || '';
				if (!valueTemplate) continue;

				// Find the field schema
				const field = fields.find(f => f.name === fieldId);
				if (!field) continue;

				const fieldValue = recordFields[field.name];
				if (fieldValue === null || fieldValue === undefined) continue;

				// Convert field value properly
				const converted = convertFieldValue(
					fieldValue,
					field,
					recordId,
					this.formulaStrategy,
					this.linkedRecordPlaceholders,
					ctx
				);

				if (converted === null || converted === undefined) continue;

				// Handle attachments
				if (field.type === 'multipleAttachments' && Array.isArray(converted)) {
					const attachments = converted as AirtableAttachment[];
					const links = await processAttachmentsForYAML(attachments, {
						ctx,
						currentFolderPath: targetFolder,
						currentFilePath: `${targetFolder}/${sanitizedTitle}.md`,
						vault: this.vault,
						app: this.app,
						downloadAttachments: this.downloadAttachments,
						getAvailableAttachmentPath: async (filename: string) => {
							return await this.getAvailablePathForAttachment(filename, []);
						},
						onAttachmentDownloaded: () => {
							this.attachmentsDownloaded++;
							ctx.attachments = this.attachmentsDownloaded;
							ctx.attachmentCountEl.setText(this.attachmentsDownloaded.toString());
						},
					});

					if (links.length > 0) {
						frontMatter[propertyName] = links;
					}
				}
				else {
					// For URL fields in YAML, use plain URL
					if (field.type === 'url' && typeof converted === 'string') {
						frontMatter[propertyName] = converted;
					}
					else {
						frontMatter[propertyName] = converted;
					}
				}
			}
		}

		// Apply body template
		const bodyContent = this.templateConfig
			? applyTemplate(this.templateConfig.bodyTemplate, templateData)
			: '';

		// Check for incremental import before creating file
		const filePathToCreate = normalizePath(`${targetFolder}/${sanitizedTitle}.md`);
		const shouldSkip = await this.shouldSkipExistingFile(filePathToCreate, recordId, ctx);
		
		if (shouldSkip) {
			// File already exists with same airtable-id, skip creation
			// But still track the path for linked record resolution
			const pathWithoutExt = filePathToCreate.replace(/\.md$/, '');
			this.recordIdToPath.set(recordId, pathWithoutExt);
			
			this.processedRecordsCount++;
			ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
			return;
		}

		// Create markdown file
		const fullContent = serializeFrontMatter(frontMatter) + (bodyContent ? '\n\n' + bodyContent : '');

		try {
			await this.vault.create(filePathToCreate, fullContent);
		}
		catch (error) {
			// File might already exist with different airtable-id, get unique path
			const uniquePath = await this.getUniqueFilePath(targetFolder, `${sanitizedTitle}.md`);
			await this.vault.create(uniquePath, fullContent);
		}

		// Track record path
		const pathWithoutExt = filePathToCreate.replace(/\.md$/, '');
		this.recordIdToPath.set(recordId, pathWithoutExt);

		ctx.reportNoteSuccess(sanitizedTitle);
		this.processedRecordsCount++;
		ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
	}

	/**
	 * Check if a file should be skipped during import (incremental import)
	 */
	private async shouldSkipExistingFile(
		filePath: string,
		airtableId: string,
		ctx: ImportContext
	): Promise<boolean> {
		// Check if file exists
		const file = this.vault.getAbstractFileByPath(normalizePath(filePath));
		if (!file || !(file instanceof TFile)) {
			return false; // File doesn't exist, don't skip
		}

		// Read file and extract airtable-id from frontmatter
		try {
			const content = await this.vault.read(file);
			const airtableIdMatch = content.match(/^airtable-id:\s*(.+)$/m);
			
			if (airtableIdMatch) {
				const existingAirtableId = airtableIdMatch[1].trim();
				if (existingAirtableId === airtableId) {
					// Same airtable-id, skip this file
					const fileName = file.basename;
					ctx.reportSkipped(fileName, 'already exists with same airtable-id');
					return true;
				}
			}
			// Different airtable-id or no airtable-id, don't skip (will rename with unique path)
			return false;
		}
		catch (error) {
			console.error(`Failed to read file ${filePath} for duplicate check:`, error);
			return false; // On error, don't skip
		}
	}

	/**
	 * Get unique file path (append " 1", " 2", etc. if file exists)
	 */
	private async getUniqueFilePath(parentPath: string, fileName: string): Promise<string> {
		let counter = 1;
		let baseName = fileName.replace(/\.md$/, '');
		let testPath = normalizePath(`${parentPath}/${fileName}`);
		
		while (this.vault.getAbstractFileByPath(testPath)) {
			testPath = normalizePath(`${parentPath}/${baseName} ${counter}.md`);
			counter++;
		}
		
		return testPath;
	}

	/**
	 * Clean up airtable-id from all imported files' frontmatter
	 * This is called ONLY at the end of FULL import (not incremental import)
	 */
	private async cleanupAirtableIds(ctx: ImportContext): Promise<void> {
		if (this.recordIdToPath.size === 0) {
			return;
		}

		let cleanedCount = 0;
		let failedCount = 0;

		// Iterate through all records we've tracked
		for (const filePath of this.recordIdToPath.values()) {
			if (ctx.isCancelled()) break;

			try {
				const file = this.vault.getAbstractFileByPath(filePath + '.md');
				if (!file || !(file instanceof TFile)) {
					continue;
				}

				// Read file content
				const content = await this.vault.read(file);

				// Check if file has frontmatter with airtable-id
				const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
				const match = content.match(frontmatterRegex);

				if (!match) {
					continue; // No frontmatter, skip
				}

				const frontmatter = match[1];
				const airtableIdRegex = /^airtable-id:\s*.+$/m;

				if (!airtableIdRegex.test(frontmatter)) {
					continue; // No airtable-id in frontmatter, skip
				}

				// Remove the airtable-id line from frontmatter
				const newFrontmatter = frontmatter
					.split('\n')
					.filter(line => !line.match(/^airtable-id:\s*.+$/))
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
				console.error(`Failed to clean airtable-id from file: ${filePath}`, error);
				failedCount++;
			}
		}

		if (cleanedCount > 0) {
			console.log(`✓ Cleaned airtable-id from ${cleanedCount} file(s)`);
		}
		if (failedCount > 0) {
			console.warn(`⚠️ Failed to clean airtable-id from ${failedCount} file(s)`);
		}
	}

	/**
	 * Get target folder for a record based on location template
	 */
	private async getTargetFolder(baseFolder: string, locationPath: string): Promise<string> {
		if (!locationPath || !locationPath.trim()) {
			return baseFolder;
		}

		const sanitizedPath = this.sanitizeFilePath(locationPath);
		const fullPath = normalizePath(`${baseFolder}/${sanitizedPath}`);

		await this.createFolders(fullPath);
		return fullPath;
	}

	/**
	 * Create a single .base file for the table with multiple views
	 */
	private async createViewBaseFiles(
		tableFolderPath: string,
		tableName: string,
		views: Array<{name: string, type: string, id: string}>,
		fields: any[]
	): Promise<void> {
		// Get parent folder (where .base file will be created)
		const parentPath = tableFolderPath.split('/').slice(0, -1).join('/');
		
		// Build property columns
		const propertyColumns: string[] = ['file.name'];
		for (const field of fields) {
			const propertyName = this.sanitizePropertyName(field.name);
			propertyColumns.push(propertyName);
		}

		// Create ONE .base file for the table with multiple views
		const sanitizedTableName = sanitizeFileName(tableName);
		const baseFileName = `${sanitizedTableName}.base`;
		const baseFilePath = parentPath ? `${parentPath}/${baseFileName}` : baseFileName;

		// Build views array
		const obsidianViews: any[] = [];
		
		for (const view of views) {
			// Map Airtable view type to Obsidian view type
			let obsidianViewType = 'table';
			switch (view.type.toLowerCase()) {
				case 'grid':
					obsidianViewType = 'table';
					break;
				case 'gallery':
					obsidianViewType = 'cards';
					break;
				case 'list':
					obsidianViewType = 'list';
					break;
			}

			// Build view reference for filter: [[TableName.base#ViewName]]
			const viewReference = `[[${sanitizedTableName}.base#${view.name}]]`;

			// Add view with filter based on base property containing the view reference
			// Correct Obsidian Bases filter syntax: note["propertyName"].contains("value")
			obsidianViews.push({
				type: obsidianViewType,
				name: view.name,
				filters: `note["${this.viewPropertyName}"].contains("${viewReference}")`,
				order: propertyColumns,
			});
		}

		// Build base config
		const baseConfig: any = {
			// Base filter: only files in this table's folder
			filters: `file.folder == "${tableFolderPath}"`,
			views: obsidianViews,
		};

		// Create or update the .base file
		try {
			const content = stringifyYaml(baseConfig);
			const normalizedPath = normalizePath(baseFilePath);
			
			// Check if file already exists
			const existingFile = this.vault.getAbstractFileByPath(normalizedPath);
			
			if (existingFile && existingFile instanceof TFile) {
				// File exists - update it by merging views
				const existingContent = await this.vault.read(existingFile);
				
				// Parse existing YAML to extract existing views
				try {
					const existingConfig = parseYaml(existingContent) as any;
					const existingViews = existingConfig.views || [];
					
					// Merge new views with existing ones (avoid duplicates by view name)
					const viewMap = new Map();
					for (const view of existingViews) {
						viewMap.set(view.name, view);
					}
					for (const view of obsidianViews) {
						viewMap.set(view.name, view); // Override if exists
					}
					
					// Update config with merged views
					baseConfig.views = Array.from(viewMap.values());
					
					// Write updated content
					const updatedContent = stringifyYaml(baseConfig);
					await this.vault.modify(existingFile, updatedContent);
				}
				catch (parseError) {
					// If parsing fails, just overwrite
					await this.vault.modify(existingFile, content);
				}
			}
			else {
				// File doesn't exist - create it
				await this.vault.create(normalizedPath, content);
			}
		}
		catch (error) {
			console.error(`Failed to create/update base file for table "${tableName}":`, error);
			// Don't fail the entire import
		}
	}

	/**
	 * Update Obsidian property types based on Airtable field types
	 * This writes to .obsidian/types.json using the metadataTypeManager API
	 */
	private updatePropertyTypes(): void {
		if (!this.templateConfig || this.allFieldsForTypeInference.size === 0) {
			return;
		}

		const propertyTypes: Record<string, string> = {};

		// Map Airtable field types to Obsidian property types
		for (const field of this.allFieldsForTypeInference.values()) {
			// Get the property name used in template config
			const propertyName = this.templateConfig.propertyNames.get(field.name);
			if (!propertyName || propertyName === this.viewPropertyName) {
				continue; // Skip if not in template or conflicts with view property
			}

			// Map Airtable field type to Obsidian property type
			const obsidianType = this.mapAirtableTypeToObsidian(field.type);
			if (obsidianType) {
				propertyTypes[propertyName] = obsidianType;
			}
		}

		// Update property types using Obsidian's API
		for (const [propName, propType] of Object.entries(propertyTypes)) {
			const existingType = this.app.metadataTypeManager.getAssignedWidget(propName);
			
			if (!existingType) {
				// Property doesn't have a type yet, set it
				this.app.metadataTypeManager.setType(propName, propType);
				console.log(`[Airtable Property Types] Setting type for "${propName}": ${propType}`);
			}
			else {
				// Property already has a type, respect it
				console.log(`[Airtable Property Types] Skipping "${propName}" (already has type: ${existingType})`);
			}
		}
	}

	/**
	 * Map Airtable field type to Obsidian property type
	 */
	private mapAirtableTypeToObsidian(airtableType: string): string | null {
		switch (airtableType) {
			case 'checkbox':
				return 'checkbox';
			
			case 'date':
				return 'date';
			
			case 'dateTime':
				return 'datetime';
			
			case 'number':
			case 'currency':
			case 'percent':
			case 'duration':
			case 'rating':
			case 'autoNumber':
				return 'number';
			
			case 'singleSelect':
			case 'singleLineText':
			case 'multilineText':
			case 'richText':
			case 'email':
			case 'url':
			case 'phoneNumber':
			case 'barcode':
			case 'aiText':
			case 'singleCollaborator':
			case 'createdBy':
			case 'lastModifiedBy':
				return 'text';
			
			case 'multipleSelects':
			case 'multipleCollaborators':
			case 'multipleRecordLinks':
			case 'multipleAttachments':
				return 'multitext';
			
			case 'formula':
			case 'rollup':
			case 'lookup':
			case 'count':
				// These are computed properties, let Obsidian auto-infer type
				return null;
			
			case 'createdTime':
			case 'lastModifiedTime':
				return 'datetime';
			
			default:
				console.log(`[Airtable] Unknown field type: ${airtableType}, treating as text`);
				return 'text';
		}
	}

	/**
	 * Replace linked record placeholders with wiki links
	 */
	private async replaceLinkedRecordPlaceholders(ctx: ImportContext): Promise<void> {
		if (this.linkedRecordPlaceholders.length === 0) {
			return;
		}

		ctx.status(`Replacing ${this.linkedRecordPlaceholders.length} linked record placeholders...`);

		for (const placeholder of this.linkedRecordPlaceholders) {
			if (ctx.isCancelled()) break;

			try {
				const recordPath = this.recordIdToPath.get(placeholder.recordId);
				if (!recordPath) {
					console.warn(`Could not find path for record: ${placeholder.recordId}`);
					continue;
				}

				const file = this.vault.getAbstractFileByPath(recordPath + '.md');
				if (!file || !(file instanceof TFile)) {
					console.warn(`Could not find file: ${recordPath}`);
					continue;
				}

				let content = await this.vault.read(file);
				let modified = false;

				// Replace each linked record ID with a wiki link
				for (const linkedId of placeholder.linkedRecordIds) {
					const linkedPath = this.recordIdToPath.get(linkedId);
					if (linkedPath) {
						const linkedFile = this.vault.getAbstractFileByPath(linkedPath + '.md');
						if (linkedFile instanceof TFile) {
							const displayName = linkedFile.basename;
							const wikiLink = `"[[${linkedPath}|${displayName}]]"`;

							// Replace the ID with the link
							content = content.replace(
								new RegExp(linkedId, 'g'),
								wikiLink
							);
							modified = true;
						}
					}
				}

				if (modified) {
					await this.vault.modify(file, content);
				}
			}
			catch (error) {
				console.error(`Failed to replace placeholder for record ${placeholder.recordId}:`, error);
			}
		}
	}
}

