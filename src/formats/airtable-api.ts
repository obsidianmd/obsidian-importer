/**
 * Airtable API Importer
 * Imports tables and records from Airtable using the API
 */

import { ButtonComponent, Notice, Setting, normalizePath, TFile, setIcon, stringifyYaml, parseYaml } from 'obsidian';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { parseFilePath } from '../filesystem';
import { extractErrorMessage, sanitizeFileName, getUniqueFilePath, updatePropertyTypes, plural } from '../util';
import { areAllSelected, areAnySelected, redrawTree, setAllSelection } from '../tree';
import { renderTreeNodes, showTreePlaceholder } from '../tree-view';
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
import { buildBaseFile, sanitizePropertyName } from './airtable-api/base-file';
import { mapAirtableTypeToObsidian } from './airtable-api/field-converter';
import { computeTableFormulas } from './airtable-api/table-formulas';
import {
	buildRecordNote,
	defaultPropertyConfig,
	frontMatterFieldsForTable,
	isEmptyRecord,
	RECORD_ID_PROPERTY,
	recordTitle,
} from './airtable-api/record-note';
import type {
	AirtableTreeNode,
	AirtableViewInfo,
	AirtableFieldSchema,
	AirtableRecord,
	PreparedTableData,
	RecordFileContext,
	BaseFileContext,
	BaseGroupInfo,
	PlannedRecord,
	TablePlan,
} from './airtable-api/types';

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

export class AirtableAPIImporter extends FormatImporter {
	interruption = 'pause' as const;

	/** Resolved from the keychain on each read, so unlinking the secret takes effect immediately */
	get airtableToken(): string {
		return this.getSecret() ?? '';
	}

	/** Nothing to import until some of the loaded tables have been ticked. */
	get sourceReady(): boolean {
		return areAnySelected(this.tree);
	}

	formulaStrategy: FormulaImportStrategy = 'hybrid';
	downloadAttachments: boolean = true;
	viewPropertyName: string = 'Views'; // Property name to track which views a record belongs to
	/** Whether a note carries airtable-id, and an import may skip one it wrote. */
	get incrementalImport(): boolean {
		return this.duplicateHandling !== DuplicateHandling.CreateCopy;
	}

	// Tree for base/table selection
	private tree: AirtableTreeNode[] = [];
	private treeContainer: HTMLElement;
	private loadButton: ButtonComponent;
	private toggleSelectButton: ButtonComponent;

	// Tracking data
	private recordIdToPath: Map<string, string> = new Map(); // baseId:recordId -> file path (recordId only unique within base)
	/**
	 * Note names that [[Name]] alone resolves to, lowercased. Worked out once
	 * the whole plan is known; see chooseLinkForms.
	 */
	private uniqueBasenames: Set<string> = new Set();
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
		const contentEl = this.host.sourceEl;
		if (!contentEl) return;

		// Load bases and tables button
		const loadSetting = new Setting(contentEl)
			.setName('Tables to import')
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

					const allSelected = areAllSelected(this.tree);
					setAllSelection(this.tree, !allSelected);
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

		showTreePlaceholder(this.treeContainer, 'Load your Airtable bases and tables to get started.');

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
				.setPlaceholder('Views')
				.setValue('Views')
				.onChange(value => {
					// Stripped rather than escaped: this name is embedded in a
					// double-quoted Bases filter string in the generated .base file
					this.viewPropertyName = value.trim().replace(/["\\]/g, '') || 'Views';
				}));

		// Airtable skips a record it wrote before, but does not compare times
		this.addDuplicateHandlingSetting({ idProperty: RECORD_ID_PROPERTY, modes: [DuplicateHandling.Skip, DuplicateHandling.CreateCopy] });
	}

