import { BasesConfigFile, BasesConfigFileView, normalizePath } from 'obsidian';
import { parseFilePath } from '../../filesystem';
import { sanitizeFileName } from '../../util';
import type { AirtableFieldSchema, AirtableViewInfo } from './types';

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

export function sanitizePropertyName(name: string): string {
	// Property names are embedded in quoted note["..."] expressions.
	return name.replace(/["\\]/g, '');
}

export function sanitizeViewName(name: string): string {
	return name.replace(/[[\]#|^"\\]/g, '_');
}

export interface BuildBaseFileOptions {
	tableFolderPath: string;
	tableName: string;
	views: AirtableViewInfo[];
	fields: AirtableFieldSchema[];
	primaryFieldId: string;
	formulas: Map<string, string>;
	viewPropertyName: string;
	propertyNameForField: (fieldName: string) => string;
	viewsShowingEveryRecord?: ReadonlySet<string>;
}

export interface BuiltBaseFile {
	path: string;
	membershipTokens: Map<string, string>;
	config: BasesConfigFile;
}

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
		viewPropertyName, propertyNameForField, viewsShowingEveryRecord,
	} = options;

	const { parent: parentPath } = parseFilePath(tableFolderPath);

	const primaryFieldName = fields.find(f => f.id === primaryFieldId)?.name || null;

	const propertyColumns: string[] = ['file.name'];
	const properties: BasesConfigFile['properties'] = {};
	const columnKeyByFieldId = new Map<string, string>();

	if (primaryFieldName) {
		properties['file.name'] = { displayName: primaryFieldName };
	}

	for (const field of fields) {
		if (field.id === primaryFieldId) {
			continue;
		}

		const sanitized = propertyNameForField(field.name);
		const propertyKey = formulas.has(field.name) ? `formula.${sanitized}` : sanitized;
		propertyColumns.push(propertyKey);
		properties[propertyKey] = { displayName: field.name };
		columnKeyByFieldId.set(field.id, propertyKey);
	}

	const sanitizedTableName = sanitizeFileName(tableName);
	const baseFileName = `${sanitizedTableName}.base`;
	const baseFilePath = normalizePath(parentPath ? `${parentPath}/${baseFileName}` : baseFileName);

	const obsidianViews: BasesConfigFileView[] = [];
	const membershipTokens = new Map<string, string>();

	for (const view of views) {
		const obsidianViewType = BASE_VIEW_TYPE_FOR_AIRTABLE_VIEW[view.type.toLowerCase()] ?? 'table';
		const sanitizedViewName = sanitizeViewName(view.name);

		// A view containing every record needs no membership property.
		const needsFilter = !viewsShowingEveryRecord?.has(view.id);

		if (needsFilter) {
			membershipTokens.set(view.id, sanitizedViewName);
		}

		obsidianViews.push({
			type: obsidianViewType,
			name: sanitizedViewName,
			...(needsFilter ? { filters: `note["${viewPropertyName}"].contains("${sanitizedViewName}")` } : {}),
			order: columnsForView(view, propertyColumns, columnKeyByFieldId),
		});
	}

	const config: BasesConfigFile = {
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

	return { path: baseFilePath, membershipTokens, config };
}

/**
 * The views a rewritten .base should hold.
 *
 * A .base is generated from the table's schema, so an import replaces what it
 * generated. Its views are the exception: the user may have added their own
 * beside the imported ones, and those are theirs to keep. A view the import
 * brings replaces the one of that name; anything else in the file stays.
 *
 * Nothing here reads the duplicate mode. That setting is about notes, and a
 * .base holding a view of a table whose schema has moved on is no use.
 */
export function mergedBaseViews(existing: unknown, importedViews: BasesConfigFileView[]): BasesConfigFileView[] {
	const byName = new Map<string, BasesConfigFileView>();

	for (const view of viewsIn(existing)) byName.set(view.name, view);
	for (const view of importedViews) byName.set(view.name, view);

	return [...byName.values()];
}

/**
 * The views in a .base as it stands, which is a file the user can edit.
 *
 * Anything in it that is not a view with a name is not something to carry
 * over: there would be no name to keep it under, and no way to tell whether
 * the import means to replace it.
 */
function viewsIn(config: unknown): BasesConfigFileView[] {
	if (typeof config !== 'object' || config === null) return [];

	const views = (config as { views?: unknown }).views;
	if (!Array.isArray(views)) return [];

	return views.filter((view): view is BasesConfigFileView =>
		typeof view === 'object' && view !== null && typeof (view as { name?: unknown }).name === 'string');
}
