/**
 * Airtable API Importer
 * Imports tables and records from Airtable using the API
 */

import { ButtonComponent, FrontMatterCache, Notice, Setting, normalizePath, TFile, setIcon, stringifyYaml, parseYaml } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { parseFilePath } from '../filesystem';
import { extractErrorMessage, sanitizeFileName, getUniqueFilePath, updatePropertyTypes } from '../util';
import type { FormulaImportStrategy } from '../base';
import {
	TemplateConfigurator,
	TemplateConfig,
	TemplateField,
} from '../template';

// Import helper modules
import Airtable from 'airtable';
import { fetchBases, fetchTableSchema, selectRecords } from './airtable-api/api-helpers';
import { downloadAttachmentList, formatAttachmentsForBody, formatAttachmentsForYAML } from './airtable-api/attachment-helpers';
import { buildBaseFile, sanitizePropertyName, sanitizeViewName } from './airtable-api/base-file';
import { mapAirtableTypeToObsidian } from './airtable-api/field-converter';
import { computeTableFormulas } from './airtable-api/table-formulas';
import {
	buildRecordNote,
	defaultPropertyConfig,
	frontMatterFieldsForTable,
	isEmptyRecord,
	recordTitle,
	RECORD_LINK_PLACEHOLDER_PATTERN,
} from './airtable-api/record-note';
import type {
	AirtableTreeNode,
	AirtableViewInfo,
	AirtableFieldSchema,
	PreparedTableData,
	AirtableRecord,
	RecordFileContext,
	BaseFileContext,
	BaseGroupInfo,
} from './airtable-api/types';

const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Placeholder shown next to each field in the template configurator, so the user
 * can see the shape of what a property will hold. Select fields are handled in
 * generateExampleValue, which can show the user their own choices instead.
 */
const EXAMPLE_VALUE_FOR_FIELD_TYPE: Record<string, string> = {
	aiText: 'AI-generated summary...',
	singleLineText: 'Sample text',
	multilineText: 'Long text content...',
	richText: 'Long text content...',
	number: '123',
	currency: '99.99',
	percent: '75%',
	date: '2025-01-15',
	dateTime: '2025-01-15 14:30',
	checkbox: 'true',
	email: 'user@example.com',
	url: 'https://example.com',
	phoneNumber: '+1 555-0123',
	multipleRecordLinks: 'Related Record 1, Related Record 2',
	multipleAttachments: 'file1.pdf, image.png',
	singleCollaborator: 'John Doe',
	createdBy: 'John Doe',
	lastModifiedBy: 'John Doe',
	multipleCollaborators: 'John Doe, Jane Smith',
	formula: 'Computed value',
	rollup: 'Computed value',
	multipleLookupValues: 'Computed value',
	count: '5',
	autoNumber: '3',
	rating: '3',
	duration: '2:30:00',
	barcode: '1234567890',
};

/**
 * Read a note's frontmatter straight from its content.
 *
 * The metadata cache is populated asynchronously, so a file written moments
 * earlier in the same import usually has no cache entry yet. Anything that
 * inspects frontmatter mid-import has to parse the content itself, or it will
 * silently treat freshly written notes as having none.
 *
 * Returns null when there is no parseable frontmatter block.
 */
function parseFrontMatterBlock(content: string): { frontMatter: FrontMatterCache, body: string } | null {
	const match = FRONT_MATTER_PATTERN.exec(content);
	if (!match) {
		return null;
	}

	try {
		const parsed = parseYaml(match[1]);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null;
		}
		return { frontMatter: parsed as FrontMatterCache, body: content.slice(match[0].length) };
	}
	catch {
		return null;
	}
}

export class AirtableAPIImporter extends FormatImporter {
	/** Resolved from the keychain on each read, so unlinking the secret takes effect immediately */
	get airtableToken(): string {
		return this.getSecret() ?? '';
	}

	formulaStrategy: FormulaImportStrategy = 'hybrid';
	downloadAttachments: boolean = true;
	viewPropertyName: string = 'base'; // Property name to track which views a record belongs to
	incrementalImport: boolean = false; // Incremental import: skip files with same airtable-id (default: disabled)

	// Tree for base/table selection
	private tree: AirtableTreeNode[] = [];
	private treeContainer: HTMLElement;
	private loadButton: ButtonComponent;
	private toggleSelectButton: ButtonComponent;

	// Tracking data
	private recordIdToPath: Map<string, string> = new Map(); // baseId:recordId -> file path (recordId only unique within base)
	// Notes written with an unresolved linked-record placeholder in them, so the
	// resolve pass reads back only those rather than every note in the base
	private pendingLinkFiles: string[] = [];
	// Record counters span the whole import, across every base, so the progress
	// bar and the imported tally do not restart when a new base begins
	private processedRecordsCount: number = 0;
	private totalRecordsToImport: number = 0;
	private totalBasesToImport: number = 0;
	private basesFetched: number = 0;

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
	private preparedData: PreparedTableData[] = [];

