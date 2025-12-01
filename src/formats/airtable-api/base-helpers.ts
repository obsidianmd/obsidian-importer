/**
 * Base file generation for Airtable tables
 */

import { normalizePath } from 'obsidian';
import { stringifyYaml } from 'obsidian';
import type { CreateBaseFileParams, AirtableFieldSchema } from './types';
import { sanitizeFileName } from '../../util';
import { canConvertFormula, convertAirtableFormulaToObsidian } from './formula-converter';
import { createFieldIdToNameMap } from './field-converter';

/**
 * Create a .base file for an Airtable table
 */
export async function createBaseFile(params: CreateBaseFileParams): Promise<void> {
	const { vault, tableName, tableFolderPath } = params;
	
	// Generate base file name
	const sanitizedTableName = sanitizeFileName(tableName);
	const baseFileName = `${sanitizedTableName}.base`;
	
	// Get parent folder
	const parentPath = tableFolderPath.split('/').slice(0, -1).join('/');
	const baseFilePath = parentPath ? `${parentPath}/${baseFileName}` : baseFileName;
	
	// Generate content
	const content = generateBaseFileContent(params);
	
	// Create the file
	try {
		await vault.create(normalizePath(baseFilePath), content);
	}
	catch (error) {
		console.error(`Failed to create base file: ${baseFilePath}`, error);
		// Don't fail the entire import if base file creation fails
	}
}

/**
 * Generate content for a .base file
 */
function generateBaseFileContent(params: CreateBaseFileParams): string {
	const { tableFolderPath, fields, views, formulaStrategy = 'hybrid', titleTemplate } = params;
	
	// Create field ID to name mapping for formula conversion
	const fieldIdToNameMap = createFieldIdToNameMap(fields);
	
	// Separate formula fields from regular fields
	const { formulas, regularFields } = categorizeFields(fields, fieldIdToNameMap, formulaStrategy);
	
	// Extract title field name from template (e.g., "{{Formula Reference}}" -> "Formula Reference")
	let titleFieldName: string | null = null;
	if (titleTemplate) {
		const match = titleTemplate.match(/^\{\{(.+?)\}\}$/);
		if (match) {
			titleFieldName = match[1].trim();
		}
	}
	
	// Filter out the title field from regular fields (it will be represented by file.name)
	const fieldsToShow = regularFields.filter(field => field.name !== titleFieldName);
	
	// Build property columns for the base file
	const propertyColumns: string[] = ['file.name'];
	
	// Add regular fields as columns (excluding title field)
	for (const field of fieldsToShow) {
		const propertyName = sanitizePropertyName(field.name);
		propertyColumns.push(propertyName);
	}
	
	// Add formula columns (with formula. prefix, excluding title field if it's a formula)
	for (const formula of formulas) {
		if (formula.name !== titleFieldName) {
			propertyColumns.push(`formula.${sanitizePropertyName(formula.name)}`);
		}
	}
	
	// Build base config
	const baseConfig: any = {
		// Filter to show only files in this table's folder
		filters: `file.folder == "${tableFolderPath}"`,
	};
	
	// Add formulas if there are any
	if (formulas.length > 0) {
		baseConfig.formulas = {};
		for (const formula of formulas) {
			const formulaName = sanitizePropertyName(formula.name);
			baseConfig.formulas[formulaName] = formula.obsidianFormula;
		}
	}
	
	// Add properties section for display names
	baseConfig.properties = {};
	
	// Set file.name display name to the title field name
	if (titleFieldName) {
		baseConfig.properties['file.name'] = {
			displayName: titleFieldName
		};
	}
	
	// Add regular field display names (excluding title field)
	for (const field of fieldsToShow) {
		const propertyKey = sanitizePropertyName(field.name);
		baseConfig.properties[propertyKey] = {
			displayName: field.name
		};
	}
	
	// Add formula field display names (excluding title field if it's a formula)
	for (const formula of formulas) {
		if (formula.name !== titleFieldName) {
			const propertyKey = `formula.${sanitizePropertyName(formula.name)}`;
			baseConfig.properties[propertyKey] = {
				displayName: formula.name
			};
		}
	}
	
	// Add views
	baseConfig.views = [];
	
	// Add default table view
	baseConfig.views.push({
		type: 'table',
		name: 'All Records',
		order: propertyColumns,
	});
	
	// Add views from Airtable
	for (const view of views) {
		const viewName = view.name || 'Untitled View';
		
		// Map Airtable view type to Obsidian view type
		let obsidianViewType = 'table';
		switch (view.type.toLowerCase()) {
			case 'grid':
				obsidianViewType = 'table';
				break;
			case 'form':
			case 'kanban':
			case 'gallery':
			case 'calendar':
				// Obsidian doesn't support these view types yet
				// Fall back to table view
				obsidianViewType = 'table';
				break;
			default:
				obsidianViewType = 'table';
		}
		
		baseConfig.views.push({
			type: obsidianViewType,
			name: viewName,
			order: propertyColumns,
		});
	}
	
	// Convert to YAML
	return stringifyYaml(baseConfig);
}

