/**
 * Airtable API Importer
 * Imports tables and records from Airtable using the API
 */

import { Notice, Setting, normalizePath, TFile, setIcon, stringifyYaml, parseYaml, BasesConfigFile, BasesConfigFileView, ButtonComponent } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { parseFilePath } from '../filesystem';
import { sanitizeFileName, serializeFrontMatter, getUniqueFilePath } from '../util';
import {
	TemplateConfigurator,
	TemplateConfig,
	TemplateField,
	applyTemplate,
} from '../template';

// Import helper modules
import Airtable from 'airtable';
import { fetchBases, fetchTableSchema, fetchAllRecords } from './airtable-api/api-helpers';
import { convertFieldValue } from './airtable-api/field-converter';
import { processAttachments, processAttachmentsForYAML } from './airtable-api/attachment-helpers';
import { canConvertFormula, convertAirtableFormulaToObsidian } from './airtable-api/formula-converter';
import type {
	FormulaImportStrategy,
	AirtableTreeNode,
	AirtableViewInfo,
	AirtableFieldSchema,
	AirtableAttachment,
	PreparedTableData,
	AirtableRecord,
	RecordFileContext,
	BaseFileContext,
	BaseGroupInfo,
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
	private loadButton: ButtonComponent | null = null;  // ButtonComponent from obsidian
	private toggleSelectButton: ButtonComponent | null = null;  // ButtonComponent from obsidian
	
	// Tracking data
	private recordIdToPath: Map<string, string> = new Map(); // baseId:recordId -> file path (recordId only unique within base)
	private processedRecordsCount: number = 0;
	private totalRecordsToImport: number = 0;
	private attachmentsDownloaded: number = 0;
	
	// Template configuration
	private templateConfig: TemplateConfig | null = null;
	
	// Store all fields for property type inference
	private allFieldsForTypeInference: Map<string, AirtableFieldSchema> = new Map();
	
	// Global field ID to name mapping (across all tables in the base)
	// Needed for lookup/rollup fields that reference fields in linked tables
	private globalFieldIdToNameMap: Map<string, string> = new Map();
	
	// Global record ID to title mapping (across all tables)
	// Needed for resolving linked records that reference records in other tables
	private globalRecordIdToTitle: Map<string, string> = new Map();
	
	// Prepared data cache for two-phase import
	private preparedData: Map<string, PreparedTableData> = new Map();

	// Status tracking for detailed progress display
	private statusContext: {
		totalBases: number;
		currentBaseIndex: number;
		baseName: string;
		tableName: string;
		viewName: string;
		recordsProgress: string; // e.g., "100/200"
	} = {
			totalBases: 0,
			currentBaseIndex: 0,
			baseName: '',
			tableName: '',
			viewName: '',
			recordsProgress: '',
		};

	/**
	 * Build status message with current context
	 * Format: Base 1/4 → {BaseName} → {Status} [→ {Table}] [→ {View}] [{Records}]
	 */
	private buildStatusMessage(status: 'Fetching' | 'Preparing' | 'Writing', options?: {
		showTable?: boolean;
		showView?: boolean;
		showRecords?: boolean;
		customSuffix?: string;
	}): string {
		const { totalBases, currentBaseIndex, baseName, tableName, viewName, recordsProgress } = this.statusContext;
		const opts = options || {};
		
		// Format: Base 1/4 → BaseName → Status
		let message = `Base ${currentBaseIndex}/${totalBases} → ${baseName} → ${status}`;
		
		if (opts.showTable && tableName) {
			message += ` → ${tableName}`;
		}
		
		if (opts.showView && viewName) {
			message += ` → ${viewName}`;
		}
		
		if (opts.showRecords && recordsProgress) {
			message += ` (${recordsProgress})`;
		}
		
		if (opts.customSuffix) {
			message += ` ${opts.customSuffix}`;
		}
		
		return message;
	}

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

		let toggleButtonRef: ButtonComponent | null = null;  // ButtonComponent from obsidian
		let loadButtonRef: ButtonComponent | null = null;  // ButtonComponent from obsidian

		// Toggle select all/none button
		loadSetting.addButton(button => {
			toggleButtonRef = button;
			button
				.setButtonText('Select all')
				.onClick(() => {
					this.toggleSelectButton = toggleButtonRef;
					if (this.tree.length === 0) {
						new Notice('Please load bases first.');
						return;
					}
			
					const allSelected = this.areAllNodesSelected();
					this.selectAllNodes(!allSelected);
					this.renderTree();
				});

			if (button.buttonEl) {
				button.buttonEl.addClass('airtable-toggle-button');
				button.buttonEl.hide();
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

		// Page tree container (using Publish plugin's style with proper hierarchy)
		// Create the section wrapper
		const importSection = this.modal.contentEl.createDiv();
		importSection.addClass('import-section', 'file-tree', 'publish-section');

		// Create the change list container
		this.treeContainer = importSection.createDiv('publish-change-list');

		// Add placeholder text
		const placeholder = this.treeContainer.createDiv('publish-placeholder');
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
			// Create a minimal status reporter for API calls during tree loading
			const statusReporter = {
				status: (msg: string) => {
					if (this.loadButton) {
						this.loadButton.setButtonText(msg);
					}
				},
			};

			// Fetch all bases
			const bases = await fetchBases(this.airtableToken, statusReporter);

			if (bases.length === 0) {
				new Notice('No bases found. Make sure your token has proper permissions.');
				return;
			}

			// Build tree structure
			const treeNodes: AirtableTreeNode[] = [];

			for (const base of bases) {
				statusReporter.status(`Loading tables for ${base.name}...`);

				// Fetch tables for this base
				const tables = await fetchTableSchema(base.id, this.airtableToken, statusReporter);

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
						selected: false,
						disabled: false,
						metadata: {
							baseId: base.id,
							tableName: table.name,
							primaryFieldId: table.primaryFieldId,
							fields: table.fields,
							views: table.views,
						},
					};
					baseNode.children!.push(tableNode);
				}

				treeNodes.push(baseNode);
			}

			this.tree = treeNodes;
			this.renderTree();

			if (this.toggleSelectButton && this.toggleSelectButton.buttonEl) {
				this.toggleSelectButton.buttonEl.show();
			}

			const tableCount = treeNodes.reduce((sum, base) => sum + (base.children?.length || 0), 0);
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
			this.treeContainer = this.modal.contentEl.querySelector('.publish-change-list') as HTMLElement;
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
	 * Render a single tree node using Obsidian's standard tree structure
	 * Airtable has only two levels: Base (database icon) -> Table (file icon)
	 */
	private renderTreeNode(container: HTMLElement, node: AirtableTreeNode, level: number): void {
		// Main tree item container
		const treeItem = container.createDiv('tree-item');
		
		// Tree item self (contains the node itself)
		const treeItemSelf = treeItem.createDiv('tree-item-self');
		treeItemSelf.addClass('is-clickable');
		
		// Add appropriate modifiers
		const hasChildren = node.children && node.children.length > 0;
		treeItemSelf.addClass(node.type === 'base' ? 'mod-folder' : 'mod-file');
		
		// Apply disabled styling
		if (node.disabled) {
			treeItemSelf.addClass('is-disabled');
			treeItemSelf.style.opacity = '0.5';
			treeItemSelf.style.pointerEvents = 'none';
		}

		// Collapse/Expand arrow (only for base nodes with children)
		if (hasChildren) {
			treeItemSelf.addClass('mod-collapsible');
			
			const collapseIcon = treeItemSelf.createDiv('tree-item-icon collapse-icon');
			
			// Use right-triangle icon (Obsidian's standard)
			setIcon(collapseIcon, 'right-triangle');
			
			// Add is-collapsed class for CSS control
			collapseIcon.toggleClass('is-collapsed', !!node.collapsed);
			treeItem.toggleClass('is-collapsed', !!node.collapsed);
			
			// Allow arrow click even when disabled
			if (node.disabled) {
				collapseIcon.style.pointerEvents = 'auto';
			}

			let childrenContainer: HTMLElement;

			// Toggle collapse state with pure DOM manipulation (no re-render)
			collapseIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				node.collapsed = !node.collapsed;

				// Get reference if not set yet
				if (!childrenContainer) {
					childrenContainer = treeItem.querySelector('.tree-item-children') as HTMLElement;
				}

				// Toggle CSS classes and visibility
				collapseIcon.toggleClass('is-collapsed', node.collapsed);
				treeItem.toggleClass('is-collapsed', node.collapsed);
				if (childrenContainer) childrenContainer.toggle(!node.collapsed);
			});
		}

		// Inner content (checkbox, icon, title)
		const treeItemInner = treeItemSelf.createDiv('tree-item-inner file-tree-item');

		// Checkbox
		const checkbox = treeItemInner.createEl('input', {
			type: 'checkbox',
			cls: 'file-tree-item-checkbox',
			attr: {
				checked: node.selected,
				disabled: node.disabled
			}
		});

		if (!node.disabled) {
			checkbox.addEventListener('change', () => {
				this.setNodeSelection(node, checkbox.checked);
				this.renderTree();
			});
		}

		// Icon: Base uses database icon, Table uses file icon
		const iconContainer = treeItemInner.createDiv('file-tree-item-icon');
		setIcon(iconContainer, node.type === 'base' ? 'database' : 'file');

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
		if (hasChildren) {
			for (const child of node.children!) {
				this.renderTreeNode(childrenContainer, child, level + 1);
			}
		}
	}

	/**
	 * Set selection state for node and all children recursively
	 * Children are also disabled when selected (to indicate inherited selection)
	 */
	private setNodeSelection(node: AirtableTreeNode, selected: boolean, isRoot: boolean = true): void {
		node.selected = selected;
		if (!isRoot) {
			node.disabled = selected;
		}
		if (node.children) {
			for (const child of node.children) {
				this.setNodeSelection(child, selected, false);
			}
		}
	}

	/**
	 * Check if all nodes are selected
	 */
	private areAllNodesSelected(nodes: AirtableTreeNode[] = this.tree): boolean {
		for (const node of nodes) {
			if (!node.selected) {
				return false;
			}
			if (!this.areAllNodesSelected(node.children || [])) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Select or deselect all nodes
	 */
	private selectAllNodes(selected: boolean): void {
		const processNode = (node: AirtableTreeNode) => {
			if (!node.disabled) {
				this.setNodeSelection(node, selected);
			}
			if (node.children) {
				for (const child of node.children) {
					processNode(child);
				}
			}
		};

		for (const node of this.tree) {
			processNode(node);
		}
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
	private getSelectedNodes(nodes: AirtableTreeNode[] = this.tree): AirtableTreeNode[] {
		const selected: AirtableTreeNode[] = [];
		for (const node of nodes) {
			if (node.selected && !node.disabled) {
				selected.push(node);
			}
			if (node.children) {
				selected.push(...this.getSelectedNodes(node.children));
			}
		}
		return selected;
	}

	/**
	 * Show template configuration UI before import (similar to CSV importer)
	 */
	async showTemplateConfiguration(_ctx: ImportContext, container: HTMLElement): Promise<boolean> {
		const selectedNodes = this.getSelectedNodes();
		if (selectedNodes.length === 0) {
			new Notice('Please select at least one table to import.');
			return false;
		}

		// Collect all unique fields from selected tables (union of all fields across tables)
		// Collect all fields from selected tables for template configuration
		const allFieldsMap = new Map<string, AirtableFieldSchema>();
		const fieldExamples = new Map<string, string>();
		
		const collectFields = (nodes: AirtableTreeNode[]) => {
			for (const node of nodes) {
				if (node.metadata?.fields) {
					for (const field of node.metadata.fields) {
						if (!allFieldsMap.has(field.name)) {
							allFieldsMap.set(field.name, field);
							fieldExamples.set(field.name, this.generateExampleValue(field));
						}
					}
				}
				
				// Recursively collect from children (for base nodes)
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

		// Create and show configurator
		// Note: Airtable uses each table's primary field as note title (no custom template)
		const configurator = new TemplateConfigurator({
			fields,
			defaults: {
				titleTemplate: '', // Not used - each table's primary field is used directly
				locationTemplate: '',
				bodyTemplate,
				propertyNames,
				propertyValues,
			},
			placeholderSyntax: '{{field_name}}',
			showTitleTemplate: false, // Airtable always uses primary field as note title
			showLocationTemplate: false, // Records go to table folders automatically
		});

		this.templateConfig = await configurator.show(container);

		// Return false if user cancelled
		return this.templateConfig !== null;
	}

	/**
	 * Generate example value for a field based on its type
	 */
	private generateExampleValue(field: AirtableFieldSchema): string {
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
				return '99.99';
			case 'percent':
				return '75%';
			case 'singleSelect':
				return field.options?.choices?.[0]?.name || 'Option 1';
			case 'multipleSelects':
				return field.options?.choices?.slice(0, 2).map((c: { name: string }) => c.name).join(', ') || 'Option 1, Option 2';
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

	/**
	 * Sanitize property name for use in YAML frontmatter.
	 * Obsidian properties support most characters including spaces and hyphens,
	 * so we return the original name to ensure consistency.
	 */
	private sanitizePropertyName(name: string): string {
		return name;
	}
	
	/**
	 * Sanitize view name for use in wiki links
	 * Wiki links can't contain: [ ] # | ^
	 */
	private sanitizeViewName(name: string): string {
		return name.replace(/[\[\]#|^]/g, '_');
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
			// Initialize global data that persists across bases
			this.recordIdToPath.clear();
			this.allFieldsForTypeInference.clear();
			this.attachmentsDownloaded = 0;

			// Group selected nodes by base
			const baseGroups = this.groupSelectedNodesByBase(selectedNodes);
			const totalBases = baseGroups.size;
			
			// Initialize status context
			this.statusContext = {
				totalBases,
				currentBaseIndex: 0,
				baseName: '',
				tableName: '',
				viewName: '',
				recordsProgress: '',
			};
			
			ctx.status(`Found ${totalBases} base(s) to import...`);

			// Process each base sequentially to minimize memory usage
			for (const [, baseInfo] of baseGroups.entries()) {
				if (ctx.isCancelled()) {
					ctx.status('Import cancelled.');
					return;
				}

				// Update status context for this base
				this.statusContext.currentBaseIndex++;
				this.statusContext.baseName = baseInfo.baseName;
				this.statusContext.tableName = '';
				this.statusContext.viewName = '';
				this.statusContext.recordsProgress = '';
				
				// Clear data from previous base to free memory
				this.clearBaseData();
				
				// Reset progress bar to 0% for the new base
				ctx.reportProgress(0, 1);
				
				ctx.status(this.buildStatusMessage('Fetching'));

				// ============================================================
				// PHASE 1: Fetch data for this base
				// ============================================================
				try {
					await this.fetchBaseData(ctx, baseInfo);
				}
				catch (error) {
					console.error(`Failed to fetch data from base "${baseInfo.baseName}":`, error);
					ctx.reportFailed(`Base: ${baseInfo.baseName}`, error);
					// Continue with next base instead of stopping entirely
					continue;
				}

				if (ctx.isCancelled()) {
					ctx.status('Import cancelled.');
					return;
				}

				// ============================================================
				// PHASE 2: Create files for this base
				// ============================================================
				try {
					await this.createFilesForBase(ctx, folder.path);
				}
				catch (error) {
					console.error(`Failed to create files for base "${baseInfo.baseName}":`, error);
					ctx.reportFailed(`Base: ${baseInfo.baseName}`, error);
					// Continue with next base
					continue;
				}
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
	 * Group selected nodes by their base
	 * Returns a Map where key is baseId and value contains base info and tables array
	 */
	private groupSelectedNodesByBase(selectedNodes: AirtableTreeNode[]): Map<string, BaseGroupInfo> {
		const baseGroups = new Map<string, BaseGroupInfo>();

		for (const node of selectedNodes) {
			if (node.type === 'base' && node.children) {
				// Entire base selected - add all its tables
				if (!baseGroups.has(node.id)) {
					baseGroups.set(node.id, {
						baseId: node.id,
						baseName: node.title,
						tables: [],
					});
				}
				const group = baseGroups.get(node.id)!;
				
				for (const tableNode of node.children) {
					group.tables.push({
						tableName: tableNode.metadata?.tableName || tableNode.title,
						primaryFieldId: tableNode.metadata?.primaryFieldId || '',
						fields: tableNode.metadata?.fields || [],
						views: tableNode.metadata?.views || [],
					});
				}
			}
			else if (node.type === 'table' && node.metadata?.baseId) {
				// Single table selected - find or create its base group
				const baseId = node.metadata.baseId;
				
				if (!baseGroups.has(baseId)) {
					// Find the base node to get the base name
					const baseName = this.tree.find(baseNode => baseNode.id === baseId)?.title ?? '';
					baseGroups.set(baseId, {
						baseId,
						baseName,
						tables: [],
					});
				}
				
				const group = baseGroups.get(baseId)!;
				group.tables.push({
					tableName: node.metadata?.tableName || node.title,
					primaryFieldId: node.metadata?.primaryFieldId || '',
					fields: node.metadata?.fields || [],
					views: node.metadata?.views || [],
				});
			}
		}

		return baseGroups;
	}

	/**
	 * Clear data from previous base to free memory
	 * Note: Some data is preserved across bases:
	 * - recordIdToPath: needed for cleanupAirtableIds at the end
	 * - allFieldsForTypeInference: needed for updatePropertyTypes at the end
	 * - attachmentsDownloaded: global counter for UI
	 */
	private clearBaseData(): void {
		// These are cleared per-base to free memory
		this.globalFieldIdToNameMap.clear();
		this.globalRecordIdToTitle.clear();
		this.preparedData.clear();
		
		// Reset per-base progress counters
		this.processedRecordsCount = 0;
		this.totalRecordsToImport = 0;
	}

	/**
	 * Fetch all data for a single base
	 */
	private async fetchBaseData(
		ctx: ImportContext,
		baseInfo: BaseGroupInfo
	): Promise<void> {
		const { baseId, baseName, tables } = baseInfo;
		
		// Reset counts for this base
		this.totalRecordsToImport = 0;
		this.processedRecordsCount = 0;
		
		// Fetch data for each table in this base
		for (const table of tables) {
			if (ctx.isCancelled()) return;
			
			// Update status context
			this.statusContext.tableName = table.tableName;
			this.statusContext.viewName = '';
			this.statusContext.recordsProgress = '';
			
			ctx.status(this.buildStatusMessage('Fetching', { showTable: true }));
			
			await this.fetchTableData(ctx, {
				baseId,
				baseName,
				tableName: table.tableName,
				primaryFieldId: table.primaryFieldId,
				fields: table.fields,
				views: table.views,
			});
		}
		
		// Report progress after fetching all tables for this base
		this.statusContext.tableName = '';
		this.statusContext.recordsProgress = `${this.totalRecordsToImport} records`;
		ctx.status(this.buildStatusMessage('Preparing', { showRecords: true }));
		ctx.reportProgress(0, this.totalRecordsToImport);
	}

	/**
	 * Create files for a single base
	 */
	private async createFilesForBase(
		ctx: ImportContext,
		rootPath: string
	): Promise<void> {
		// Process each table's prepared data
		for (const [, tableData] of this.preparedData.entries()) {
			if (ctx.isCancelled()) return;
			
			// Update status context
			this.statusContext.tableName = tableData.tableName;
			this.statusContext.viewName = '';
			
			await this.createFilesForTable(ctx, tableData, rootPath);
		}
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
			primaryFieldId: string;
			fields: AirtableFieldSchema[];
			views: AirtableViewInfo[];
		}
	): Promise<void> {
		const { baseId, baseName, tableName, primaryFieldId, fields, views } = tableInfo;
		
		if (ctx.isCancelled()) return;
		
		const tableKey = `${baseId}:${tableName}`;
		
		// Filter to supported views only
		const supportedViews = views.filter(view => 
			['grid', 'gallery', 'list'].includes(view.type.toLowerCase())
		);
		
		// Find the primary field by ID (don't assume fields[0] is primary)
		const primaryField = fields.find(f => f.id === primaryFieldId);
		const primaryFieldName = primaryField?.name || fields[0]?.name;
		
		// Collect fields for type inference and build global field ID to name mapping
		for (const field of fields) {
			if (!this.allFieldsForTypeInference.has(field.name)) {
				this.allFieldsForTypeInference.set(field.name, field);
			}
			// Build global field ID to name mapping (for lookup/rollup fields)
			if (field.id && field.name) {
				this.globalFieldIdToNameMap.set(field.id, field.name);
			}
		}
		
		// Step 1: Fetch ALL records from the table
		// Update status - fetching records
		this.statusContext.viewName = '';
		this.statusContext.recordsProgress = '';
		ctx.status(this.buildStatusMessage('Fetching', { showTable: true }));
		
		const allRecords = await fetchAllRecords({
			baseId,
			tableIdOrName: tableName,
			token: this.airtableToken,
			// Callback to update progress during fetch
			onProgress: (fetched: number) => {
				this.statusContext.recordsProgress = `${fetched} records`;
				ctx.status(this.buildStatusMessage('Fetching', { showTable: true, showRecords: true }));
			},
		});
		
		if (ctx.isCancelled()) return;
		
		// Build global record ID to title mapping (for resolving linked records across tables)
		for (const record of allRecords) {
			const recordFields = record.fields || {};
			const primaryFieldValue = recordFields[primaryFieldName];
			const title = primaryFieldValue ? String(primaryFieldValue) : 'Untitled Record';
			this.globalRecordIdToTitle.set(record.id, title);
		}
		
		// Step 2: Fetch view memberships for each record
		const recordViewMemberships = new Map<string, string[]>();
		const sanitizedTableName = sanitizeFileName(tableName);
		const sanitizedBaseName = sanitizeFileName(baseName);
		
		// Build .base file path relative to output folder (e.g., "BaseName/TableName.base")
		// This ensures unique identification when multiple bases have same table names
		const baseFilePath = normalizePath(baseName 
			? `${sanitizedBaseName}/${sanitizedTableName}.base`
			: `${sanitizedTableName}.base`);
		
		for (const view of supportedViews) {
			if (ctx.isCancelled()) return;
			
			// Update status - fetching view
			this.statusContext.viewName = view.name;
			this.statusContext.recordsProgress = '';
			ctx.status(this.buildStatusMessage('Fetching', { showTable: true, showView: true }));
			
			// Fetch only record IDs from this view
			const viewRecordIds = await this.fetchViewRecordIds(baseId, tableName, view, ctx);
			
			// Build view reference with full path to avoid ambiguity
			// e.g., [[BaseName/TableName.base#Grid view]]
			// Sanitize view name for wiki link compatibility
			const sanitizedViewName = this.sanitizeViewName(view.name);
			const viewReference = `[[${baseFilePath}#${sanitizedViewName}]]`;
			
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
			primaryFieldId,
			fields,
			views: supportedViews,
			records: allRecords,
			recordViewMemberships,
		});
		
		// Count total records to import
		this.totalRecordsToImport += allRecords.length;
	}
	
	
	/**
	 * Create files for a single table
	 */
	private async createFilesForTable(
		ctx: ImportContext,
		tableData: PreparedTableData,
		rootPath: string
	): Promise<void> {
		const { baseId, baseName, tableName, primaryFieldId, fields, views, records, recordViewMemberships } = tableData;
		
		// Find primary field by ID (don't assume fields[0] is primary)
		const primaryField = fields.find(f => f.id === primaryFieldId);
		const primaryFieldName = primaryField?.name || fields[0]?.name;
		
		// Build table path
		const tablePath = baseName 
			? normalizePath(`${rootPath}/${sanitizeFileName(baseName)}/${sanitizeFileName(tableName)}`)
			: normalizePath(`${rootPath}/${sanitizeFileName(tableName)}`);
		
		await this.createFolders(tablePath);
		
		// Update status context for writing
		this.statusContext.tableName = tableName;
		this.statusContext.viewName = '';
		this.statusContext.recordsProgress = `0/${records.length}`;
		ctx.status(this.buildStatusMessage('Writing', { showTable: true, showRecords: true }));
		
		// Create .base file first
		await this.createBaseFile({
			tableFolderPath: tablePath,
			tableName,
			views,
			fields,
			primaryFieldId,
		});
		
		if (ctx.isCancelled()) return;
		
		// Create files for all records
		// Note: Using globalRecordIdToTitle for resolving linked records across tables
		const totalRecordsInTable = records.length;
		let processedInTable = 0;
		
		for (const record of records) {
			if (ctx.isCancelled()) return;
			
			try {
				const viewReferences = recordViewMemberships.get(record.id) || [];
				await this.createRecordFile(ctx, record, {
					baseId,
					tablePath,
					primaryFieldId,
					fields,
					viewReferences,
					recordIdToTitle: this.globalRecordIdToTitle,
				});
			}
			catch (error) {
				// Safely get record title for error reporting
				let recordTitle = 'Untitled Record';
				try {
					const primaryFieldValue = record.fields?.[primaryFieldName];
					if (primaryFieldValue && typeof primaryFieldValue === 'string') {
						recordTitle = primaryFieldValue;
					}
					else if (primaryFieldValue) {
						recordTitle = String(primaryFieldValue);
					}
				}
				catch (e) {
					// If title extraction fails, use default
				}
				ctx.reportFailed(recordTitle, error);
				this.processedRecordsCount++;
				ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
			}
			
			// Update progress display
			processedInTable++;
			this.statusContext.recordsProgress = `${processedInTable}/${totalRecordsInTable}`;
			ctx.status(this.buildStatusMessage('Writing', { showTable: true, showRecords: true }));
		}
		
	}

	/**
	 * Fetch only record IDs from a view (without full field data)
	 * This is more efficient when we only need to know which records belong to a view
	 */
	private async fetchViewRecordIds(
		baseId: string,
		tableName: string,
		view: AirtableViewInfo,
		ctx: ImportContext
	): Promise<string[]> {
		const base = new Airtable({ apiKey: this.airtableToken }).base(baseId);
		const recordIds: string[] = [];
		
		try {
			// Only fetch the ID field (minimal data transfer)
			await base(tableName)
				.select({
					view: view.id,
					fields: [], // Request no fields, only IDs
				})
				// Airtable SDK returns untyped record objects
				.eachPage((pageRecords: any[], fetchNextPage: () => void) => {
					// Extract only the IDs
					recordIds.push(...pageRecords.map(r => r.id));
					fetchNextPage();
				});
		}
		catch (error) {
			ctx.reportFailed(`${tableName} > ${view.name}`, error);
		}
		
		return recordIds;
	}

	/**
	 * Create a file for a single record (Phase 2)
	 * Resolves all linked records before writing
	 */
	private async createRecordFile(
		ctx: ImportContext,
		record: AirtableRecord,
		fileContext: RecordFileContext
	): Promise<void> {
		const { tablePath, primaryFieldId, fields, viewReferences, recordIdToTitle } = fileContext;
		const recordId = record.id;
		const recordFields = record.fields || {};
		
		// Find primary field by ID (don't assume fields[0] is primary)
		const primaryField = fields.find(f => f.id === primaryFieldId);
		const primaryFieldName = primaryField?.name || fields[0]?.name;
		
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
			ctx.reportSkipped('Untitled Record', 'Empty record');
			this.processedRecordsCount++;
			ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
			return;
		}
		
		// Helper to extract string value from field (handles barcode, formula results, etc.)
		const extractStringValue = (value: any): string => {
			if (value === null || value === undefined) return '';
			// Handle barcode: { text: "xxx", type: "code39" }
			if (typeof value === 'object' && !Array.isArray(value) && value.text !== undefined) {
				return String(value.text);
			}
			// Handle arrays (some formula results)
			if (Array.isArray(value)) {
				return value.map(v => String(v)).join(', ');
			}
			// Handle other objects (shouldn't happen for primary fields, but just in case)
			if (typeof value === 'object') {
				return JSON.stringify(value);
			}
			return String(value);
		};
		
		// Get primary field value (processed)
		// Airtable always uses each table's primary field as note title
		let title = extractStringValue(recordFields[primaryFieldName]);
		
		if (!title || title.trim() === '') {
			title = 'Untitled Record';
		}
		
		let sanitizedTitle = sanitizeFileName(title);
		
		let filePath = normalizePath(`${tablePath}/${sanitizedTitle}.md`);
		
		// Check for incremental import - skip if same record already exists
		const shouldSkip = this.shouldSkipExistingRecord(filePath, recordId);
		if (!shouldSkip) {
			// Build template data for both frontmatter and body
			const templateData: Record<string, string> = {};
			// Cache converted values to avoid calling convertFieldValue twice
			const convertedCache = new Map<string, any>();
		
			// First pass: convert field values for template use
			for (const field of fields) {
				const fieldValue = recordFields[field.name];
			
				if (fieldValue === null || fieldValue === undefined) {
					templateData[field.name] = '';
					continue;
				}

				// Handle linked records - resolve to wiki links
				if (field.type === 'multipleRecordLinks' && Array.isArray(fieldValue)) {
					const links = fieldValue.map((linkedRecordId: string) => {
						const linkedTitle = recordIdToTitle.get(linkedRecordId);
						return linkedTitle ? `[[${sanitizeFileName(linkedTitle)}]]` : `[Unknown Record ${linkedRecordId.substring(0, 8)}]`;
					});
					convertedCache.set(field.name, links);
					templateData[field.name] = links.join(', ');
					continue;
				}
			
				// Handle attachments - download and convert to embeds
				if (field.type === 'multipleAttachments' && Array.isArray(fieldValue)) {
					const attachments = fieldValue as AirtableAttachment[];
					const processed = await processAttachments(attachments, {
						ctx,
						currentFilePath: filePath,
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
					convertedCache.set(field.name, attachments);
					templateData[field.name] = processed.join('\n');
					continue;
				}

				// Convert other field types
				let convertedValue = convertFieldValue({
					fieldValue,
					fieldSchema: field,
					recordId,
					formulaStrategy: this.formulaStrategy,
					fieldIdToNameMap: this.globalFieldIdToNameMap,
				});
			
				// If formula was converted (returns null), use the computed value for templates
				if (convertedValue === null && field.type === 'formula') {
					convertedValue = fieldValue;
				}

				// Cache converted value for frontmatter pass
				convertedCache.set(field.name, convertedValue);

				// Convert to string for template
				if (convertedValue === null || convertedValue === undefined) {
					templateData[field.name] = '';
				}
				else if (Array.isArray(convertedValue)) {
					templateData[field.name] = convertedValue.map((item: any) => {
						if (typeof item === 'string') return item;
						return String(item);
					}).join(', ');
				}
				else {
					templateData[field.name] = String(convertedValue);
				}
			}

			// Build frontmatter
			const frontMatter: Record<string, any> = {
				'airtable-id': recordId,
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

					// Get cached converted value (already processed in first pass)
					const convertedValue = convertedCache.get(fieldId);

					// Skip if convertedValue is null/undefined/empty string
					if (convertedValue === null || convertedValue === undefined || convertedValue === '') {
						continue;
					}

					let propertyValue: any = convertedValue;

					// Handle attachments: convert to wiki links for YAML
					if (Array.isArray(convertedValue) && convertedValue.length > 0 && convertedValue[0]?.url) {
						const attachments = convertedValue as AirtableAttachment[];
						propertyValue = await processAttachmentsForYAML(attachments, {
							ctx,
							vault: this.vault,
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
					}

					// Set property (skip null/undefined/empty values and non-serializable objects)
					if (propertyValue !== null && propertyValue !== undefined && propertyValue !== '') {
						// Ensure we're not setting complex objects that could cause YAML serialization issues
						if (typeof propertyValue === 'object' && !Array.isArray(propertyValue)) {
							console.warn(`[Airtable] Skipping complex object for property "${propertyName}"`);
							continue;
						}
						frontMatter[propertyName] = propertyValue;
					}
				}
			}

			// Apply body template
			const bodyContent = this.templateConfig
				? applyTemplate(this.templateConfig.bodyTemplate, templateData)
				: '';

			// Generate file content
			const fileContent = `${serializeFrontMatter(frontMatter)}${bodyContent}`.trim();

			// Handle file name conflicts (different record with same name)
			const existingFile = this.vault.getAbstractFileByPath(filePath);
			if (existingFile instanceof TFile) {
			// File exists with different record - find unique name
				filePath = getUniqueFilePath(this.vault, tablePath, `${sanitizedTitle}.md`);
				// Update sanitizedTitle to match the new file name (without .md)
				const { basename } = parseFilePath(filePath);
				sanitizedTitle = basename;
				// Update globalRecordIdToTitle so other tables' links point to the correct file
				recordIdToTitle.set(recordId, sanitizedTitle);
			}
		
			// Create the file
			await this.vault.create(filePath, fileContent);
		
			// Track file path for cleanup
			// Use baseId:recordId as key to ensure uniqueness across bases (recordId is only unique within a base)
			const uniqueKey = `${fileContext.baseId}:${recordId}`;
			this.recordIdToPath.set(uniqueKey, filePath.replace(/\.md$/, ''));
		}
		else {
			ctx.reportSkipped(sanitizedTitle, 'Already imported');
		}
		
		ctx.reportNoteSuccess(sanitizedTitle);
		this.processedRecordsCount++;
		ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
	}

	/**
	 * Handle incremental import check for a record
	 * If file exists with same airtable-id, executes the callback and returns true
	 * Otherwise returns false to continue with normal import
	 * 
	 * @param filePath - Path to check
	 * @param recordId - Airtable record ID to compare
	 * @returns true if same record already exists (should skip), false otherwise
	 */
	private shouldSkipExistingRecord(filePath: string, recordId: string): boolean {
		if (!this.incrementalImport) {
			return false;
		}

		const file = this.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) {
			return false;
		}

		// Use metadataCache to safely read frontmatter (handles complex YAML content)
		const cachedMetadata = this.app.metadataCache.getFileCache(file);
		const existingId = cachedMetadata?.frontmatter?.['airtable-id'];
		
		return existingId === recordId;
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

				// Use metadataCache to check frontmatter
				const cachedMetadata = this.app.metadataCache.getFileCache(file);
				if (!cachedMetadata?.frontmatter || !cachedMetadata.frontmatter['airtable-id']) {
					continue; // No frontmatter or no airtable-id, skip
				}

				// Get frontmatter position from cache
				const frontmatterPos = cachedMetadata.frontmatterPosition;
				if (!frontmatterPos) {
					continue;
				}

				// Remove airtable-id from frontmatter object
				const newFrontmatter = { ...cachedMetadata.frontmatter };
				delete newFrontmatter['airtable-id'];
				delete newFrontmatter['position']; // Remove internal position property

				// Get body content (everything after frontmatter)
				const lines = content.split('\n');
				const bodyStartLine = frontmatterPos.end.line + 1;
				const bodyContent = lines.slice(bodyStartLine).join('\n');

				// Reconstruct file content
				const newContent = serializeFrontMatter(newFrontmatter) + bodyContent;

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
			console.log(`Cleaned airtable-id from ${cleanedCount} file(s)`);
		}
		if (failedCount > 0) {
			console.warn(`Failed to clean airtable-id from ${failedCount} file(s)`);
		}
	}

	/**
	 * Create a single .base file for the table with multiple views
	 */
	private async createBaseFile(ctx: BaseFileContext): Promise<void> {
		const { tableFolderPath, tableName, views, fields, primaryFieldId } = ctx;
		
		// Get parent folder (where .base file will be created)
		const { parent: parentPath } = parseFilePath(tableFolderPath);
		
		// Find primary field - this is used as note title/filename, not as a formula column
		const primaryField = fields.find(f => f.id === primaryFieldId);
		const primaryFieldName = primaryField?.name || null;
		
		// Process fields in original order, tracking which are formulas
		// This preserves Airtable's field order in the .base file
		const formulas: Map<string, string> = new Map(); // field name -> obsidian formula
		
		
		for (const field of fields) {
			// Skip primary field - it's used as note title/filename, not as a formula column
			if (field.id === primaryFieldId) {
				continue;
			}
			
			// Skip formula conversion if strategy is static
			if (this.formulaStrategy === 'static') {
				continue;
			}
			
			const options = field.options;
			const linkedFieldId = options?.recordLinkFieldId;
			const targetFieldId = options?.fieldIdInLinkedTable;
			
			// Process formula fields
			if (field.type === 'formula') {
				const formulaExpression = options?.formula;
				if (formulaExpression && canConvertFormula(formulaExpression)) {
					const converted = convertAirtableFormulaToObsidian(formulaExpression, this.globalFieldIdToNameMap);
					if (converted) {
						formulas.set(field.name, converted);
					}
				}
			}
			// Process lookup/rollup/count fields (all use linked records)
			else if (linkedFieldId) {
				const linkedFieldName = this.globalFieldIdToNameMap.get(linkedFieldId);
				if (!linkedFieldName) continue;
				
				if (field.type === 'count') {
					// Count: note["Linked Records"].length
					const sanitizedLinked = this.sanitizePropertyName(linkedFieldName);
					formulas.set(field.name, `note["${sanitizedLinked}"].length`);
				}
				else if (targetFieldId) {
					const targetFieldName = this.globalFieldIdToNameMap.get(targetFieldId);
					if (!targetFieldName) continue;
					
					// Build map expression: note["LinkedField"].map(value.asFile().properties["TargetField"])
					const sanitizedLinked = this.sanitizePropertyName(linkedFieldName);
					const sanitizedTarget = this.sanitizePropertyName(targetFieldName);
					const mapExpression = `note["${sanitizedLinked}"].map(value.asFile().properties["${sanitizedTarget}"])`;
					
					if (field.type === 'multipleLookupValues') {
						// Lookup: just the map expression
						formulas.set(field.name, mapExpression);
					}
					else if (field.type === 'rollup') {
						// Rollup: map expression + aggregation
						const obsidianFormula = this.convertRollupFormula(options?.formula, mapExpression);
						if (obsidianFormula) {
							formulas.set(field.name, obsidianFormula);
						}
					}
				}
			}
		}
		
		// Build property columns in original Airtable field order
		// Start with file.name (representing the primary/title field)
		const propertyColumns: string[] = ['file.name'];
		
		// Add fields in original order (excluding primary field which is file.name)
		for (const field of fields) {
			// Skip the primary field (it's represented by file.name)
			if (field.id === primaryFieldId) {
				continue;
			}
			
			// Add as formula or regular property column
			const sanitized = this.sanitizePropertyName(field.name);
			propertyColumns.push(formulas.has(field.name) ? `formula.${sanitized}` : sanitized);
		}

		// Create ONE .base file for the table with multiple views
		const sanitizedTableName = sanitizeFileName(tableName);
		const baseFileName = `${sanitizedTableName}.base`;
		const baseFilePath = normalizePath(parentPath ? `${parentPath}/${baseFileName}` : baseFileName);

		// Build the .base file path relative to output folder for viewReference
		// Extract from tableFolderPath: "Airtable/BaseName/TableName" -> "BaseName/TableName.base"
		// This ensures viewReference matches what's stored in record frontmatter
		// parentPath = "Airtable/BaseName", extract "BaseName" from it
		const { name: baseFolderName } = parseFilePath(parentPath);
		const viewReferenceBasePath = baseFolderName
			? normalizePath(`${baseFolderName}/${sanitizedTableName}.base`)
			: `${sanitizedTableName}.base`;

		// Build views array for .base file
		const obsidianViews: BasesConfigFileView[] = [];
		
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

			// Build view reference with full path to match frontmatter values
			// e.g., [[BaseName/TableName.base#Grid view]]
			// Sanitize view name for wiki link compatibility
			const sanitizedViewName = this.sanitizeViewName(view.name);
			const viewReference = `[[${viewReferenceBasePath}#${sanitizedViewName}]]`;

			// Add view with filter based on base property containing the view reference
			// Correct Obsidian Bases filter syntax: note["propertyName"].contains("value")
			obsidianViews.push({
				type: obsidianViewType,
				name: sanitizedViewName, // Must match the name in wiki link reference
				filters: `note["${this.viewPropertyName}"].contains("${viewReference}")`,
				order: propertyColumns,
			});
		}

		// Build base config using Obsidian's BasesConfigFile type
		const baseConfig: BasesConfigFile = {
			// Base filter: only files in this table's folder
			filters: `file.folder == "${tableFolderPath}"`,
		};
		
		// Add formulas if there are any
		if (formulas.size > 0) {
			baseConfig.formulas = {};
			for (const [fieldName, obsidianFormula] of formulas) {
				const formulaName = this.sanitizePropertyName(fieldName);
				baseConfig.formulas[formulaName] = obsidianFormula;
			}
		}
		
		// Add properties section for display names (in original field order)
		baseConfig.properties = {};
		
		// Set file.name display name to primary field name
		if (primaryFieldName) {
			baseConfig.properties['file.name'] = {
				displayName: primaryFieldName
			};
		}
		
		// Add field display names in original order (excluding primary field)
		for (const field of fields) {
			if (field.id === primaryFieldId) {
				continue;
			}
			
			// Add display name for formula or regular property
			const sanitized = this.sanitizePropertyName(field.name);
			const propertyKey = formulas.has(field.name) ? `formula.${sanitized}` : sanitized;
			baseConfig.properties[propertyKey] = { displayName: field.name };
		}
		
		// Add views
		baseConfig.views = obsidianViews;

		// Create or update the .base file
		try {
			const content = stringifyYaml(baseConfig);
			
			// Check if file already exists
			const existingFile = this.vault.getAbstractFileByPath(baseFilePath);
			
			if (existingFile && existingFile instanceof TFile) {
				// File exists - update it by merging views
				const existingContent = await this.vault.read(existingFile);
				
				// Parse existing YAML to extract existing views (Obsidian Bases internal format)
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
				await this.vault.create(baseFilePath, content);
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
			case 'percent':
			case 'duration':
			case 'autoNumber':
				return 'number';
			
			case 'currency':
			case 'rating':
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
			case 'multipleLookupValues':
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
	 * Convert Airtable rollup formula to Obsidian formula
	 * Replaces 'values' with the map expression
	 * 
	 * Strategy:
	 * 1. First try to match simple aggregation patterns like SUM(VALUES), AVERAGE(VALUES), etc.
	 * 2. If no match, replace 'values' with mapExpression and try general formula conversion
	 * 3. If conversion fails, fall back to static values imported from Airtable
	 */
	private convertRollupFormula(
		rollupFormula: string | undefined,
		mapExpression: string
	): string | null {
		if (!rollupFormula) {
			// No formula means just show original values
			return mapExpression;
		}
		
		// Normalize formula for comparison
		const formula = rollupFormula.trim().toUpperCase();
		
		// Step 1: Try to match simple aggregation patterns
		if (formula === 'SUM(VALUES)') {
			return `${mapExpression}.sum()`;
		}
		if (formula === 'AVERAGE(VALUES)' || formula === 'AVG(VALUES)') {
			return `${mapExpression}.mean()`;
		}
		if (formula === 'MAX(VALUES)') {
			return `max(${mapExpression})`;
		}
		if (formula === 'MIN(VALUES)') {
			return `min(${mapExpression})`;
		}
		if (formula === 'COUNT(VALUES)') {
			return `${mapExpression}.filter(value.isType("number")).length`;
		}
		if (formula === 'COUNTA(VALUES)') {
			return `${mapExpression}.filter(!value.isEmpty()).length`;
		}
		if (formula === 'COUNTALL(VALUES)') {
			return `${mapExpression}.length`;
		}
		if (formula === 'ARRAYJOIN(VALUES)') {
			return `${mapExpression}.join(", ")`;
		}
		if (formula.startsWith('ARRAYJOIN(VALUES,')) {
			// Extract separator: ARRAYJOIN(VALUES, "separator")
			const match = formula.match(/ARRAYJOIN\(VALUES,\s*["'](.*)["']\)/i);
			if (match) {
				return `${mapExpression}.join("${match[1]}")`;
			}
			return `${mapExpression}.join(", ")`;
		}
		if (formula === 'ARRAYUNIQUE(VALUES)') {
			return `${mapExpression}.unique()`;
		}
		if (formula === 'ARRAYCOMPACT(VALUES)') {
			return `${mapExpression}.filter(!value.isEmpty())`;
		}
		if (formula === 'ARRAYFLATTEN(VALUES)') {
			return `${mapExpression}.flat()`;
		}
		if (formula === 'AND(VALUES)') {
			return `${mapExpression}.map(value.isTruthy()).every(value)`;
		}
		if (formula === 'OR(VALUES)') {
			return `${mapExpression}.map(value.isTruthy()).some(value)`;
		}
		
		// Step 2: Try general formula conversion
		// Replace 'values' with the map expression and attempt conversion
		const formulaWithMapExpr = rollupFormula.replace(/\bvalues\b/gi, mapExpression);
		
		if (canConvertFormula(formulaWithMapExpr)) {
			const result = convertAirtableFormulaToObsidian(formulaWithMapExpr, this.globalFieldIdToNameMap);
			if (result) {
				return result;
			}
		}
		
		// Step 3: Cannot convert - fall back to static value
		console.log(`Rollup formula "${rollupFormula}" cannot be converted, using static value`);
		return null;
	}
}

