import { stringify } from 'yaml';
import type { Vault } from 'obsidian';
import type { RichTextItemResponse } from '@notionhq/client/build/src/api-endpoints';
import type {
	NotionDatabaseWithProperties,
	NotionDatabasePropertyType,
	BaseProperty,
	BaseFormula,
	BaseSchema,
	BasePropertyType,
	BaseView,
} from './notion-types';
import {
	isSelectProperty,
	isMultiSelectProperty,
	isStatusProperty,
	isFormulaProperty,
	PROPERTY_TYPE_MAPPINGS,
} from './notion-types';
import { convertNotionFormula } from './formula-converter';

interface ColumnMappingResult {
	properties: Record<string, BaseProperty>;
	formulas: Record<string, BaseFormula>;
	warnings: string[];
}

export interface BaseConversionResult {
	schema: BaseSchema;
	warnings: string[];
	databaseId: string;
	databaseTitle: string;
}

function mapDatabaseColumns(database: NotionDatabaseWithProperties): ColumnMappingResult {
	const properties: Record<string, BaseProperty> = {};
	const formulas: Record<string, BaseFormula> = {};
	const warnings: string[] = [];

	const dbProperties = database.properties;

	for (const [key, prop] of Object.entries(dbProperties)) {
		const propertyId = prop.id;
		const propertyName = prop.name || key;

		if (isFormulaProperty(prop)) {
			const formulaExpression = prop.formula.expression;

			if (formulaExpression && typeof formulaExpression === 'string') {
				const convertedFormula = convertNotionFormula(formulaExpression);

				if (convertedFormula.success && convertedFormula.formula) {
					formulas[propertyId] = {
						name: propertyId,
						displayName: propertyName,
						expression: convertedFormula.formula,
					};

					if (convertedFormula.warnings && convertedFormula.warnings.length > 0) {
						warnings.push(...convertedFormula.warnings.map(w => `${propertyName}: ${w}`));
					}
				} else {
					warnings.push(`Failed to convert formula for ${propertyName}: ${convertedFormula.error}`);
					formulas[propertyId] = {
						name: propertyId,
						displayName: propertyName,
						expression: `"${formulaExpression}"`,
					};
				}
			}
		} else {
			const baseType = PROPERTY_TYPE_MAPPINGS[prop.type];

			if (baseType) {
				const baseProperty: BaseProperty = {
					type: baseType,
					name: propertyId,
					displayName: propertyName,
				};

				if (isSelectProperty(prop)) {
					baseProperty.options = prop.select.options.map(opt => opt.name);
				} else if (isMultiSelectProperty(prop)) {
					baseProperty.options = prop.multi_select.options.map(opt => opt.name);
				} else if (isStatusProperty(prop)) {
					baseProperty.options = prop.status.options.map(opt => opt.name);
				}

				properties[propertyId] = baseProperty;
			} else {
				warnings.push(`Unsupported property type: ${prop.type} for ${propertyName}`);
			}
		}
	}

	return { properties, formulas, warnings };
}

function extractDatabaseTitle(database: NotionDatabaseWithProperties): string {
	const titleProperty = database.title;
	if (Array.isArray(titleProperty)) {
		const titleParts = (titleProperty as RichTextItemResponse[])
			.filter(part => part.type === 'text' && 'text' in part && part.text?.content)
			.map(part => {
				if (part.type === 'text' && 'text' in part) {
					return part.text.content;
				}
				return '';
			})
			.filter((content: string) => content.length > 0);

		return titleParts.join('') || 'Untitled Database';
	}

	return 'Untitled Database';
}

function generateViews(
	notionProperties: Record<string, NotionDatabasePropertyType>,
	baseProperties: Record<string, BaseProperty>
): BaseView[] {
	const views: BaseView[] = [];

	const statusProperty = Object.entries(notionProperties).find(
		([, prop]) => isStatusProperty(prop) || (isSelectProperty(prop) && prop.name.toLowerCase().includes('status'))
	);

	const dateProperty = Object.entries(notionProperties).find(
		([, prop]) => prop.type === 'date' && !prop.type.includes('created') && !prop.type.includes('edited')
	);

	const createdTimeProperty = Object.entries(notionProperties).find(
		([, prop]) => prop.type === 'created_time'
	);

	views.push({
		name: 'Table',
		type: 'table',
		sorts: createdTimeProperty ? [{ property: createdTimeProperty[0], direction: 'descending' }] : undefined,
	});

	views.push({
		name: 'List',
		type: 'list',
		sorts: createdTimeProperty ? [{ property: createdTimeProperty[0], direction: 'descending' }] : undefined,
	});

	if (statusProperty) {
		views.push({
			name: 'Board',
			type: 'board',
			groups: [{ property: statusProperty[0], direction: 'ascending' }],
			sorts: createdTimeProperty ? [{ property: createdTimeProperty[0], direction: 'descending' }] : undefined,
		});
	}

	if (dateProperty) {
		views.push({
			name: 'Calendar',
			type: 'calendar',
			properties: {
				dateProperty: dateProperty[0],
			},
		});

		views.push({
			name: 'Timeline',
			type: 'table',
			sorts: [{ property: dateProperty[0], direction: 'ascending' }],
		});
	}

	views.push({
		name: 'Gallery',
		type: 'gallery',
	});

	return views;
}

export function convertDatabaseToBase(database: NotionDatabaseWithProperties): BaseConversionResult {
	const columnMapping = mapDatabaseColumns(database);
	const databaseId = database.id;
	const databaseTitle = extractDatabaseTitle(database);

	const schema: BaseSchema = {
		filters: {
			and: [
				`note["notion-database"].contains("${databaseId}")`,
			],
		},
	};

	if (Object.keys(columnMapping.properties).length > 0) {
		schema.properties = columnMapping.properties;
	}

	if (Object.keys(columnMapping.formulas).length > 0) {
		schema.formulas = columnMapping.formulas;
	}

	schema.views = generateViews(database.properties, columnMapping.properties);

	return {
		schema,
		warnings: columnMapping.warnings,
		databaseId,
		databaseTitle,
	};
}

export function serializeBaseSchema(schema: BaseSchema): string {
	return stringify(schema, {
		lineWidth: 0,
		defaultStringType: 'QUOTE_DOUBLE',
		defaultKeyType: 'PLAIN',
	});
}

export function createBaseFileContent(schema: BaseSchema, title?: string): string {
	const yaml = serializeBaseSchema(schema);
	return yaml;
}

export async function writeBaseFile(
	vault: Vault,
	schema: BaseSchema,
	folderPath: string,
	filename: string,
	title?: string
): Promise<string> {
	const content = createBaseFileContent(schema, title);
	const fullPath = `${folderPath}/${filename}.base`;

	await vault.create(fullPath, content);

	return fullPath;
}
