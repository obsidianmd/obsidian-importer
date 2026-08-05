/**
 * The .base file for one Airtable table, separate from the importer that
 * writes it.
 *
 * A table becomes a folder of notes plus one .base beside it: the columns are
 * the table's fields, and each Airtable view becomes a Bases view filtered to
 * the records that belong to it. Merging this into a .base the vault already
 * has is the importer's, and stays there.
 */
import { BasesConfigFile, BasesConfigFileView, normalizePath } from 'obsidian';
import { parseFilePath } from '../../filesystem';
import { sanitizeFileName } from '../../util';
import type { AirtableFieldSchema, AirtableViewInfo } from './types';

/** Obsidian Bases view type for each Airtable view type; anything else is a table */
const BASE_VIEW_TYPE_FOR_AIRTABLE_VIEW: Record<string, string> = {
	grid: 'table',
	gallery: 'cards',
	list: 'list',
	kanban: 'cards',
	calendar: 'cards',
	timeline: 'table',
	gantt: 'table',
	form: 'table',
};

/**
 * Sanitize property name for use in YAML frontmatter and .base files.
 *
 * Obsidian properties support most characters, including spaces and hyphens,
 * so the name is preserved as-is apart from double quotes and backslashes.
 * Those have to go because the same name is embedded in double-quoted
 * `note["..."]` expressions in the generated .base file, where they would
 * terminate the string and make the file unparseable.
 *
 * Every site that writes a property name - frontmatter keys, formula keys,
 * view column order, and cross-note lookups - goes through here, so both
 * sides of a reference stay in agreement.
 */
export function sanitizePropertyName(name: string): string {
	return name.replace(/["\\]/g, '');
}

/**
 * Sanitize view name for use in wiki links and .base filter expressions
 *
 * Wiki links can't contain: [ ] # | ^
 * Double quotes and backslashes are also stripped because the name is
 * embedded in a double-quoted Bases filter string, where they would
 * terminate the string and produce an unparseable .base file.
 */
export function sanitizeViewName(name: string): string {
	return name.replace(/[[\]#|^"\\]/g, '_');
}

export interface BuildBaseFileOptions {
	/** Folder the table's notes are written to. */
	tableFolderPath: string;
	tableName: string;
	views: AirtableViewInfo[];
	fields: AirtableFieldSchema[];
	primaryFieldId: string;
	/** field name -> Obsidian formula, from computeTableFormulas */
	formulas: Map<string, string>;
	/** Property the notes carry their view references in. */
	viewPropertyName: string;
	/**
	 * The property name a field's value is written under. The user can rename
	 * any property, so this is the importer's rather than the field name.
	 */
	propertyNameForField: (fieldName: string) => string;
}

export interface BuiltBaseFile {
	/** Where the .base goes, beside the table's folder. */
	path: string;
	/**
	 * The .base as a note's view property refers to it, which is how a view's
	 * filter finds its records.
	 */
	viewReferenceBasePath: string;
	config: BasesConfigFile;
}

/** The columns one view shows, in the order it shows them. */
function columnsForView(
	view: AirtableViewInfo,
	allColumns: string[],
	columnKeyByFieldId: Map<string, string>
): string[] {
	if (!view.visibleFieldIds) {
		return allColumns;
	}

	const columns = view.visibleFieldIds
		.map(fieldId => columnKeyByFieldId.get(fieldId))
		.filter((key): key is string => key !== undefined);

	return ['file.name', ...columns];
}

export function buildBaseFile(options: BuildBaseFileOptions): BuiltBaseFile {
	const {
		tableFolderPath, tableName, views, fields, primaryFieldId, formulas,
		viewPropertyName, propertyNameForField,
	} = options;

	// Where the .base file goes
	const { parent: parentPath } = parseFilePath(tableFolderPath);

	// Find primary field - this is used as note title/filename, not as a formula column
	const primaryFieldName = fields.find(f => f.id === primaryFieldId)?.name || null;

	// Column order and display names, both in original Airtable field order.
	// Built together so a field's column key and its display-name key cannot
	// disagree about whether it is a formula.
	const propertyColumns: string[] = ['file.name'];
	const properties: BasesConfigFile['properties'] = {};
	// Field id -> column key, so a view can be ordered from its visibleFieldIds
	const columnKeyByFieldId = new Map<string, string>();

	// file.name is the primary field
	if (primaryFieldName) {
		properties['file.name'] = { displayName: primaryFieldName };
	}

	for (const field of fields) {
		// Skip the primary field (it's represented by file.name)
		if (field.id === primaryFieldId) {
			continue;
		}

		const sanitized = propertyNameForField(field.name);
		const propertyKey = formulas.has(field.name) ? `formula.${sanitized}` : sanitized;
		propertyColumns.push(propertyKey);
		properties[propertyKey] = { displayName: field.name };
		columnKeyByFieldId.set(field.id, propertyKey);
	}

	// One .base file for the table, with a view for each of Airtable's
	const sanitizedTableName = sanitizeFileName(tableName);
	const baseFileName = `${sanitizedTableName}.base`;
	const baseFilePath = normalizePath(parentPath ? `${parentPath}/${baseFileName}` : baseFileName);

	// The path a record's view property refers to, e.g. "BaseName/TableName.base"
	// from a table folder of "Airtable/BaseName/TableName"
	const { name: baseFolderName } = parseFilePath(parentPath);
	const viewReferenceBasePath = baseFolderName
		? normalizePath(`${baseFolderName}/${sanitizedTableName}.base`)
		: `${sanitizedTableName}.base`;

	const obsidianViews: BasesConfigFileView[] = [];

	for (const view of views) {
		const obsidianViewType = BASE_VIEW_TYPE_FOR_AIRTABLE_VIEW[view.type.toLowerCase()] ?? 'table';

		// e.g. [[BaseName/TableName.base#Grid view]]
		const sanitizedViewName = sanitizeViewName(view.name);
		const viewReference = `[[${viewReferenceBasePath}#${sanitizedViewName}]]`;

		obsidianViews.push({
			type: obsidianViewType,
			name: sanitizedViewName, // Must match the name in wiki link reference
			filters: `note["${viewPropertyName}"].contains("${viewReference}")`,
			order: columnsForView(view, propertyColumns, columnKeyByFieldId),
		});
	}

	const config: BasesConfigFile = {
		// Only files in this table's folder
		filters: `file.folder == "${tableFolderPath}"`,
	};

	if (formulas.size > 0) {
		config.formulas = {};
		for (const [fieldName, obsidianFormula] of formulas) {
			config.formulas[propertyNameForField(fieldName)] = obsidianFormula;
		}
	}

	config.properties = properties;
	config.views = obsidianViews;

	return { path: baseFilePath, viewReferenceBasePath, config };
}