	private createTokenDescription(): DocumentFragment {
		const frag = createFragment();
		frag.appendText('Create a personal access token in your Airtable account settings. ');
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
			// Where the tree is about to appear, rather than in the button: these
			// are sentences, and a button grows to fit whatever it is given
			const statusReporter = {
				status: (msg: string) => showTreePlaceholder(this.treeContainer, msg),
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
			new Notice(`Found ${plural(bases.length, 'base')}. Expand a base to see its tables.`);
		}
		catch (error) {
			console.error('[Airtable Importer] Failed to load bases:', error);
			new Notice(`Failed to load bases: ${extractErrorMessage(error) ?? 'Unknown error'}`);
		}
		finally {
			// No longer the thing to do, now that there is a tree to pick from
			this.loadButton.setDisabled(false);
			this.loadButton.setButtonText('Refresh').removeCta();
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
					tableId: table.id,
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
		redrawTree(this.treeContainer, () => {
			if (this.tree.length === 0) {
				this.treeContainer.createDiv({
					text: 'No bases found.',
					cls: 'publish-placeholder'
				});
				return;
			}

			renderTreeNodes(this.treeContainer, this.tree, {
				icon: node => node.type === 'base' ? 'database' : 'file',
				// A base is collapsible before its tables are known, because
				// expanding one is what fetches them
				isCollapsible: node => node.type === 'base' || !!node.children?.length,
				onExpand: (node, rowEl) => this.loadTablesForExpand(node, rowEl),
				redraw: () => this.renderTree(),
			});
		});

		this.updateToggleButtonText();
		this.sourceChanged();
	}

	/**
	 * Render a single tree node using Obsidian's standard tree structure
	 * Airtable has only two levels: Base (database icon) -> Table (file icon)
	 */
	/**
	 * Fetch a base's tables the first time it is opened.
	 *
	 * Says whether the tree gained anything, which is what asks for it to be
	 * drawn again. A base that could not be read is left closed.
	 */
	private async loadTablesForExpand(node: AirtableTreeNode, rowEl: HTMLElement): Promise<boolean> {
		if (node.type !== 'base' || node.tablesLoaded) return false;

		// Obsidian's own spinner: .loader-spinner + the loader-2 icon, the same
		// pairing app.css styles and Sync's modals use. Most bases resolve in a
		// few hundred milliseconds, where a spinner reads as a flicker. Only
		// reveal it if the fetch is still running after a beat.
		const spinner = rowEl.createDiv('loader-spinner');
		setIcon(spinner, 'loader-2');
		spinner.hide();
		const spinnerDelay = window.setTimeout(() => spinner.show(), 250);

		const ok = await this.ensureTablesLoaded(node);

		window.clearTimeout(spinnerDelay);
		spinner.remove();

		if (!ok) {
			node.collapsed = true;
			return false;
		}

		return true;
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
		const allSelected = areAllSelected(this.tree);
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
			this.uniqueBasenames.clear();
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

			ctx.status(`Found ${plural(totalBases, 'base')} to import`);

			// Process each base sequentially to minimize memory usage
			let baseIndex = 0;
			for (const [, baseInfo] of baseGroups.entries()) {
				if (await ctx.shouldStop()) {
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

				if (await ctx.shouldStop()) {
					ctx.status('Import cancelled');
					return;
				}

				// ============================================================
				// PHASE 2: Plan every path, then write the files
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
						tableId: tableNode.metadata?.tableId ?? '',
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
					tableId: node.metadata?.tableId ?? '',
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
			if (await ctx.shouldStop()) return;

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

		await this.fetchLinkedRecordTitles(ctx, baseInfo);

		// This base's records are now counted, so the estimate tightens
		this.basesFetched++;
		ctx.status(`Preparing records from ${baseName}${this.basePosition}`);
		this.reportOverallProgress(ctx);
	}

	/**
	 * Learn the titles of records in tables this import is leaving out.
	 *
	 * A link field carries record ids and nothing else, so the only way to know
	 * what one is called is to ask the table it lives in. Where the user left
	 * that table out - importing a single table of a base, most often - the link
	 * has no note to reach and the note gets the title as text instead. Without
	 * this the note would get the raw record id.
	 *
	 * Reads the primary field alone, so it is one paginated pass per linked
	 * table and no more of the table than the titles. Nothing is written.
	 *
	 * Best effort: a table that cannot be read is reported and skipped, leaving
	 * its records to fall back to their ids, which is worse to read but is not
	 * wrong and is not worth failing an import over.
	 */
	private async fetchLinkedRecordTitles(ctx: ImportContext, baseInfo: BaseGroupInfo): Promise<void> {
		const { baseId, tables } = baseInfo;
		const imported = new Set(tables.map(table => table.tableId));

		// Every table the selection links out to, which is what has no note
		const linkedTableIds = new Set<string>();
		for (const table of tables) {
			for (const field of table.fields) {
				const linkedTableId = field.options?.linkedTableId;
				if (linkedTableId && !imported.has(linkedTableId)) {
					linkedTableIds.add(linkedTableId);
				}
			}
		}

		if (linkedTableIds.size === 0) return;

		// The whole base's schema, which the tree already holds: the user picked
		// what to import out of it, so the tables they did not pick are here too
		const schema = this.tree.find(node => node.id === baseId)?.children ?? [];

		for (const tableId of linkedTableIds) {
			if (await ctx.shouldStop()) return;

			const table = schema.find(node => node.metadata?.tableId === tableId);
			const fields = table?.metadata?.fields ?? [];
			const primaryFieldName = fields.find(field => field.id === table?.metadata?.primaryFieldId)?.name;
			if (!primaryFieldName) continue;

			const tableName = table?.metadata?.tableName ?? tableId;
			ctx.status(`Reading names from ${tableName}${this.basePosition}`);

			try {
				const records = await selectRecords(this.getAirtableBase(baseId), tableId, {
					fields: [primaryFieldName],
				});

				for (const record of records) {
					this.globalRecordIdToTitle.set(record.id, recordTitle(record, primaryFieldName));
				}
			}
			catch (error) {
				console.error(`Failed to read record names from linked table "${tableName}":`, error);
				ctx.reportSkipped(`Linked table: ${tableName}`, 'Could not read record names');
			}
		}
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
		// Every path in the base is settled first, so each note can be written
		// once with real links in it. Resolving links afterwards instead meant
		// reading back and rewriting every note that had one, and rewriting a
		// note costs about what writing it did.
		const plans = await this.planRecordPaths(ctx, rootPath);
		if (await ctx.shouldStop()) return;

		for (const plan of plans) {
			if (await ctx.shouldStop()) return;

			await this.createFilesForTable(ctx, plan);
		}
	}

	/**
	 * Decide where every record in the base goes, before writing anything.
	 *
	 * A note can only carry a link to another record if that record's path is
	 * already known, and a path is not known until a title collision has been
	 * settled - two records called "Tron" cannot both be Tron.md. Doing the
	 * whole base up front is what makes both true at once.
	 *
	 * Fills recordIdToPath, which is what links resolve through, and leaves the
	 * records grouped by table for the write pass that follows.
	 */
	private async planRecordPaths(ctx: ImportContext, rootPath: string): Promise<TablePlan[]> {
		const plans: TablePlan[] = [];

		// Paths this plan has handed out. The vault only knows files that exist,
		// and none of these do yet, so it cannot keep two records off one path.
		const claimed = new Set<string>();

		for (const tableData of this.preparedData) {
			if (await ctx.shouldStop()) return plans;

			const { baseId, baseName, tableName, primaryFieldId, fields, records } = tableData;
			const primaryFieldName = fields.find(f => f.id === primaryFieldId)?.name || fields[0]?.name;

			const tablePath = baseName
				? normalizePath(`${rootPath}/${sanitizeFileName(baseName)}/${sanitizeFileName(tableName)}`)
				: normalizePath(`${rootPath}/${sanitizeFileName(tableName)}`);

			ctx.status(`Working out where ${tableName}${this.basePosition} goes`);

			const planned: PlannedRecord[] = [];

			for (const record of records) {
				if (await ctx.shouldStop()) return plans;

				// Nothing in any field: no note, and links to it fall back to a
				// title, which is why it claims no path
				if (isEmptyRecord(record)) {
					planned.push({ record, filePath: '', title: 'Untitled Record', skipped: 'Empty record' });
					continue;
				}

				const title = sanitizeFileName(recordTitle(record, primaryFieldName));
				const desiredPath = normalizePath(`${tablePath}/${title}.md`);

				// Incremental import: a record already on disk under this id keeps
				// the path it is already at - it is still something to link to -
				// and its note is left alone.
				if (await this.shouldSkipExistingRecord(desiredPath, record.id)) {
					claimed.add(desiredPath.toLowerCase());
					this.recordIdToPath.set(`${baseId}:${record.id}`, desiredPath.replace(/\.md$/, ''));
					planned.push({ record, filePath: desiredPath, title, skipped: 'Already imported' });
					continue;
				}

				const filePath = this.claimRecordPath(tablePath, title, claimed);
				const { basename } = parseFilePath(filePath);

				this.recordIdToPath.set(`${baseId}:${record.id}`, filePath.replace(/\.md$/, ''));
				// Keep the title map in step with a rename. Links resolve through
				// recordIdToPath, so this only affects the text a link to a record
				// with no note falls back to, and the names shown in reporting.
				this.globalRecordIdToTitle.set(record.id, basename);

				planned.push({ record, filePath, title: basename });
			}

			plans.push({ tableData, tablePath, records: planned });
		}

		this.chooseLinkForms();

		return plans;
	}

	/**
	 * A path for this record that no other record in the plan has taken.
	 *
	 * getAvailablePath keeps it off a file that already exists and compares
	 * case-insensitively, so "Tron" and "TRON" do not collapse into one file.
	 * It cannot know about the rest of the plan, though, because none of it is
	 * written yet - hence claimed.
	 */
	private claimRecordPath(tablePath: string, title: string, claimed: Set<string>): string {
		let path = getUniqueFilePath(this.vault, tablePath, `${title}.md`);

		for (let suffix = 1; claimed.has(path.toLowerCase()); suffix++) {
			path = getUniqueFilePath(this.vault, tablePath, `${title} ${suffix}.md`);
		}

		claimed.add(path.toLowerCase());
		return path;
	}

	/**
	 * Which notes can be linked to by name alone.
	 *
	 * Obsidian resolves [[Name]] to the one file called Name, so where a name
	 * belongs to a single note the link can be short. Where it does not - two
	 * records that sanitised to the same name in different tables, or a note the
	 * user already had - the full path is used instead, which always resolves.
	 *
	 * This is what fileToLinktext worked out per link when links were resolved
	 * after the fact. It cannot be used here because it needs the file to exist.
	 */
	private chooseLinkForms(): void {
		const timesUsed = new Map<string, number>();
		for (const path of this.recordIdToPath.values()) {
			const basename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
			timesUsed.set(basename, (timesUsed.get(basename) ?? 0) + 1);
		}

		this.uniqueBasenames.clear();

		for (const path of this.recordIdToPath.values()) {
			const basename = path.slice(path.lastIndexOf('/') + 1);
			if (timesUsed.get(basename.toLowerCase()) !== 1) continue;

			// A note the user already had under this name would make the short
			// form ambiguous. One sitting at the path being planned is this
			// import's own, from a previous run, so it is not a clash.
			const existing = this.app.metadataCache.getFirstLinkpathDest(basename, '');
			if (existing && existing.path !== `${path}.md`) continue;

			this.uniqueBasenames.add(basename.toLowerCase());
		}
	}

	/**
	 * What a link to this record should say, or null where no note is written
	 * for it and the reader gets its name as text instead.
	 */
	private linkTextForRecord(baseId: string, recordId: string): string | null {
		const path = this.recordIdToPath.get(`${baseId}:${recordId}`);
		if (!path) return null;

		const basename = path.slice(path.lastIndexOf('/') + 1);
		return this.uniqueBasenames.has(basename.toLowerCase()) ? basename : path;
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

		if (await ctx.shouldStop()) return;

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
				ctx.status(`Fetched ${plural(fetched, 'record')} from ${tableName}${this.basePosition}`);
			},
		});

		if (await ctx.shouldStop()) return;

		// Build global record ID to title mapping (for resolving linked records across tables)
		for (const record of allRecords) {
			const recordFields = record.fields || {};
			const primaryFieldValue = recordFields[primaryFieldName];
			const title = primaryFieldValue ? String(primaryFieldValue) : 'Untitled Record';
			this.globalRecordIdToTitle.set(record.id, title);
		}

		// Step 2: Fetch view memberships for each record.
		// Held as view ids: what a note says to be picked up by a view is the
		// other half of the filter in the .base file, and that is settled in
		// buildBaseFile so the two cannot disagree.
		const recordViewMemberships = new Map<string, string[]>();
		const viewsShowingEveryRecord = new Set<string>();

		// Compared over the records that become notes, not everything the table
		// returned: a record with nothing in it is written as no note at all, so
		// a view is still "all of them" without it.
		const emptyRecordIds = new Set<string>(
			(allRecords as AirtableRecord[]).filter(isEmptyRecord).map(record => record.id)
		);
		const noteCount = allRecords.length - emptyRecordIds.size;

		for (const view of supportedViews) {
			if (await ctx.shouldStop()) return;

			// Update status - fetching view
			ctx.status(`Fetching view ${view.name} from ${tableName}${this.basePosition}`);

			// Fetch only record IDs from this view
			const viewRecordIds = await this.fetchViewRecordIds(baseId, tableName, view, ctx);

			const inView = viewRecordIds.filter(recordId => !emptyRecordIds.has(recordId));

			// A view holding every note needs no filter, and so needs no note to
			// name it: the base is already filtered to this table's folder. A
			// view's records are a subset of the table's, so counting is enough.
			if (inView.length === noteCount) {
				viewsShowingEveryRecord.add(view.id);
				continue;
			}

			// Tag these records with this view
			for (const recordId of inView) {
				if (!recordViewMemberships.has(recordId)) {
					recordViewMemberships.set(recordId, []);
				}
				recordViewMemberships.get(recordId)!.push(view.id);
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
			viewsShowingEveryRecord,
		});

		// Count total records to import
		this.totalRecordsToImport += allRecords.length;
	}