	// Airtable SDK handles, reused for the duration of an import. A table with
	// many views would otherwise construct a client per view.
	private airtableClient: Airtable | null = null;
	private airtableBases: Map<string, any> = new Map();

	// Appended to status messages when more than one base is being imported,
	// e.g. " (base 2 of 4)". Empty for a single base, where it says nothing.
	private basePosition: string = '';

	// Last .base file written, opened once the import finishes
	private lastBaseFilePath: string | null = null;

	init() {
		this.addOutputLocationSetting('Airtable');

		// Airtable Personal Access Token, held in Obsidian's keychain so it is
		// remembered between sessions
		this.addSecretSetting('Airtable personal access token', this.createTokenDescription());

		// Everything below is the tree the user picks tables from. An import
		// driven without a dialog sets what it wants directly.
		const contentEl = this.host.contentEl;
		if (!contentEl) return;

		// Load bases and tables button
		const loadSetting = new Setting(contentEl)
			.setName('Select tables to import')
			.setDesc('Load your Airtable bases and tables, then choose what to import.');

		// Toggle select all/none button
		loadSetting.addButton(button => {
			button
				.setButtonText('Select all')
				.onClick(() => {
					if (this.tree.length === 0) {
						new Notice('Please load bases first.');
						return;
					}

					const allSelected = this.areAllNodesSelected();
					this.selectAllNodes(!allSelected);
					this.renderTree();
				});

			this.toggleSelectButton = button;
			button.buttonEl.addClass('importer-tree-button');
			button.buttonEl.hide();

			return button;
		});

		// Load button
		loadSetting.addButton(button => {
			button
				.setButtonText('Load')
				.onClick(async () => {
					try {
						await this.loadTree();
					}
					catch (error) {
						console.error('[Airtable Importer] Error loading tree:', error);
						new Notice(`Failed to load bases: ${extractErrorMessage(error)}`);
					}
				});

			this.loadButton = button;
			button.buttonEl.addClass('importer-tree-button', 'mod-cta');

			return button;
		});

		// Page tree container (using Publish plugin's style with proper hierarchy)
		// Create the section wrapper
		const importSection = contentEl.createDiv();
		importSection.addClass('import-section', 'file-tree', 'publish-section');

		// Create the change list container
		this.treeContainer = importSection.createDiv('publish-change-list');

		// Add placeholder text
		const placeholder = this.treeContainer.createDiv('publish-placeholder');
		placeholder.setText('Load your Airtable bases and tables to get started.');

		// Formula import strategy
		this.addSetting()
			?.setName('Convert formulas')
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
		this.addSetting()
			?.setName('Download attachments')
			.setDesc('Download attachment files to local vault. If disabled or download fails, external URLs will be used.')
			.addToggle(toggle => {
				toggle
					.setValue(true)
					.onChange(value => {
						this.downloadAttachments = value;
					});
			});

		// View property name
		this.addSetting()
			?.setName('View property name')
			.setDesc('Property name to track which views a record belongs to. Each record will have a list of view names it appears in.')
			.addText(text => text
				.setPlaceholder('base')
				.setValue('base')
				.onChange(value => {
					// Stripped rather than escaped: this name is embedded in a
					// double-quoted Bases filter string in the generated .base file
					this.viewPropertyName = value.trim().replace(/["\\]/g, '') || 'base';
				}));

		// Incremental import setting
		this.addSetting()
			?.setName('Incremental import')
			.setDesc('Adds an airtable-id property to records so that future imports can skip records that have already been imported.')
			.addToggle(toggle => toggle
				.setValue(false) // Default to disabled
				.onChange(value => {
					this.incrementalImport = value;
				}));
	}

	private createTokenDescription(): DocumentFragment {
		const frag = createFragment();
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
			new Notice('Please enter your Airtable personal access token first.');
			return;
		}

		this.loadButton.setDisabled(true);
		this.loadButton.setButtonText('Loading...');

		try {
			// Create a minimal status reporter for API calls during tree loading
			const statusReporter = {
				status: (msg: string) => {
					this.loadButton.setButtonText(msg);
				},
			};

			// Fetch all bases
			const bases = await fetchBases(this.airtableToken, statusReporter);

			if (bases.length === 0) {
				new Notice('No bases found. Make sure your token has proper permissions.');
				return;
			}

			// Build the tree from the base list alone. Table schemas cost one API
			// call per base, which on an account with many bases means a minute or
			// more of staring at an empty list, so they are fetched on demand when
			// a base is expanded or selected.
			// Sorted by name: the API returns bases in an order that means nothing
			// here, and an account with dozens of them is otherwise a scavenger
			// hunt. Table order within a base is left alone, since that one is
			// arranged deliberately in Airtable.
			this.tree = bases
				.map(base => ({
					id: base.id,
					title: base.name,
					type: 'base' as const,
					parentId: null,
					children: [],
					selected: false,
					disabled: false,
					collapsed: true,
					tablesLoaded: false,
				}))
				.sort((a, b) => a.title.localeCompare(b.title));

			this.renderTree();

			this.toggleSelectButton.buttonEl.show();

			// Table counts are deliberately absent: schemas are fetched per base on
			// demand, so totalling them here would reintroduce the full scan
			new Notice(`Found ${bases.length} base(s). Expand a base to see its tables.`);
		}
		catch (error) {
			console.error('[Airtable Importer] Failed to load bases:', error);
			new Notice(`Failed to load bases: ${extractErrorMessage(error) ?? 'Unknown error'}`);
		}
		finally {
			this.loadButton.setDisabled(false);
			this.loadButton.setButtonText('Refresh');
		}
	}

	/**
	 * Fetch a base's table schemas, if they have not been fetched already.
	 *
	 * Returns false if the fetch failed, so callers can avoid acting on a base
	 * whose tables are still unknown.
	 */
	private async ensureTablesLoaded(baseNode: AirtableTreeNode, reportTo?: (msg: string) => void): Promise<boolean> {
		if (baseNode.tablesLoaded) {
			return true;
		}

		const statusReporter = {
			// fetchTableSchema reports raw base IDs, which say nothing to the user;
			// keep the base's name on screen instead
			status: () => reportTo?.(`Loading tables for ${baseNode.title}`),
		};

		try {
			statusReporter.status();
			const tables = await fetchTableSchema(baseNode.id, this.airtableToken, statusReporter);

			baseNode.children = tables.map(table => ({
				id: `${baseNode.id}:${table.id}`,
				title: table.name,
				type: 'table' as const,
				parentId: baseNode.id,
				// A table inherits its parent's selection, and inherited selection
				// is shown as checked-but-disabled
				selected: baseNode.selected,
				disabled: baseNode.selected,
				metadata: {
					baseId: baseNode.id,
					tableName: table.name,
					primaryFieldId: table.primaryFieldId,
					fields: table.fields,
					views: table.views,
				},
			}));
			baseNode.tablesLoaded = true;
			return true;
		}
		catch (error) {
			console.error(`[Airtable Importer] Failed to load tables for "${baseNode.title}":`, error);
			new Notice(`Failed to load tables for "${baseNode.title}": ${extractErrorMessage(error) ?? 'Unknown error'}`);
			return false;
		}
	}

	/**
	 * Fetch table schemas for every base the user has selected.
	 *
	 * Selecting a base without expanding it is the common case, so its tables
	 * have to be resolved before the field list or the import can be built.
	 */
	private async ensureSelectedTablesLoaded(report: (msg: string) => void): Promise<void> {
		const pending = this.tree.filter(node => node.selected && !node.tablesLoaded);

		for (let i = 0; i < pending.length; i++) {
			report(`Loading tables (${i + 1}/${pending.length})`);
			await this.ensureTablesLoaded(pending[i], report);
		}
	}

	/**
	 * Render tree UI
	 */
	private renderTree(): void {
		// This container is the scroll box, and emptying it sends it back to the
		// top. Ticking a checkbox re-renders the tree, so without this the list
		// jumps away from whatever the user just clicked.
		const scrollTop = this.treeContainer.scrollTop;

		this.treeContainer.empty();

		if (this.tree.length === 0) {
			this.treeContainer.createDiv({
				text: 'No bases found.',
				cls: 'publish-placeholder'
			});
			return;
		}

		for (const node of this.tree) {
			this.renderTreeNode(this.treeContainer, node);
		}

		this.treeContainer.scrollTop = scrollTop;

		this.updateToggleButtonText();
	}

	/**
	 * Render a single tree node using Obsidian's standard tree structure
	 * Airtable has only two levels: Base (database icon) -> Table (file icon)
	 */
	private renderTreeNode(container: HTMLElement, node: AirtableTreeNode): void {
		// Main tree item container
		const treeItem = container.createDiv('tree-item');

		// Tree item self (contains the node itself)
		const treeItemSelf = treeItem.createDiv('tree-item-self');
		treeItemSelf.addClass('is-clickable');

		// Add appropriate modifiers.
		// A base is always collapsible, even before its tables have been fetched -
		// otherwise a lazily-loaded base would have no arrow to expand.
		const hasChildren = !!(node.children && node.children.length > 0);
		const isCollapsible = node.type === 'base' || hasChildren;
		treeItemSelf.addClass(node.type === 'base' ? 'mod-folder' : 'mod-file');

		// Apply disabled styling. The dimming and pointer handling live in
		// styles.css, keyed off is-disabled.
		treeItemSelf.toggleClass('is-disabled', node.disabled);

		// Collapse/Expand arrow
		if (isCollapsible) {
			treeItemSelf.addClass('mod-collapsible');

			const collapseIcon = treeItemSelf.createDiv('tree-item-icon collapse-icon');

			// Use right-triangle icon (Obsidian's standard)
			setIcon(collapseIcon, 'right-triangle');

			// Add is-collapsed class for CSS control
			collapseIcon.toggleClass('is-collapsed', !!node.collapsed);
			treeItem.toggleClass('is-collapsed', !!node.collapsed);

			// The arrow stays clickable on a disabled row, so an inherited-selection
			// base can still be expanded. Handled in styles.css.

			let childrenContainer: HTMLElement;

			// Toggle collapse state with pure DOM manipulation (no re-render).
			// Expanding a base can fetch, which a listener cannot await, so a
			// failure is logged rather than left as an unhandled rejection.
			collapseIcon.addEventListener('click', (e) => void (async () => {
				e.stopPropagation();
				node.collapsed = !node.collapsed;

				// Expanding a base for the first time fetches its tables. A full
				// re-render is needed afterwards to draw the new child nodes.
				if (!node.collapsed && node.type === 'base' && !node.tablesLoaded) {
					// Obsidian's own spinner: .loader-spinner + the loader-2 icon,
					// the same pairing app.css styles and Sync's modals use.
					// Most bases resolve in a few hundred milliseconds, where a
					// spinner reads as a flicker. Only reveal it if the fetch is
					// still running after a beat.
					const spinner = treeItemSelf.createDiv('loader-spinner');
					setIcon(spinner, 'loader-2');
					spinner.hide();
					const spinnerDelay = window.setTimeout(() => spinner.show(), 250);

					const ok = await this.ensureTablesLoaded(node);

					window.clearTimeout(spinnerDelay);
					spinner.remove();
					if (!ok) {
						node.collapsed = true;
						return;
					}
					this.renderTree();
					return;
				}

				// Get reference if not set yet
				if (!childrenContainer) {
					childrenContainer = treeItem.querySelector('.tree-item-children') as HTMLElement;
				}

				// Toggle CSS classes and visibility
				collapseIcon.toggleClass('is-collapsed', node.collapsed);
				treeItem.toggleClass('is-collapsed', node.collapsed);
				if (childrenContainer) childrenContainer.toggle(!node.collapsed);
			})().catch(err => console.error('Could not expand base', err)));
		}

		// Inner content (checkbox, icon, title)
		const treeItemInner = treeItemSelf.createDiv('tree-item-inner file-tree-item');

		// Checkbox (must set checked/disabled as DOM properties, not HTML attributes)
		const checkbox = treeItemInner.createEl('input', {
			type: 'checkbox',
			cls: 'file-tree-item-checkbox',
		});
		checkbox.checked = node.selected;
		checkbox.disabled = node.disabled;

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
				this.renderTreeNode(childrenContainer, child);
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
		// Compared rather than tested for truthiness: Obsidian components carry a
		// then() for chaining, which makes a bare `if (component)` look to
		// typescript-eslint like testing a promise.
		if (this.toggleSelectButton === undefined) {
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
		if (this.getSelectedNodes().length === 0) {
			new Notice('Please select at least one table to import.');
			return false;
		}

		// A base can be selected without ever being expanded, so its tables may
		// not have been fetched yet. Resolve them before reading any field lists.
		//
		// Report into the modal rather than onto the Load button: by this point
		// the modal has cleared the previous screen and that button is detached,
		// so its text would go nowhere and leave an empty dialog on screen.
		const loadingEl = container.createDiv('importer-loading');
		setIcon(loadingEl.createDiv('loader-spinner'), 'loader-2');
		const loadingTextEl = loadingEl.createDiv();
		loadingTextEl.setText('Loading fields...');

		await this.ensureSelectedTablesLoaded(msg => loadingTextEl.setText(msg));

		loadingEl.remove();

		// Loading a base's tables only adds children that inherit its selection as
		// checked-but-disabled, which getSelectedNodes filters out, so the
		// selection checked above still holds
		const selectedNodes = this.getSelectedNodes();

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

		// Every field becomes a property, which the user can then pare back
		const { propertyNames, propertyValues } = defaultPropertyConfig(allFieldsMap.values(), this.viewPropertyName);

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
		// The select types are the only ones that can show the user their own data
		switch (field.type) {
			case 'singleSelect':
				return field.options?.choices?.[0]?.name || 'Option 1';
			case 'multipleSelects':
				return field.options?.choices?.slice(0, 2).map((c: { name: string }) => c.name).join(', ') || 'Option 1, Option 2';
		}

		return EXAMPLE_VALUE_FOR_FIELD_TYPE[field.type] ?? 'Value';
	}

	/**
	 * The property name a field's value is written under.
	 *
	 * The template configurator lets the user rename any property, so the .base
	 * file has to reference the name the user chose rather than the Airtable
	 * field name - otherwise renaming a property silently leaves the generated
	 * views pointing at a property no note has.
	 */
	private propertyNameForField(fieldName: string): string {
		const configured = this.templateConfig?.propertyNames.get(fieldName);
		return sanitizePropertyName(configured || fieldName);
	}

	/**
	 * The fields of one table that get written as frontmatter properties, paired
	 * with the property name each is written under.
	 */
	private frontMatterFieldsForTable(
		fields: AirtableFieldSchema[],
		primaryFieldName: string
	): Array<{ fieldName: string, propertyName: string }> {
		if (!this.templateConfig) return [];

		return frontMatterFieldsForTable({
			fields,
			primaryFieldName,
			propertyNames: this.templateConfig.propertyNames,
			propertyValues: this.templateConfig.propertyValues,
			viewPropertyName: this.viewPropertyName,
			propertyNameForField: fieldName => this.propertyNameForField(fieldName),
		});
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.airtableToken) {
			new Notice('Please enter your Airtable personal access token.');
			return;
		}

		// Set before the first await: the progress UI is already on screen by now,
		// and without this its status line sits blank above a row of zeros
		ctx.status('Connecting to Airtable API');

		// Normally already done by showTemplateConfiguration; repeated here because
		// a base selected but never expanded has no tables to import otherwise
		await this.ensureSelectedTablesLoaded(msg => ctx.status(msg));

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

		try {
			// Initialize global data that persists across bases
			this.recordIdToPath.clear();
			this.pendingLinkFiles = [];
			this.allFieldsForTypeInference.clear();
			this.processedRecordsCount = 0;
			this.totalRecordsToImport = 0;
			this.basesFetched = 0;
			this.lastBaseFilePath = null;

			// Drop SDK handles from any previous run - the token may have changed
			this.airtableClient = null;
			this.airtableBases.clear();

			// Group selected nodes by base
			const baseGroups = this.groupSelectedNodesByBase(selectedNodes);
			const totalBases = baseGroups.size;
			this.totalBasesToImport = totalBases;

			ctx.status(`Found ${totalBases} base(s) to import`);

			// Process each base sequentially to minimize memory usage
			let baseIndex = 0;
			for (const [, baseInfo] of baseGroups.entries()) {
				if (ctx.isCancelled()) {
					ctx.status('Import cancelled');
					return;
				}

				baseIndex++;
				this.basePosition = totalBases > 1 ? ` (base ${baseIndex} of ${totalBases})` : '';

				// Clear data from previous base to free memory
				this.clearBaseData();

				ctx.status(`Fetching data from ${baseInfo.baseName}${this.basePosition}`);

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
					ctx.status('Import cancelled');
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
				finally {
					// PHASE 3: turn linked-record placeholders into real links.
					// In a finally, and not honouring cancellation, because notes
					// are written with placeholder text: skipping this after a
					// stopped or failed run would leave that raw text in the vault.
					ctx.status(`Resolving linked records in ${baseInfo.baseName}${this.basePosition}`);
					await this.resolveRecordLinks();
				}
			}

			// Update property types in Obsidian's types.json
			ctx.status('Updating property types');
			this.updatePropertyTypes();

			ctx.status('Import complete');

			// Leave the user looking at what they imported. Opens behind the
			// modal, so it is waiting for them once they dismiss it.
			await this.openLastBaseFile();
		}
		catch (error) {
			console.error('Airtable API import error:', error);
			ctx.reportFailed('Airtable API import', error);
			new Notice(`Import failed: ${extractErrorMessage(error)}`);
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
	 * - allFieldsForTypeInference: needed for updatePropertyTypes at the end
	 */
	private clearBaseData(): void {
		// These are cleared per-base to free memory
		this.globalFieldIdToNameMap.clear();
		this.globalRecordIdToTitle.clear();
		this.preparedData = [];

		// Record counters are deliberately not reset: progress is reported across
		// the whole import, not per base
	}

	/**
	 * Fetch all data for a single base
	 */
	private async fetchBaseData(
		ctx: ImportContext,
		baseInfo: BaseGroupInfo
	): Promise<void> {
		const { baseId, baseName, tables } = baseInfo;

		// Fetch data for each table in this base
		for (const table of tables) {
			if (ctx.isCancelled()) return;

			// Update status context
			ctx.status(`Fetching records from ${table.tableName}${this.basePosition}`);

			await this.fetchTableData(ctx, {
				baseId,
				baseName,
				tableName: table.tableName,
				primaryFieldId: table.primaryFieldId,
				fields: table.fields,
				views: table.views,
			});
		}

		// This base's records are now counted, so the estimate tightens
		this.basesFetched++;
		ctx.status(`Preparing records from ${baseName}${this.basePosition}`);
		this.reportOverallProgress(ctx);
	}

	/**
	 * Report progress across the whole import rather than the current base.
	 *
	 * Records are fetched one base at a time, so while bases remain unfetched
	 * the true total is unknown. Padding the denominator with an estimate for
	 * those bases keeps the bar from reading as complete when there is still a
	 * base to go, and the estimate disappears once the last base is counted.
	 */
	private reportOverallProgress(ctx: ImportContext): void {
		const basesLeft = Math.max(0, this.totalBasesToImport - this.basesFetched);
		const averagePerBase = this.basesFetched > 0
			? Math.round(this.totalRecordsToImport / this.basesFetched)
			: 0;
		const estimatedTotal = this.totalRecordsToImport + basesLeft * averagePerBase;

		ctx.reportProgress(this.processedRecordsCount, estimatedTotal);
	}

	/**
	 * Create files for a single base
	 */
	private async createFilesForBase(
		ctx: ImportContext,
		rootPath: string
	): Promise<void> {
		// Process each table's prepared data
		for (const tableData of this.preparedData) {
			if (ctx.isCancelled()) return;

			// Update status context
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
		ctx.status(`Fetching records from ${tableName}${this.basePosition}`);

		const allRecords = await selectRecords(this.getAirtableBase(baseId), tableName, {
			// Callback to update progress during fetch
			onProgress: (fetched: number) => {
				ctx.status(`Fetched ${fetched} record(s) from ${tableName}${this.basePosition}`);
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
			ctx.status(`Fetching view ${view.name} from ${tableName}${this.basePosition}`);

			// Fetch only record IDs from this view
			const viewRecordIds = await this.fetchViewRecordIds(baseId, tableName, view, ctx);

			// Build view reference with full path to avoid ambiguity
			// e.g., [[BaseName/TableName.base#Grid view]]
			// Sanitize view name for wiki link compatibility
			const sanitizedViewName = sanitizeViewName(view.name);
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
		this.preparedData.push({
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
		ctx.status(`Creating notes in ${tableName}${this.basePosition}`);

		// Derived once and shared by the .base file and every record in the table
		const formulas = this.computeTableFormulas(fields, primaryFieldId);
		const formulaFieldNames = new Set(formulas.keys());
		const frontMatterFields = this.frontMatterFieldsForTable(fields, primaryFieldName);

		// Create .base file first
		await this.createBaseFile({
			tableFolderPath: tablePath,
			tableName,
			views,
			fields,
			primaryFieldId,
			formulas,
		});

		if (ctx.isCancelled()) return;

		// Create files for all records
		// Note: Using globalRecordIdToTitle for resolving linked records across tables
		for (const record of records) {
			if (ctx.isCancelled()) return;

			try {
				const viewReferences = recordViewMemberships.get(record.id) || [];
				await this.createRecordFile(ctx, record, {
					baseId,
					tablePath,
					primaryFieldName,
					fields,
					viewReferences,
					formulaFieldNames,
					frontMatterFields,
				});
			}
			catch (error) {
				const recordTitle = String(record.fields?.[primaryFieldName] ?? 'Untitled Record');
				ctx.reportFailed(recordTitle, error);
				this.processedRecordsCount++;
				this.reportOverallProgress(ctx);
			}

		}
		// No per-record status update: the text would be identical every time,
		// and the progress bar and counters below it already move per record.
	}

	/**
	 * The columns a view shows, in the order it shows them.
	 *
	 * Airtable reports this per view as visibleFieldIds, but only for grid
	 * views; a gallery or kanban view gets every column instead, which is what
	 * the table as a whole offers.
	 *
	 * visibleFieldIds does list the primary field, but it has no column of its
	 * own here - file.name stands in for it - so the lookup drops it and
	 * file.name is put back at the front, where Airtable also shows it.
	 */
	/**
	 * Open the last .base file the import wrote.
	 *
	 * Best effort: a failure here has no bearing on whether the import
	 * succeeded, so it is reported to the console and otherwise ignored.
	 */
	private async openLastBaseFile(): Promise<void> {
		if (!this.lastBaseFilePath) {
			return;
		}

		try {
			const file = this.vault.getAbstractFileByPath(this.lastBaseFilePath);
			if (file instanceof TFile) {
				// New tab rather than the active one, so whatever the user had
				// open is left where it was
				await this.app.workspace.getLeaf(true).openFile(file);

				// Opening a file does not move the navigation tree, so without this
				// the import gives no indication of where in the vault it landed
				this.revealInFileExplorer(file);
			}
		}
		catch (error) {
			console.error(`Failed to open base file: ${this.lastBaseFilePath}`, error);
		}
	}

	/**
	 * Expand the file explorer to a file and scroll it into view.
	 *
	 * This is what the "Reveal file in navigation" command does. Neither the
	 * command registry nor the file explorer view is exported in obsidian.d.ts,
	 * so the view's method is reached through a cast; doing nothing is an
	 * acceptable outcome if it is unavailable or the explorer is closed.
	 */
	private revealInFileExplorer(file: TFile): void {
		const explorerView = this.app.workspace.getLeavesOfType('file-explorer').first()?.view as
			{ revealInFolder?(file: TFile): void } | undefined;

		explorerView?.revealInFolder?.(file);
	}

	/**
	 * Get a cached Airtable SDK handle for a base
	 */
	private getAirtableBase(baseId: string): any {
		if (!this.airtableClient) {
			this.airtableClient = new Airtable({ apiKey: this.airtableToken });
		}

		let base = this.airtableBases.get(baseId);
		if (!base) {
			base = this.airtableClient.base(baseId);
			this.airtableBases.set(baseId, base);
		}
		return base;
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
		try {
			// Request no fields, only IDs (minimal data transfer)
			const records = await selectRecords(this.getAirtableBase(baseId), tableName, {
				view: view.id,
				fields: [],
			});
			return records.map(r => r.id);
		}
		catch (error) {
			ctx.reportFailed(`${tableName} > ${view.name}`, error);
			return [];
		}
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
		const { tablePath, primaryFieldName, fields, viewReferences, formulaFieldNames, frontMatterFields } = fileContext;
		const recordId = record.id;

		if (isEmptyRecord(record)) {
			ctx.reportSkipped('Untitled Record', 'Empty record');
			this.processedRecordsCount++;
			this.reportOverallProgress(ctx);
			return;
		}

		let sanitizedTitle = sanitizeFileName(recordTitle(record, primaryFieldName));
		let filePath = normalizePath(`${tablePath}/${sanitizedTitle}.md`);

		// Incremental import: a record already on disk under this id needs no work
		if (await this.shouldSkipExistingRecord(filePath, recordId)) {
			ctx.reportSkipped(sanitizedTitle, 'Already imported');
			this.processedRecordsCount++;
			this.reportOverallProgress(ctx);
			return;
		}

		const { content: fileContent, hasRecordLinks } = await buildRecordNote(record, {
			baseId: fileContext.baseId,
			fields,
			primaryFieldName,
			viewReferences,
			viewPropertyName: this.viewPropertyName,
			formulaFieldNames,
			frontMatterFields,
			recordId: this.incrementalImport,
			bodyTemplate: this.templateConfig?.bodyTemplate,
			resolveAttachments: attachments => downloadAttachmentList(attachments, {
				ctx,
				vault: this.vault,
				downloadAttachments: this.downloadAttachments,
				getAvailableAttachmentPath: async (filename: string) => {
					// Pass the note being written, so the "same folder as current
					// file" and "in subfolder under current folder" settings put
					// attachments beside their note rather than the output root
					return await this.getAvailablePathForAttachment(filename, [], filePath);
				},
			}),
			formatAttachmentsForBody: results => formatAttachmentsForBody(results, {
				currentFilePath: filePath,
				vault: this.vault,
				app: this.app,
			}),
			formatAttachmentsForYAML,
		});

		// Ask the vault for a free path rather than testing for a conflict
		// first: it hands back the desired path when nothing occupies it, and
		// compares case-insensitively, so two records titled "Tron" and "TRON"
		// no longer resolve to one file that the second fails to create.
		const availablePath = getUniqueFilePath(this.vault, tablePath, `${sanitizedTitle}.md`);
		if (availablePath !== filePath) {
			filePath = availablePath;
			// Update sanitizedTitle to match the new file name (without .md)
			const { basename } = parseFilePath(filePath);
			sanitizedTitle = basename;
			// Keep the title map in step with the rename. Links resolve through
			// recordIdToPath, so this only affects the not-imported fallback and
			// the names shown in progress/skip reporting.
			this.globalRecordIdToTitle.set(recordId, sanitizedTitle);
		}

		// Create the file
		await this.vault.create(filePath, fileContent);

		// Use baseId:recordId as key to ensure uniqueness across bases (recordId is only unique within a base)
		const uniqueKey = `${fileContext.baseId}:${recordId}`;
		this.recordIdToPath.set(uniqueKey, filePath.replace(/\.md$/, ''));

		if (hasRecordLinks) {
			this.pendingLinkFiles.push(filePath);
		}

		ctx.reportNoteSuccess(sanitizedTitle);

		this.processedRecordsCount++;
		this.reportOverallProgress(ctx);
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
	private async shouldSkipExistingRecord(filePath: string, recordId: string): Promise<boolean> {
		if (!this.incrementalImport) {
			return false;
		}

		const file = this.vault.getAbstractFileByPathInsensitive(filePath);
		if (!file || !(file instanceof TFile)) {
			return false;
		}

		// Parse the content rather than the metadata cache. A cold cache would
		// report no frontmatter, which reads as "not yet imported" and silently
		// turns an incremental import back into a full one.
		try {
			const parsed = parseFrontMatterBlock(await this.vault.read(file));
			return parsed?.frontMatter['airtable-id'] === recordId;
		}
		catch (error) {
			console.error(`Failed to read frontmatter from: ${filePath}`, error);
			return false;
		}
	}

	/**
	 * Replace linked-record placeholders with links to the records' final paths.
	 *
	 * Runs once a base's files have all been written, so a link is never left
	 * pointing at a title that a later filename conflict renamed. Records that
	 * were not imported (a table the user did not select, or a record skipped as
	 * empty) have no path and degrade to their plain title.
	 *
	 * Runs per base because Airtable record IDs are only unique within a base,
	 * and because globalRecordIdToTitle is cleared between bases.
	 *
	 * Deliberately ignores cancellation: it only touches notes that have already
	 * been written, and every one of those contains placeholder text until this
	 * runs. Bailing out early would leave "[[airtable-record:...]]" in the vault.
	 */
	private async resolveRecordLinks(): Promise<void> {
		// Only the notes the write phase recorded as carrying a placeholder, so a
		// base where few records link does not cost a read of every note.
		const pending = this.pendingLinkFiles;
		this.pendingLinkFiles = [];

		for (const filePath of pending) {
			try {
				const file = this.vault.getAbstractFileByPath(filePath);
				if (!(file instanceof TFile)) {
					continue;
				}

				const content = await this.vault.read(file);
				const resolved = content.replace(
					RECORD_LINK_PLACEHOLDER_PATTERN,
					(_match, baseId: string, recordId: string) => {
						const targetPath = this.recordIdToPath.get(`${baseId}:${recordId}`);
						if (targetPath) {
							const target = this.vault.getAbstractFileByPath(`${targetPath}.md`);
							if (target instanceof TFile) {
								// Shortest form that still resolves: Obsidian falls back
								// to a full path only where the name is not unique, so
								// most links read as [[Electronics]] rather than
								// [[Airtable/Belongings/Categories/Electronics]]
								return `[[${this.app.metadataCache.fileToLinktext(target, file.path)}]]`;
							}
							return `[[${targetPath}]]`;
						}
						// Not imported - fall back to the record's title if we saw it
						const title = this.globalRecordIdToTitle.get(recordId);
						return title ? sanitizeFileName(title) : `Unknown record ${recordId}`;
					}
				);

				if (resolved !== content) {
					await this.vault.modify(file, resolved);
				}
			}
			catch (error) {
				console.error(`Failed to resolve linked records in: ${filePath}`, error);
			}
		}
	}

	/**
	 * Create a single .base file for the table with multiple views
	 */
	/**
	 * Which of a table's fields the .base file computes, and the formula for each.
	 *
	 * Derived once per table and used twice: the .base file writes these formulas,
	 * and the record writer omits the same fields from note frontmatter because
	 * the .base recomputes them.
	 */
	private computeTableFormulas(fields: AirtableFieldSchema[], primaryFieldId: string): Map<string, string> {
		if (this.formulaStrategy === 'static') {
			return new Map();
		}

		return computeTableFormulas({
			fields,
			primaryFieldId,
			fieldNameById: this.globalFieldIdToNameMap,
			propertyNameForField: fieldName => this.propertyNameForField(fieldName),
		});
	}

	/**
	 * Create a single .base file for the table with multiple views
	 */
	private async createBaseFile(ctx: BaseFileContext): Promise<void> {
		const { tableName } = ctx;

		const { path: baseFilePath, config: baseConfig } = buildBaseFile({
			...ctx,
			viewPropertyName: this.viewPropertyName,
			propertyNameForField: fieldName => this.propertyNameForField(fieldName),
		});

		// Create or update the .base file
		try {
			const content = stringifyYaml(baseConfig);

			// Check if file already exists
			const existingFile = this.vault.getAbstractFileByPathInsensitive(baseFilePath);

			if (existingFile && existingFile instanceof TFile) {
				// File exists - update it by merging views
				const existingContent = await this.vault.read(existingFile);

				// Parse existing YAML to extract existing views (Obsidian Bases internal format)
				try {
					const existingConfig = parseYaml(existingContent);
					const existingViews = existingConfig.views || [];

					// Merge new views with existing ones (avoid duplicates by view name)
					const viewMap = new Map();
					for (const view of existingViews) {
						viewMap.set(view.name, view);
					}
					for (const view of baseConfig.views ?? []) {
						viewMap.set(view.name, view); // Override if exists
					}

					// Update config with merged views
					baseConfig.views = Array.from(viewMap.values());

					// Write updated content
					const updatedContent = stringifyYaml(baseConfig);
					await this.vault.modify(existingFile, updatedContent);
				}
				catch {
					// If parsing fails, just overwrite
					await this.vault.modify(existingFile, content);
				}
			}
			else {
				// File doesn't exist - create it
				await this.vault.create(baseFilePath, content);
			}

			// Remembered so the import can leave the user looking at a base
			this.lastBaseFilePath = baseFilePath;
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
			const obsidianType = mapAirtableTypeToObsidian(field.type);
			if (obsidianType) {
				propertyTypes[propertyName] = obsidianType;
			}
		}

		updatePropertyTypes(this.app, propertyTypes);
	}


}

