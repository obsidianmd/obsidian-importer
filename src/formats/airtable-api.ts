/**
 * Airtable API Importer
 * Imports tables and records from Airtable using the API
 */

import { Notice, Setting, normalizePath, TFile, setIcon } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { sanitizeFileName, serializeFrontMatter } from '../util';

// Import helper modules
import { fetchBases, fetchTableSchema, fetchAllRecords } from './airtable-api/api-helpers';
import { convertFieldValue, shouldFieldGoToBody } from './airtable-api/field-converter';
import { processAttachments } from './airtable-api/attachment-helpers';
import { createBaseFile } from './airtable-api/base-helpers';
import type {
	FormulaImportStrategy,
	AirtableTreeNode,
	TableInfo,
	LinkedRecordPlaceholder,
	AirtableAttachment,
} from './airtable-api/types';

export class AirtableAPIImporter extends FormatImporter {
	airtableToken: string = '';
	formulaStrategy: FormulaImportStrategy = 'hybrid';
	downloadAttachments: boolean = true;
	
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
						children: [],
						selected: false,
						disabled: false,
						collapsed: true,
						metadata: {
							baseId: base.id,
							tableName: table.name,
							fields: table.fields,
						},
					};

					// Add view nodes (optional - user can select specific views)
					for (const view of table.views) {
						const viewNode: AirtableTreeNode = {
							id: `${base.id}:${table.id}:${view.id}`,
							title: `${view.name} (${view.type})`,
							type: 'view',
							parentId: `${base.id}:${table.id}`,
							children: [],
							selected: false,
							disabled: false,
							collapsed: true,
							metadata: {
								baseId: base.id,
								tableName: table.name,
								viewId: view.id,
								fields: table.fields,
							},
						};

						tableNode.children.push(viewNode);
					}

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
					if (node.type !== 'view' && iconContainer) {
						iconContainer.empty();
						setIcon(iconContainer, 'folder');
					}
				}
				else {
					collapseIcon.removeClass('is-collapsed');
					treeItemRef.removeClass('is-collapsed');
					if (childrenContainer) childrenContainer.style.display = '';
					if (node.type !== 'view' && iconContainer) {
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
			setIcon(iconContainer, node.children.length > 0 && !node.collapsed ? 'folder-open' : 'folder');
		}
		else if (node.type === 'view') {
			setIcon(iconContainer, 'layout');
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

	async import(ctx: ImportContext): Promise<void> {
		if (!this.airtableToken) {
			new Notice('Please enter your Airtable Personal Access Token.');
			return;
		}

		const selectedNodes = this.getSelectedNodes();
		if (selectedNodes.length === 0) {
			new Notice('Please select at least one table or view to import.');
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
			this.processedRecordsCount = 0;
			this.totalRecordsToImport = 0;
			this.attachmentsDownloaded = 0;

			ctx.status('Importing selected tables...');

			for (const node of selectedNodes) {
				if (ctx.isCancelled()) break;

				try {
					if (node.type === 'base') {
						// Import entire base
						await this.importBase(ctx, node, folder.path);
					}
					else if (node.type === 'table') {
						// Import table
						await this.importTable(ctx, node, folder.path);
					}
					else if (node.type === 'view') {
						// Import specific view
						await this.importView(ctx, node, folder.path);
					}
				}
				catch (error) {
					console.error(`Failed to import ${node.type} ${node.title}:`, error);
					ctx.reportFailed(node.title, error);
				}
			}

			// Replace linked record placeholders
			ctx.status('Processing linked records...');
			await this.replaceLinkedRecordPlaceholders(ctx);

			ctx.status('Import completed successfully!');
		}
		catch (error) {
			console.error('Airtable API import error:', error);
			ctx.reportFailed('Airtable API import', error);
			new Notice(`Import failed: ${error.message}`);
		}
	}

	/**
	 * Import an entire base
	 */
	private async importBase(ctx: ImportContext, node: AirtableTreeNode, parentPath: string): Promise<void> {
		const baseName = sanitizeFileName(node.title);
		const basePath = normalizePath(`${parentPath}/${baseName}`);

		await this.createFolders(basePath);

		// Import all child tables
		for (const tableNode of node.children) {
			if (ctx.isCancelled()) break;
			await this.importTable(ctx, tableNode, basePath);
		}
	}

	/**
	 * Import a table
	 */
	private async importTable(ctx: ImportContext, node: AirtableTreeNode, parentPath: string): Promise<void> {
		const baseId = node.metadata?.baseId;
		const tableName = node.metadata?.tableName;
		const fields = node.metadata?.fields || [];

		if (!baseId || !tableName) {
			throw new Error('Missing base ID or table name');
		}

		const sanitizedTableName = sanitizeFileName(tableName);
		const tablePath = normalizePath(`${parentPath}/${sanitizedTableName}`);

		await this.createFolders(tablePath);

		// Fetch all records
		ctx.status(`Fetching records from ${tableName}...`);
		const records = await fetchAllRecords(baseId, tableName, this.airtableToken, ctx);

		this.totalRecordsToImport += records.length;
		ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);

		// Import each record
		for (const record of records) {
			if (ctx.isCancelled()) break;
			await this.importRecord(ctx, record, baseId, tableName, tablePath, fields);
		}

		// Store table info
		this.processedTables.set(`${baseId}:${tableName}`, {
			id: tableName,
			baseId,
			name: tableName,
			folderPath: tablePath,
			baseFilePath: `${tablePath}.base`,
			fields,
			primaryFieldId: fields[0]?.id || '',
		});

		// Create .base file
		// Note: We'll get views from the table schema
		const tableSchema = await fetchTableSchema(baseId, this.airtableToken, ctx);
		const tableInfo = tableSchema.find(t => t.name === tableName);
		if (tableInfo) {
			await createBaseFile({
				vault: this.vault,
				tableName,
				tableFolderPath: tablePath,
				fields,
				views: tableInfo.views,
				formulaStrategy: this.formulaStrategy,
			});
		}
	}

	/**
	 * Import a specific view
	 */
	private async importView(ctx: ImportContext, node: AirtableTreeNode, parentPath: string): Promise<void> {
		// Views are essentially filtered tables, so we import records from the view
		const baseId = node.metadata?.baseId;
		const tableName = node.metadata?.tableName;
		const viewId = node.metadata?.viewId;
		const fields = node.metadata?.fields || [];

		if (!baseId || !tableName || !viewId) {
			throw new Error('Missing base ID, table name, or view ID');
		}

		const sanitizedTableName = sanitizeFileName(tableName);
		const viewName = sanitizeFileName(node.title);
		const viewPath = normalizePath(`${parentPath}/${sanitizedTableName} - ${viewName}`);

		await this.createFolders(viewPath);

		// Fetch records filtered by view
		ctx.status(`Fetching records from view ${node.title}...`);
		const records = await fetchAllRecords(baseId, tableName, this.airtableToken, ctx, viewId);

		this.totalRecordsToImport += records.length;
		ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);

		// Import each record
		for (const record of records) {
			if (ctx.isCancelled()) break;
			await this.importRecord(ctx, record, baseId, tableName, viewPath, fields);
		}
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
		fields: any[]
	): Promise<void> {
		const recordId = record.id;
		const recordFields = record.fields || {};

		// Get primary field for title
		const primaryField = fields[0];
		const recordTitle = primaryField && recordFields[primaryField.name]
			? String(recordFields[primaryField.name])
			: `Record ${recordId.substring(0, 8)}`;

		const sanitizedTitle = sanitizeFileName(recordTitle);

		ctx.status(`Importing: ${sanitizedTitle}`);

		// Build frontmatter
		const frontMatter: Record<string, any> = {
			'airtable-id': recordId,
			'airtable-created': record.createdTime,
		};

		let bodyContent = '';

		// Process each field
		for (const field of fields) {
			const fieldValue = recordFields[field.name];

			if (fieldValue === null || fieldValue === undefined) {
				continue;
			}

			// Convert field value
			const converted = convertFieldValue(
				fieldValue,
				field,
				recordId,
				this.formulaStrategy,
				this.linkedRecordPlaceholders,
				ctx
			);

			if (converted === null || converted === undefined) {
				continue;
			}

			// Handle attachments separately
			if (field.type === 'multipleAttachments' && Array.isArray(converted)) {
				const attachments = converted as AirtableAttachment[];
				const links = await processAttachments(attachments, {
					ctx,
					currentFolderPath: parentPath,
					currentFilePath: `${parentPath}/${sanitizedTitle}.md`,
					vault: this.vault,
					app: this.app,
					downloadAttachments: this.downloadAttachments,
					currentRecordTitle: sanitizedTitle,
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
					frontMatter[field.name] = links;
				}
				continue;
			}

			// Check if field should go to body
			if (shouldFieldGoToBody(field)) {
				bodyContent += `## ${field.name}\n\n${converted}\n\n`;
			}
			else {
				frontMatter[field.name] = converted;
			}
		}

		// Create markdown file
		const fullContent = serializeFrontMatter(frontMatter) + (bodyContent ? '\n\n' + bodyContent : '');
		const filePath = normalizePath(`${parentPath}/${sanitizedTitle}.md`);

		await this.vault.create(filePath, fullContent);

		// Track record path
		const pathWithoutExt = filePath.replace(/\.md$/, '');
		this.recordIdToPath.set(recordId, pathWithoutExt);

		this.processedRecordsCount++;
		ctx.reportProgress(this.processedRecordsCount, this.totalRecordsToImport);
		ctx.reportNoteSuccess(sanitizedTitle);
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