	/**
	 * Create files for a single table
	 */
	private async createFilesForTable(
		ctx: ImportContext,
		plan: TablePlan
	): Promise<void> {
		const { tableData, tablePath } = plan;
		const { baseId, tableName, primaryFieldId, fields, views, recordViewMemberships } = tableData;

		// Find primary field by ID (don't assume fields[0] is primary)
		const primaryField = fields.find(f => f.id === primaryFieldId);
		const primaryFieldName = primaryField?.name || fields[0]?.name;

		await this.createFolders(tablePath);

		// Update status context for writing
		ctx.status(`Creating notes in ${tableName}${this.basePosition}`);

		// Derived once and shared by the .base file and every record in the table
		const formulas = this.computeTableFormulas(fields, primaryFieldId);
		const formulaFieldNames = new Set(formulas.keys());
		const frontMatterFields = this.frontMatterFieldsForTable(fields, primaryFieldName);

		// Create .base file first. It settles what a note says to be picked up
		// by each view, which the notes below then say.
		const membershipTokens = await this.createBaseFile({
			tableFolderPath: tablePath,
			tableName,
			views,
			fields,
			primaryFieldId,
			formulas,
			viewsShowingEveryRecord: tableData.viewsShowingEveryRecord,
		});

		if (await ctx.shouldStop()) return;

		// Write the notes, at the paths the plan settled on
		for (const planned of plan.records) {
			if (await ctx.shouldStop()) return;

			try {
				const viewReferences = (recordViewMemberships.get(planned.record.id) ?? [])
					.map(viewId => membershipTokens.get(viewId))
					.filter((token): token is string => token !== undefined);
				await this.createRecordFile(ctx, planned, {
					baseId,
					primaryFieldName,
					fields,
					viewReferences,
					formulaFieldNames,
					frontMatterFields,
				});
			}
			catch (error) {
				ctx.reportFailed(planned.title, error);
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
	 * Write one record's note, at the path the plan gave it.
	 *
	 * Everything a note needs to be written once is settled by then: its own
	 * path, and the path of every record it links to.
	 */
	private async createRecordFile(
		ctx: ImportContext,
		planned: PlannedRecord,
		fileContext: RecordFileContext
	): Promise<void> {
		const { primaryFieldName, fields, viewReferences, formulaFieldNames, frontMatterFields } = fileContext;
		const { record, filePath, title } = planned;

		if (planned.skipped) {
			ctx.reportSkipped(title, planned.skipped);
			this.processedRecordsCount++;
			this.reportOverallProgress(ctx);
			return;
		}

		const { content } = await buildRecordNote(record, {
			fields,
			primaryFieldName,
			viewReferences,
			viewPropertyName: this.viewPropertyName,
			formulaFieldNames,
			frontMatterFields,
			recordId: this.incrementalImport,
			resolveRecordLink: linkedRecordId => this.linkTextForRecord(fileContext.baseId, linkedRecordId),
			externalRecordTitle: linkedRecordId => this.globalRecordIdToTitle.get(linkedRecordId),
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

		await this.vault.create(filePath, content);

		ctx.reportNoteSuccess(title);

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

		return await this.noteImportedFrom(filePath, RECORD_ID_PROPERTY, recordId) !== null;
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
	private async createBaseFile(ctx: BaseFileContext): Promise<Map<string, string>> {
		const { tableName } = ctx;

		const { path: baseFilePath, config: baseConfig, membershipTokens } = buildBaseFile({
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

		// Returned even when writing the .base failed: the notes are still
		// written, and a note that names its views is worth more than one that
		// does not if the user fixes the .base by hand.
		return membershipTokens;
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

