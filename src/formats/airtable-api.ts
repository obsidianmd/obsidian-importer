/**
 * Airtable API Importer
 * Imports tables and records from Airtable using the API
 */

import { Notice, normalizePath, TFile, setIcon, stringifyYaml, parseYaml, Setting } from 'obsidian';
import { FormatImporter, NoteTemplateSample, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { parseFilePath } from '../filesystem';
import { extractErrorMessage, sanitizeFileName, updatePropertyTypes } from '../util';
import { areAnySelected, selectedNodes } from '../tree';
import { describeRequestFailure } from '../request-failure';
import { TreePicker } from '../tree-view';
import type { FormulaImportStrategy } from '../base';
import {
	TemplateConfigurator,
	TemplateConfig,
	TemplateField,
	sourceVariableExpression,
} from '../template';

// Import helper modules
import Airtable from 'airtable';
import { fetchBases, fetchTableSchema, selectRecords } from './airtable-api/api-helpers';
import { downloadAttachmentList, formatAttachmentsForBody, formatAttachmentsForYAML } from './airtable-api/attachment-helpers';
import { buildBaseFile, mergedBaseViews, sanitizePropertyName, sanitizeViewName } from './airtable-api/base-file';
import { mapAirtableTypeToObsidian } from './airtable-api/field-converter';
import { computeTableFormulas } from './airtable-api/table-formulas';
import {
	buildRecordNote,
	defaultPropertyConfig,
	extractStringValue,
	frontMatterFieldsForTable,
	isEmptyRecord,
	RECORD_ID_PROPERTY,
	recordTimestamps,
	recordTitle,
} from './airtable-api/record-note';
import type {
	AirtableTreeNode,
	AirtableViewInfo,
	AttachmentPlacement,
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

interface AirtableTemplatePreviewSample extends NoteTemplateSample {
	viewReferences: string[];
}

export class AirtableAPIImporter extends FormatImporter {
	interruption = 'pause' as const;

	protected override get sourceIdSettingFirst(): boolean {
		return true;
	}

	/** Resolved from the keychain on each read, so unlinking the secret takes effect immediately */
	get airtableToken(): string {
		return this.getSecret() ?? '';
	}

	get sourceReady(): boolean {
		return areAnySelected(this.picker?.nodes ?? []);
	}

	formulaStrategy: FormulaImportStrategy = 'hybrid';
	downloadAttachments: boolean = true;
	viewPropertyName: string = 'Views';
	private picker: TreePicker<AirtableTreeNode>;

	// Tracking data
	private recordIdToPath: Map<string, string> = new Map(); // baseId:recordId -> file path (recordId only unique within base)
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
	protected preparedData: PreparedTableData[] = [];

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
		this.defaultOutputFolder = 'Airtable';
		this.idProperty = RECORD_ID_PROPERTY;
		this.idLabel = i18n.importer.airtableApi.labelId();

		// Airtable Personal Access Token, held in Obsidian's keychain so it is
		// remembered between sessions
		this.addSecretSetting(i18n.importer.airtableApi.nameToken(), i18n.importer.airtableApi.descToken(), {
			text: i18n.importer.airtableApi.linkGetToken(),
			url: 'https://airtable.com/create/tokens',
		});

		const contentEl = this.host.sourceEl;
		if (!contentEl) return;

		this.picker = new TreePicker<AirtableTreeNode>(contentEl, {
			setting: this.addSetting('source'),
			name: i18n.importer.airtableApi.nameTables(),
			desc: i18n.importer.airtableApi.descTables(),
			hint: i18n.importer.airtableApi.hintTables(),
			loading: i18n.importer.airtableApi.msgFetchingBases(),
			empty: i18n.importer.airtableApi.msgNoBases(),
			failed: error => describeRequestFailure(error, {
				name: i18n.importer.airtableApi.labelService(),
				subject: i18n.importer.airtableApi.labelSubject(),
				credential: i18n.importer.airtableApi.labelCredential(),
			}),
			view: {
				icon: node => node.type === 'base' ? 'database' : 'file',
				isCollapsible: node => node.type === 'base' || !!node.children?.length,
				onExpand: (node, rowEl) => this.loadTablesForExpand(node, rowEl),
			},
			onChange: () => this.sourceChanged(),
		});

		this.picker.onLoad(() => void this.loadTree());

		// Formula conversion affects import processing rather than the property
		// names configured on the template page.
		this.addSetting()
			?.setName(i18n.importer.airtableApi.nameFormulas())
			.setDesc(i18n.importer.airtableApi.descFormulas())
			.addDropdown(dropdown => dropdown
				.addOption('hybrid', i18n.importer.airtableApi.optionFormulaHybrid())
				.addOption('static', i18n.importer.airtableApi.optionFormulaStatic())
				.setValue('hybrid')
				.onChange(value => this.formulaStrategy = value as FormulaImportStrategy));

		// Download attachments option
		this.addSetting()
			?.setName(i18n.importer.airtableApi.nameDownloadAttachments())
			.setDesc(i18n.importer.airtableApi.descDownloadAttachments())
			.addToggle(toggle => {
				toggle
					.setValue(true)
					.onChange(value => {
						this.downloadAttachments = value;
					});
			});

		this.duplicateCaveat = i18n.importer.airtableApi.descNoModifiedTime({
			update: i18n.output.optionUpdate(),
		});
	}


	protected secretChanged(): void {
		if (this.airtableToken) void this.loadTree();
		else this.picker.reset();
	}

	/**
	 * Load base and table tree from Airtable API
	 */
	private async loadTree(): Promise<void> {
		if (!this.airtableToken) {
			new Notice(i18n.importer.airtableApi.msgTokenFirst());
			return;
		}

		try {
			await this.picker.load(() => this.readBases());
		}
		catch (error) {
			console.error('[Airtable Importer] Failed to load bases:', error);
			new Notice(i18n.importer.airtableApi.msgLoadBasesFailed({
				error: extractErrorMessage(error) ?? i18n.common.msgUnknownError(),
			}));
		}
	}

	private async readBases(): Promise<AirtableTreeNode[]> {
		const bases = await fetchBases(this.airtableToken, { status: (msg: string) => this.picker.setStatus(msg) });

		return bases
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
	}

	private async loadTablesForExpand(node: AirtableTreeNode, rowEl: HTMLElement): Promise<boolean> {
		if (node.type !== 'base' || node.tablesLoaded) return false;

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
			status: () => reportTo?.(i18n.importer.airtableApi.statusLoadingTables({ base: baseNode.title })),
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
			new Notice(i18n.importer.airtableApi.msgLoadTablesFailed({
				base: baseNode.title,
				error: extractErrorMessage(error) ?? i18n.common.msgUnknownError(),
			}));
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
		const pending = this.picker.nodes.filter(node => node.selected && !node.tablesLoaded);

		for (let i = 0; i < pending.length; i++) {
			report(`Loading tables (${i + 1}/${pending.length})`);
			await this.ensureTablesLoaded(pending[i], report);
		}
	}

	private getSelectedNodes(): AirtableTreeNode[] {
		return selectedNodes(this.picker.nodes, node => !node.disabled);
	}

	/**
	 * Show template configuration UI before import (similar to CSV importer)
	 */
	async showTemplateConfiguration(ctx: ImportContext, container: HTMLElement, buttonsEl: HTMLElement): Promise<boolean> {
		if (this.getSelectedNodes().length === 0) {
			new Notice(i18n.importer.airtableApi.msgPickTable());
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
		loadingTextEl.setText(i18n.importer.airtableApi.msgLoadingFields());

		await this.ensureSelectedTablesLoaded(msg => loadingTextEl.setText(msg));

		loadingEl.remove();

		// Loading a base's tables only adds children that inherit its selection as
		// checked-but-disabled, which getSelectedNodes filters out, so the
		// selection checked above still holds
		const picked = this.getSelectedNodes();

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

		collectFields(picked);

		if (allFieldsMap.size === 0) {
			new Notice(i18n.importer.airtableApi.msgNoFields());
			return false;
		}

		// Prepare template fields
		const fields: TemplateField[] = Array.from(allFieldsMap.values()).map(field => ({
			id: field.name,
			label: field.name,
			exampleValue: fieldExamples.get(field.name) || '',
		}));

		const { propertyNames, propertyValues } = defaultPropertyConfig(allFieldsMap.values(), this.viewPropertyName);

		// Note content is empty by default - let user decide what to put there
		const bodyTemplate = '';

		const templateFields = fields.map(field => ({
			...field,
			sourceName: field.id,
			id: sourceVariableExpression(field.id),
		}));
		const defaults: TemplateConfig = {
			titleTemplate: '', // Not used - each table's primary field is used directly
			locationTemplate: '',
			bodyTemplate,
			propertyNames,
			propertyValues,
		};

		return await this.showConfigurationBeforePreview(
			defaults,
			async current => {
				// Airtable uses each table's primary field as the note title and its
				// table hierarchy as the location, so this screen configures properties.
				const configurator = new TemplateConfigurator({
					fields,
					defaults: current,
					placeholderSyntax: '{{field_name}}',
					showTitleTemplate: false,
					showLocationTemplate: false,
					showBodyTemplate: false,
					actionText: i18n.modal.buttonContinue(),
				});
				const configured = await configurator.show(container, buttonsEl);
				if (configured) this.templateConfig = configured;
				return configured;
			},
			async (configured, back) => {
				const samples = this.loadTemplatePreviewSamples(ctx, picked).catch(error => {
					console.error('Could not load Airtable template previews', error);
					return [];
				});
				return await this.showNoteTemplateConfiguration(container, buttonsEl, {
					fields: templateFields,
					preview: async (template, titleTemplate) => {
						const loaded = await samples;
						const withViews: NoteTemplateSample[] = loaded.map(sample => ({
							...sample,
							generatedProperties: sample.viewReferences.length > 0
								? { [this.viewPropertyName]: sample.viewReferences }
								: undefined,
						}));
						return await this.previewLoadedSamples(
							template,
							titleTemplate,
							Promise.resolve(withViews),
							templateFields,
						);
					},
					cancel: back,
					configure: (contentEl, previewChanged) => {
						this.addAirtableViewPropertySetting(
							contentEl,
							previewChanged,
						);
					},
				});
			},
		);
	}

	private addAirtableViewPropertySetting(
		contentEl: HTMLElement,
		previewChanged: () => void,
	): void {
		new Setting(this.settingsIn(contentEl))
			.setName(i18n.importer.airtableApi.nameViewProperty())
			.setDesc(i18n.importer.airtableApi.descViewProperty())
			.addText(text => text
				.setPlaceholder('Views')
				.setValue(this.viewPropertyName)
				.onChange(value => {
					// Stripped rather than escaped: this name is embedded in a
					// double-quoted Bases filter string in the generated .base file.
					this.viewPropertyName = value.trim().replace(/["\\]/g, '') || 'Views';
					previewChanged();
				}));
	}

	private async loadTemplatePreviewSamples(
		ctx: ImportContext,
		picked: AirtableTreeNode[],
	): Promise<AirtableTemplatePreviewSample[]> {
		const samples: AirtableTemplatePreviewSample[] = [];
		for (const group of this.groupSelectedNodesByBase(picked).values()) {
			for (const table of group.tables) {
				if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) return samples;

				const fields = table.fields;
				const primaryFieldName = fields.find(field => field.id === table.primaryFieldId)?.name
					?? fields[0]?.name;
				if (!primaryFieldName) continue;

				const records = await selectRecords(
					this.getAirtableBase(group.baseId),
					table.tableId || table.tableName,
					{ maxRecords: TEMPLATE_PREVIEW_LIMIT - samples.length },
				);
				const viewReferences = await this.loadPreviewViewReferences(
					ctx,
					group.baseId,
					table.tableId || table.tableName,
					table.views,
					records as AirtableRecord[],
				);
				const formulaFieldNames = new Set(this.computeTableFormulas(fields, table.primaryFieldId).keys());
				// View membership is injected as a generated property at render time,
				// so a field with the same name can reappear when the user renames it.
				const frontMatterFields = this.frontMatterFieldsForTable(fields, primaryFieldName, '\0');

				for (const record of records as AirtableRecord[]) {
					if (isEmptyRecord(record)) continue;
					const title = recordTitle(record, primaryFieldName);
					const path = normalizePath([
						this.outputLocation.trim(),
						sanitizeFileName(group.baseName),
						sanitizeFileName(table.tableName),
						`${sanitizeFileName(title)}.md`,
					].filter(Boolean).join('/'));
					const { content, templateVariables } = await buildRecordNote(record, {
						fields,
						primaryFieldName,
						viewReferences: [],
						viewPropertyName: this.viewPropertyName,
						formulaFieldNames,
						frontMatterFields,
						recordId: false,
						bodyTemplate: this.templateConfig?.bodyTemplate,
						resolveAttachments: async () => [],
						formatAttachmentsForBody: () => [],
						formatAttachmentsForYAML: () => [],
					});
					samples.push({
						title,
						path,
						content,
						variables: templateVariables,
						viewReferences: viewReferences.get(record.id) ?? [],
						sourceId: record.id,
						times: recordTimestamps(record),
					});
					if (samples.length >= TEMPLATE_PREVIEW_LIMIT) return samples;
				}
			}
		}
		return samples;
	}

	private async loadPreviewViewReferences(
		ctx: ImportContext,
		baseId: string,
		tableIdOrName: string,
		views: AirtableViewInfo[],
		records: AirtableRecord[],
	): Promise<Map<string, string[]>> {
		const recordIds = records.filter(record => !isEmptyRecord(record)).map(record => record.id);
		const references = new Map<string, string[]>();
		if (recordIds.length === 0) return references;

		const comparisons = recordIds.map(id => `RECORD_ID()=${JSON.stringify(id)}`);
		const filterByFormula = comparisons.length === 1
			? comparisons[0]
			: `OR(${comparisons.join(',')})`;

		for (const view of views.filter(view => ['grid', 'gallery', 'list'].includes(view.type.toLowerCase()))) {
			if (await ctx.shouldStop()) break;
			try {
				const members = await selectRecords(this.getAirtableBase(baseId), tableIdOrName, {
					view: view.id,
					fields: [],
					filterByFormula,
					maxRecords: recordIds.length,
				}) as AirtableRecord[];
				const token = sanitizeViewName(view.name);
				for (const member of members) {
					const current = references.get(member.id) ?? [];
					current.push(token);
					references.set(member.id, current);
				}
			}
			catch (error) {
				console.warn(`Could not load Airtable preview membership for view ${view.name}`, error);
			}
		}

		return references;
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
		primaryFieldName: string,
		viewPropertyName = this.viewPropertyName,
	): Array<{ fieldName: string, propertyName: string }> {
		if (!this.templateConfig) return [];

		return frontMatterFieldsForTable({
			fields,
			primaryFieldName,
			propertyNames: this.templateConfig.propertyNames,
			propertyValues: this.templateConfig.propertyValues,
			viewPropertyName,
			propertyNameForField: fieldName => this.propertyNameForField(fieldName),
		});
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.airtableToken) {
			new Notice(i18n.importer.airtableApi.msgTokenMissing());
			return;
		}

		// Set before the first await: the progress UI is already on screen by now,
		// and without this its status line sits blank above a row of zeros
		ctx.status(i18n.importer.airtableApi.statusConnecting());

		// Normally already done by showTemplateConfiguration; repeated here because
		// a base selected but never expanded has no tables to import otherwise
		await this.ensureSelectedTablesLoaded(msg => ctx.status(msg));

		const picked = this.getSelectedNodes();
		if (picked.length === 0) {
			new Notice(i18n.importer.airtableApi.msgPickTable());
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
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
			const baseGroups = this.groupSelectedNodesByBase(picked);
			const totalBases = baseGroups.size;
			this.totalBasesToImport = totalBases;

			ctx.status(i18n.importer.airtableApi.statusFoundBases({
				bases: i18n.nouns.baseWithCount({ count: totalBases }),
			}));

			// Process each base sequentially to minimize memory usage
			let baseIndex = 0;
			for (const [, baseInfo] of baseGroups.entries()) {
				if (await ctx.shouldStop()) {
					ctx.status(i18n.common.statusCancelled());
					return;
				}

				baseIndex++;
				this.basePosition = totalBases > 1
					? i18n.importer.airtableApi.labelBasePosition({ index: baseIndex, total: totalBases })
					: '';

				// Clear data from previous base to free memory
				this.clearBaseData();

				ctx.status(i18n.importer.airtableApi.statusFetchingBase({
					base: baseInfo.baseName,
					position: this.basePosition,
				}));

				// ============================================================
				// PHASE 1: Fetch data for this base
				// ============================================================
				try {
					await this.fetchBaseData(ctx, baseInfo);
				}
				catch (error) {
					console.error(`Failed to fetch data from base "${baseInfo.baseName}":`, error);
					ctx.reportFailed(i18n.importer.airtableApi.labelBase({ name: baseInfo.baseName }), error);
					// Continue with next base instead of stopping entirely
					continue;
				}

				if (await ctx.shouldStop()) {
					ctx.status(i18n.common.statusCancelled());
					return;
				}

				try {
					await this.createFilesForBase(ctx, folder.path);
				}
				catch (error) {
					console.error(`Failed to create files for base "${baseInfo.baseName}":`, error);
					ctx.reportFailed(i18n.importer.airtableApi.labelBase({ name: baseInfo.baseName }), error);
					// Continue with next base
					continue;
				}
			}

			// Update property types in Obsidian's types.json
			ctx.status(i18n.importer.airtableApi.statusUpdatingTypes());
			this.updatePropertyTypes();

			ctx.status(i18n.importer.airtableApi.statusComplete());

			// Leave the user looking at what they imported. Opens behind the
			// modal, so it is waiting for them once they dismiss it.
			await this.openLastBaseFile();
		}
		catch (error) {
			console.error('Airtable API import error:', error);
			ctx.reportFailed(i18n.importer.airtableApi.labelImport(), error);
			new Notice(i18n.importer.airtableApi.msgImportFailed({ error: extractErrorMessage(error) ?? '' }));
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
					const baseName = this.picker.nodes.find(baseNode => baseNode.id === baseId)?.title ?? '';
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
			ctx.status(i18n.importer.airtableApi.statusFetchingRecords({
				table: table.tableName,
				position: this.basePosition,
			}));

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
		ctx.status(i18n.importer.airtableApi.statusPreparingRecords({
			base: baseName,
			position: this.basePosition,
		}));
		this.reportOverallProgress(ctx);
	}

	private async fetchLinkedRecordTitles(ctx: ImportContext, baseInfo: BaseGroupInfo): Promise<void> {
		const { baseId, tables } = baseInfo;
		const imported = new Set(tables.map(table => table.tableId));

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

		const schema = this.picker.nodes.find(node => node.id === baseId)?.children ?? [];

		for (const tableId of linkedTableIds) {
			if (await ctx.shouldStop()) return;

			const table = schema.find(node => node.metadata?.tableId === tableId);
			const fields = table?.metadata?.fields ?? [];
			const primaryFieldName = fields.find(field => field.id === table?.metadata?.primaryFieldId)?.name;
			if (!primaryFieldName) continue;

			const tableName = table?.metadata?.tableName ?? tableId;
			ctx.status(i18n.importer.airtableApi.statusReadingNames({
				table: tableName,
				position: this.basePosition,
			}));

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
				ctx.reportSkipped(
					i18n.importer.airtableApi.labelLinkedTable({ name: tableName }),
					i18n.importer.airtableApi.reasonNoRecordNames()
				);
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
		const plans = await this.planRecordPaths(ctx, rootPath);
		if (await ctx.shouldStop()) return;

		for (const plan of plans) {
			if (await ctx.shouldStop()) return;

			await this.createFilesForTable(ctx, plan);
		}
	}

	protected async planRecordPaths(ctx: ImportContext, rootPath: string): Promise<TablePlan[]> {
		// Resolve every path first so record links use final, deduplicated names.
		const plans: TablePlan[] = [];

		for (const tableData of this.preparedData) {
			if (await ctx.shouldStop()) return plans;

			const { baseId, baseName, tableName, primaryFieldId, fields, records } = tableData;
			const primaryFieldName = fields.find(f => f.id === primaryFieldId)?.name || fields[0]?.name;

			const tablePath = baseName
				? normalizePath(`${rootPath}/${sanitizeFileName(baseName)}/${sanitizeFileName(tableName)}`)
				: normalizePath(`${rootPath}/${sanitizeFileName(tableName)}`);

			ctx.status(i18n.importer.airtableApi.statusPlanning({
				table: tableName,
				position: this.basePosition,
			}));

			const planned: PlannedRecord[] = [];

			for (const record of records) {
				if (await ctx.shouldStop()) return plans;

				if (isEmptyRecord(record)) {
					planned.push({
						record,
						note: null,
						filePath: '',
						title: 'Untitled Record',
						skipped: i18n.importer.airtableApi.reasonEmptyRecord(),
					});
					continue;
				}

				// Including the note an earlier import wrote, wherever the user
				// has since moved it to.
				const note = await this.planTemplatedNote(
					tablePath,
					recordTitle(record, primaryFieldName),
					'',
					{
						sourceId: record.id,
						...recordTimestamps(record),
						templateVariables: Object.fromEntries(
							Object.entries(record.fields ?? {}).map(([name, value]) => [
								name,
								extractStringValue(value),
							]),
						),
					},
				);
				const { basename } = parseFilePath(note.targetPath);

				this.recordIdToPath.set(`${baseId}:${record.id}`, note.targetPath.replace(/\.md$/, ''));
				this.globalRecordIdToTitle.set(record.id, basename);

				planned.push({ record, note, filePath: note.targetPath, title: basename });
			}

			plans.push({ tableData, tablePath, records: planned });
		}

		this.chooseLinkForms();

		return plans;
	}

	private chooseLinkForms(): void {
		// Use a short link only when its basename is unambiguous.
		const timesUsed = new Map<string, number>();
		for (const path of this.recordIdToPath.values()) {
			const basename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
			timesUsed.set(basename, (timesUsed.get(basename) ?? 0) + 1);
		}

		this.uniqueBasenames.clear();

		for (const path of this.recordIdToPath.values()) {
			const basename = path.slice(path.lastIndexOf('/') + 1);
			if (timesUsed.get(basename.toLowerCase()) !== 1) continue;

			const existing = this.app.metadataCache.getFirstLinkpathDest(basename, '');
			if (existing && existing.path !== `${path}.md`) continue;

			this.uniqueBasenames.add(basename.toLowerCase());
		}
	}

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
		ctx.status(i18n.importer.airtableApi.statusFetchingRecords({
			table: tableName,
			position: this.basePosition,
		}));

		const allRecords = await selectRecords(this.getAirtableBase(baseId), tableName, {
			// Callback to update progress during fetch
			onProgress: (fetched: number) => {
				ctx.status(i18n.importer.airtableApi.statusFetchedRecords({
					records: i18n.nouns.recordWithCount({ count: fetched }),
					table: tableName,
					position: this.basePosition,
				}));
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

		const recordViewMemberships = new Map<string, string[]>();
		const viewsShowingEveryRecord = new Set<string>();

		const emptyRecordIds = new Set<string>(
			(allRecords as AirtableRecord[]).filter(isEmptyRecord).map(record => record.id)
		);
		const noteCount = allRecords.length - emptyRecordIds.size;

		for (const view of supportedViews) {
			if (await ctx.shouldStop()) return;

			// Update status - fetching view
			ctx.status(i18n.importer.airtableApi.statusFetchingView({
				view: view.name,
				table: tableName,
				position: this.basePosition,
			}));

			// Fetch only record IDs from this view
			const viewRecordIds = await this.fetchViewRecordIds(baseId, tableName, view, ctx);

			const inView = viewRecordIds.filter(recordId => !emptyRecordIds.has(recordId));

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
		ctx.status(i18n.importer.airtableApi.statusCreatingNotes({
			table: tableName,
			position: this.basePosition,
		}));

		// Derived once and shared by the .base file and every record in the table
		const formulas = this.computeTableFormulas(fields, primaryFieldId);
		const formulaFieldNames = new Set(formulas.keys());
		const frontMatterFields = this.frontMatterFieldsForTable(fields, primaryFieldName);

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
			ctx.reportFailed(i18n.importer.airtableApi.labelTableView({ table: tableName, view: view.name }), error);
			return [];
		}
	}

	private async createRecordFile(
		ctx: ImportContext,
		planned: PlannedRecord,
		fileContext: RecordFileContext
	): Promise<void> {
		const { primaryFieldName, fields, viewReferences, formulaFieldNames, frontMatterFields } = fileContext;
		const { record, note, filePath, title } = planned;

		if (planned.skipped || !note) {
			ctx.reportSkipped(title, planned.skipped);
			this.processedRecordsCount++;
			this.reportOverallProgress(ctx);
			return;
		}

		// Airtable gives no modification time, so every other answer needs the
		// markdown to compare. Skip needs no comparison, and settling it now is
		// what keeps an untouched record from downloading its attachments.
		const disposition = this.preflightNote(ctx, note);
		if (disposition === 'skip') {
			this.processedRecordsCount++;
			this.reportOverallProgress(ctx);
			return;
		}

		const { content, templateVariables } = await buildRecordNote(record, {
			fields,
			primaryFieldName,
			viewReferences,
			viewPropertyName: this.viewPropertyName,
			formulaFieldNames,
			frontMatterFields,
			recordId: false,
			resolveRecordLink: linkedRecordId => this.linkTextForRecord(fileContext.baseId, linkedRecordId),
			externalRecordTitle: linkedRecordId => this.globalRecordIdToTitle.get(linkedRecordId),
			bodyTemplate: this.templateConfig?.bodyTemplate,
			resolveAttachments: attachments => downloadAttachmentList(attachments, {
				ctx,
				vault: this.vault,
				downloadAttachments: this.downloadAttachments,
				placeAttachment: this.attachmentPlacer(filePath),
				releasePath: path => this.releasePath(path),
			}),
			formatAttachmentsForBody: results => formatAttachmentsForBody(results, {
				currentFilePath: filePath,
				vault: this.vault,
				app: this.app,
			}),
			formatAttachmentsForYAML,
		});

		// The ids come from the plan, which knows the base this record is in.
		const { written } = await this.writePlannedNote(ctx, note, content, {
			disposition,
			...recordTimestamps(record),
			templateVariables,
		});
		if (written) ctx.reportNoteSuccess(title);

		this.processedRecordsCount++;
		this.reportOverallProgress(ctx);
	}

	/**
	 * Where a record's attachments go, and which of them are already there.
	 *
	 * A name and a size together are as much identity as Airtable leaves in the
	 * vault: the attachment id it hands out is not written anywhere a later
	 * import could read it back from. Without them, every import found its own
	 * file already there, wrote "cover 1.png" beside it, and changed the note to
	 * say so - which under "Update" is a record that changes every time it is
	 * looked at.
	 */
	protected attachmentPlacer(notePath: string): (filename: string, size: number | undefined) => Promise<AttachmentPlacement> {
		return async (filename, size) => {
			const { path, reuse } = await this.placeAttachment(filename, notePath, existing =>
				size !== undefined && existing.stat.size === size ? 'same' : 'another');

			return { path, reuse: reuse !== null };
		};
	}

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
	protected async createBaseFile(ctx: BaseFileContext): Promise<Map<string, string>> {
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
				const existingContent = await this.vault.read(existingFile);

				try {
					baseConfig.views = mergedBaseViews(parseYaml(existingContent), baseConfig.views ?? []);

					await this.vault.modify(existingFile, stringifyYaml(baseConfig));
				}
				catch {
					// Nothing readable to keep, so what the schema says stands.
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
