/**
 * Field converter for Airtable fields to Obsidian properties
 */

import type { AirtableFieldSchema, FormulaImportStrategy, LinkedRecordPlaceholder } from './types';
import { ImportContext } from '../../main';
import { convertAirtableFormulaToObsidian, canConvertFormula } from './formula-converter';

/**
 * Create a mapping from field IDs to field names
 * 
 * This is needed because Airtable uses field IDs internally in formulas (e.g., {fldXXX}),
 * but the API returns record data with field names as keys.
 * 
 * Example:
 * - Formula: "UPPER({fldji0lrlb52vV1ae})"
 * - Record data: { "Example text": "hello" }
 * - We need to map: fldji0lrlb52vV1ae → "Example text"
 * 
 * @param fields - Array of field schemas containing id and name
 * @returns Map from field ID to field name
 */
export function createFieldIdToNameMap(fields: any[]): Map<string, string> {
	const fieldIdToNameMap = new Map<string, string>();
	for (const field of fields) {
		if (field.id && field.name) {
			fieldIdToNameMap.set(field.id, field.name);
		}
	}
	return fieldIdToNameMap;
}

/**
 * Convert Airtable field value to Obsidian property value
 */
export function convertFieldValue(
	fieldValue: any,
	fieldSchema: AirtableFieldSchema,
	recordId: string,
	formulaStrategy: FormulaImportStrategy,
	linkedRecordPlaceholders: LinkedRecordPlaceholder[],
	ctx: ImportContext,
	fieldIdToNameMap?: Map<string, string>
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
				const converted = convertFormulaToObsidian(fieldValue, fieldSchema, fieldIdToNameMap);
				if (converted) {
					// Formula successfully converted - it will be defined in .base file
					// Return null so it's not added to YAML frontmatter
					console.log(`✓ Formula field "${fieldSchema.name}" converted, skipping YAML`);
					return null;
				}
				// Fall back to static value (formula couldn't be converted)
				console.log(`✗ Formula field "${fieldSchema.name}" could not be converted, using static value`);
				return convertFormulaResult(fieldValue, fieldSchema);
			}
		
		case 'rollup':
			// Rollup fields - check if can be converted to formula
			if (formulaStrategy === 'hybrid' && fieldIdToNameMap) {
				const options = fieldSchema.options as any;
				const linkedFieldId = options?.recordLinkFieldId;
				const rollupFieldId = options?.fieldIdInLinkedTable;
				
				if (linkedFieldId && rollupFieldId) {
					const linkedFieldName = fieldIdToNameMap.get(linkedFieldId);
					const rollupFieldName = fieldIdToNameMap.get(rollupFieldId);
					
					if (linkedFieldName && rollupFieldName) {
						// Can be converted to formula - return null to skip YAML
						console.log(`✓ Rollup field "${fieldSchema.name}" converted to formula, skipping YAML`);
						return null;
					}
				}
			}
			// Fall back to static value
			return convertFormulaResult(fieldValue, fieldSchema);
		
		case 'lookup':
			// Lookup fields - check if can be converted to formula
			if (formulaStrategy === 'hybrid' && fieldIdToNameMap) {
				const options = fieldSchema.options as any;
				const linkedFieldId = options?.recordLinkFieldId;
				const lookupFieldId = options?.fieldIdInLinkedTable;
				
				if (linkedFieldId && lookupFieldId) {
					const linkedFieldName = fieldIdToNameMap.get(linkedFieldId);
					const lookupFieldName = fieldIdToNameMap.get(lookupFieldId);
					
					if (linkedFieldName && lookupFieldName) {
						// Can be converted to formula - return null to skip YAML
						console.log(`✓ Lookup field "${fieldSchema.name}" converted to formula, skipping YAML`);
						return null;
					}
				}
			}
			// Fall back to static value
			if (Array.isArray(fieldValue)) {
				return fieldValue;
			}
			return fieldValue;
		
		case 'count':
			// Count fields - check if can be converted to formula
			if (formulaStrategy === 'hybrid' && fieldIdToNameMap) {
				const options = fieldSchema.options as any;
				const linkedFieldId = options?.recordLinkFieldId;
				
				if (linkedFieldId) {
					const linkedFieldName = fieldIdToNameMap.get(linkedFieldId);
					
					if (linkedFieldName) {
						// Can be converted to formula - return null to skip YAML
						console.log(`✓ Count field "${fieldSchema.name}" converted to formula, skipping YAML`);
						return null;
					}
				}
			}
			// Fall back to static value
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
		
		case 'multipleLookupValues':
			// This is the result type for Lookup fields (similar to lookup but explicit type)
			// It's handled the same as lookup - return the array of values
			if (formulaStrategy === 'hybrid' && fieldIdToNameMap) {
				const options = fieldSchema.options as any;
				const linkedFieldId = options?.recordLinkFieldId;
				const lookupFieldId = options?.fieldIdInLinkedTable;
				
				if (linkedFieldId && lookupFieldId) {
					const linkedFieldName = fieldIdToNameMap.get(linkedFieldId);
					const lookupFieldName = fieldIdToNameMap.get(lookupFieldId);
					
					if (linkedFieldName && lookupFieldName) {
						// Can be converted to formula - return null to skip YAML
						console.log(`✓ MultipleLookupValues field "${fieldSchema.name}" converted to formula, skipping YAML`);
						return null;
					}
				}
			}
			// Fall back to static value
			if (Array.isArray(fieldValue)) {
				return fieldValue;
			}
			return fieldValue;
		
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
function convertFormulaToObsidian(
	value: any,
	fieldSchema: AirtableFieldSchema,
	fieldIdToNameMap?: Map<string, string>
): string | null {
	// Get the formula expression from field schema options
	const options = fieldSchema.options as any;
	const formulaExpression = options?.formula;
	
	console.log(`Converting formula for "${fieldSchema.name}":`, {
		hasOptions: !!options,
		formulaExpression,
		hasFieldIdMap: !!fieldIdToNameMap,
		fieldIdMapSize: fieldIdToNameMap?.size
	});
	
	if (!formulaExpression || typeof formulaExpression !== 'string') {
		// No formula expression available
		console.log(`  → No formula expression found`);
		return null;
	}
	
	// Check if the formula can be converted
	if (!canConvertFormula(formulaExpression)) {
		console.log(`  → Formula cannot be converted (unsupported functions)`);
		return null;
	}
	
	// Try to convert the formula
	try {
		const converted = convertAirtableFormulaToObsidian(formulaExpression, fieldIdToNameMap);
		if (converted) {
			// Formula successfully converted - return a marker (actual formula is in .base file)
			console.log(`  → Converted to: ${converted}`);
			return '__FORMULA_CONVERTED__'; // Marker to indicate formula was converted
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