/**
 * Categorize fields into formulas and regular fields
 */
function categorizeFields(
	fields: AirtableFieldSchema[],
	fieldIdToNameMap: Map<string, string>,
	formulaStrategy: string
): {
		formulas: Array<{ name: string, obsidianFormula: string }>;
		regularFields: AirtableFieldSchema[];
	} {
	const formulas: Array<{ name: string, obsidianFormula: string }> = [];
	const regularFields: AirtableFieldSchema[] = [];
	
	for (const field of fields) {
		// Only process formula fields
		if (field.type === 'formula') {
			const options = field.options as any;
			const formulaExpression = options?.formula;
			
			// If strategy is static, treat as regular field
			if (formulaStrategy === 'static') {
				regularFields.push(field);
				continue;
			}
			
			// Try to convert formula (hybrid strategy)
			if (formulaExpression && canConvertFormula(formulaExpression)) {
				const converted = convertAirtableFormulaToObsidian(formulaExpression, fieldIdToNameMap);
				if (converted) {
					// Successfully converted - add to formulas
					formulas.push({
						name: field.name,
						obsidianFormula: converted
					});
					continue;
				}
			}
			
			// Cannot convert - treat as regular field (will store static values)
			regularFields.push(field);
		}
		else {
			// Not a formula field - add to regular fields
			regularFields.push(field);
		}
	}
	
	return { formulas, regularFields };
}

/**
 * Sanitize property name for use in base file
 */
function sanitizePropertyName(name: string): string {
	// Remove special characters, keep alphanumeric, spaces, hyphens, underscores
	return name.replace(/[^\w\s-]/g, '').trim();
}

/**
 * Convert Airtable field type to Obsidian property type
 */
export function mapFieldTypeToObsidianType(fieldType: string): string {
	switch (fieldType) {
		case 'singleLineText':
		case 'multilineText':
		case 'richText':
		case 'email':
		case 'url':
		case 'phoneNumber':
			return 'text';
		
		case 'number':
		case 'currency':
		case 'percent':
		case 'duration':
		case 'rating':
		case 'autoNumber':
		case 'count':
			return 'number';
		
		case 'singleSelect':
			return 'text';
		
		case 'multipleSelects':
			return 'multitext';
		
		case 'date':
			return 'date';
		
		case 'dateTime':
		case 'createdTime':
		case 'lastModifiedTime':
			return 'datetime';
		
		case 'checkbox':
			return 'checkbox';
		
		case 'multipleRecordLinks':
			return 'multitext'; // Will be converted to wiki links
		
		case 'multipleAttachments':
			return 'multitext';
		
		case 'singleCollaborator':
		case 'createdBy':
		case 'lastModifiedBy':
			return 'text';
		
		case 'multipleCollaborators':
			return 'multitext';
		
		case 'formula':
		case 'rollup':
		case 'lookup':
			return 'text'; // Default to text for computed fields
		
		default:
			return 'text';
	}
}

