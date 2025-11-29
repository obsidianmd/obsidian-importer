/**
 * Field converter for Airtable fields to Obsidian properties
 */

import type { AirtableFieldSchema, FormulaImportStrategy, LinkedRecordPlaceholder } from './types';
import { ImportContext } from '../../main';
import { convertAirtableFormulaToObsidian, canConvertFormula } from './formula-converter';

/**
 * Convert Airtable field value to Obsidian property value
 */
export function convertFieldValue(
	fieldValue: any,
	fieldSchema: AirtableFieldSchema,
	recordId: string,
	formulaStrategy: FormulaImportStrategy,
	linkedRecordPlaceholders: LinkedRecordPlaceholder[],
	ctx: ImportContext
): any {
	if (fieldValue === null || fieldValue === undefined) {
		return null;
	}
	
	const fieldType = fieldSchema.type;
	
	switch (fieldType) {
		case 'aiText':
			// AI-generated text field - has state object
			// See: https://airtable.com/developers/web/api/field-model
			if (typeof fieldValue === 'object' && fieldValue !== null) {
				// Check state: "empty", "loading", "generated", "error"
				if (fieldValue.state === 'generated' && fieldValue.value) {
					return String(fieldValue.value);
				}
				// For other states (empty, loading, error), return null
				return null;
			}
			// If it's already a string (shouldn't happen), return it
			return fieldValue ? String(fieldValue) : null;
		
		case 'singleLineText':
		case 'multilineText':
		case 'richText':
		case 'email':
		case 'url':
		case 'phoneNumber':
			return String(fieldValue);
		
		case 'number':
		case 'currency':
		case 'percent':
		case 'duration':
		case 'rating':
		case 'autoNumber':
			return Number(fieldValue);
		
		case 'singleSelect':
			return fieldValue ? String(fieldValue) : null;
		
		case 'multipleSelects':
			if (Array.isArray(fieldValue)) {
				return fieldValue.map(v => String(v));
			}
			return fieldValue;
		
		case 'singleCollaborator':
			if (fieldValue && typeof fieldValue === 'object') {
				return fieldValue.name || fieldValue.email || null;
			}
			return null;
		
		case 'multipleCollaborators':
			if (Array.isArray(fieldValue)) {
				return fieldValue.map(c => c.name || c.email);
			}
			return null;
		
		case 'date':
		case 'dateTime':
		case 'createdTime':
		case 'lastModifiedTime':
			return fieldValue ? String(fieldValue) : null;
		
		case 'checkbox':
			return Boolean(fieldValue);
		
		case 'multipleRecordLinks':
			// Handle linked records with placeholders
			if (Array.isArray(fieldValue)) {
				const linkedIds = fieldValue.map((link: any) => 
					typeof link === 'string' ? link : link.id
				);
				
				// Store placeholder for later resolution
				linkedRecordPlaceholders.push({
					recordId,
					fieldName: fieldSchema.name,
					linkedRecordIds: linkedIds,
					linkedTableId: fieldSchema.options?.linkedTableId,
				});
				
				// Return the IDs as placeholders
				return linkedIds;
			}
			return null;
		
		case 'multipleAttachments':
			// Return attachment info (will be processed separately)
			if (Array.isArray(fieldValue)) {
				return fieldValue;
			}
			return null;
		
		case 'formula':
			// Handle formula fields based on strategy
			if (formulaStrategy === 'static') {
				// Return computed value
				return convertFormulaResult(fieldValue, fieldSchema);
			}
			else {
				// Try to convert to Obsidian formula
				const converted = convertFormulaToObsidian(fieldValue, fieldSchema);
				if (converted) {
					return converted;
				}
				// Fall back to static value
				return convertFormulaResult(fieldValue, fieldSchema);
			}
		
		case 'rollup':
			// Rollup fields are computed, return the result
			return convertFormulaResult(fieldValue, fieldSchema);
		
		case 'lookup':
			// Lookup fields show values from linked records
			if (Array.isArray(fieldValue)) {
				return fieldValue;
			}
			return fieldValue;
		
		case 'count':
			// Count of linked records
			return Number(fieldValue) || 0;
		
		case 'createdBy':
		case 'lastModifiedBy':
			if (fieldValue && typeof fieldValue === 'object') {
				return fieldValue.name || fieldValue.email || null;
			}
			return null;
		
		case 'button':
			// Button fields have no value
			return null;
		
		case 'barcode':
			if (fieldValue && typeof fieldValue === 'object') {
				return fieldValue.text || null;
			}
			return String(fieldValue);
		
		default:
			// Unknown field type, return as-is
			console.warn(`Unknown field type: ${fieldType}`);
			return fieldValue;
	}
}

/**
 * Convert formula result value based on result type
 */
function convertFormulaResult(value: any, fieldSchema: AirtableFieldSchema): any {
	// Airtable formula can return different types
	if (value === null || value === undefined) {
		return null;
	}
	
	// Check if formula options specify the result type
	const options = fieldSchema.options as any;
	if (options?.result) {
		const resultType = options.result.type;
		switch (resultType) {
			case 'number':
			case 'currency':
			case 'percent':
			case 'duration':
				return Number(value);
			case 'date':
			case 'dateTime':
				return String(value);
			case 'singleSelect':
				return value ? String(value) : null;
			case 'multipleSelects':
				return Array.isArray(value) ? value : [value];
			default:
				return String(value);
		}
	}
	
	// Auto-detect type
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'boolean') {
		return value;
	}
	if (Array.isArray(value)) {
		return value;
	}
	return String(value);
}

/**
 * Convert Airtable formula to Obsidian formula (if possible)
 * Returns null if conversion is not possible
 */
function convertFormulaToObsidian(value: any, fieldSchema: AirtableFieldSchema): string | null {
	// Get the formula expression from field schema options
	const options = fieldSchema.options as any;
	const formulaExpression = options?.formula;
	
	if (!formulaExpression || typeof formulaExpression !== 'string') {
		// No formula expression available
		return null;
	}
	
	// Check if the formula can be converted
	if (!canConvertFormula(formulaExpression)) {
		return null;
	}
	
	// Try to convert the formula
	try {
		const converted = convertAirtableFormulaToObsidian(formulaExpression);
		if (converted) {
			// Return as Obsidian formula (prefixed with =)
			return `= ${converted}`;
		}
	}
	catch (error) {
		console.warn('Failed to convert Airtable formula:', error);
	}
	
	return null;
}

/**
 * Check if a field should be placed in body content instead of frontmatter
 * Typically long text fields should go in the body
 */
export function shouldFieldGoToBody(fieldSchema: AirtableFieldSchema): boolean {
	const longTextTypes = ['multilineText', 'richText'];
	return longTextTypes.includes(fieldSchema.type);
}

/**
 * Get display name for a field value (for use in wiki links)
 */
export function getFieldDisplayValue(value: any, fieldSchema: AirtableFieldSchema): string {
	if (value === null || value === undefined) {
		return '';
	}
	
	switch (fieldSchema.type) {
		case 'singleLineText':
		case 'multilineText':
		case 'email':
		case 'url':
		case 'phoneNumber':
			return String(value);
		
		case 'number':
		case 'currency':
		case 'percent':
		case 'duration':
		case 'rating':
		case 'autoNumber':
			return String(value);
		
		case 'singleSelect':
		case 'multipleSelects':
			if (Array.isArray(value)) {
				return value.join(', ');
			}
			return String(value);
		
		case 'date':
		case 'dateTime':
			return String(value);
		
		case 'checkbox':
			return value ? '✓' : '';
		
		default:
			return String(value);
	}
}

