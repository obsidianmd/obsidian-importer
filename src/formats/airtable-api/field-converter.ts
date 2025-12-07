/**
 * Field converter for Airtable fields to Obsidian properties
 */

import type { AirtableFieldSchema, ConvertFieldOptions } from './types';
import { convertAirtableFormulaToObsidian, canConvertFormula } from './formula-converter';

/**
 * Convert Airtable field value to Obsidian property value
 * @returns Converted value (string, number, boolean, array, or null)
 */
export function convertFieldValue(options: ConvertFieldOptions): any {
	const { fieldValue, fieldSchema, recordId, formulaStrategy, linkedRecordPlaceholders, fieldIdToNameMap } = options;
	
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
		case 'percent':
		case 'duration':
		case 'autoNumber':
			return Number(fieldValue);
		
		case 'currency':
			// Format currency with symbol prefix (e.g., "$100.00")
			if (fieldValue === null || fieldValue === undefined) return null;
			const currencyOptions = fieldSchema.options;
			const symbol = currencyOptions?.symbol || '$';
			const precision = currencyOptions?.precision ?? 2;
			const numValue = Number(fieldValue);
			return `${symbol}${numValue.toFixed(precision)}`;
		
		case 'rating':
			// Convert rating to repeated icons (e.g., "⭐⭐⭐" for rating 3)
			if (fieldValue === null || fieldValue === undefined) return null;
			const ratingOptions = fieldSchema.options;
			const icon = ratingOptions?.icon || 'star';
			const ratingValue = Number(fieldValue) || 0;
			// Map Airtable icon types to emoji/unicode
			const iconMap: Record<string, string> = {
				'star': '⭐',
				'heart': '❤️',
				'thumbsUp': '👍',
				'flag': '🚩',
				'dot': '●',
			};
			const iconChar = iconMap[icon] || '⭐';
			return iconChar.repeat(ratingValue);
		
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
				const converted = convertFormulaToObsidian(fieldSchema, fieldIdToNameMap);
				if (converted) {
					// Formula successfully converted - it will be defined in .base file
					// Return null so it's not added to YAML frontmatter
					console.log(`Formula field "${fieldSchema.name}" converted, skipping YAML`);
					return null;
				}
				// Fall back to static value (formula couldn't be converted)
				console.log(`Formula field "${fieldSchema.name}" could not be converted, using static value`);
				return convertFormulaResult(fieldValue, fieldSchema);
			}
		
		case 'rollup':
			// Rollup fields - check if can be converted to formula
			if (formulaStrategy === 'hybrid' && fieldIdToNameMap) {
				const options = fieldSchema.options;
				const linkedFieldId = options?.recordLinkFieldId;
				const rollupFieldId = options?.fieldIdInLinkedTable;
				
				if (linkedFieldId && rollupFieldId) {
					const linkedFieldName = fieldIdToNameMap.get(linkedFieldId);
					const rollupFieldName = fieldIdToNameMap.get(rollupFieldId);
					
					if (linkedFieldName && rollupFieldName) {
						// Can be converted to formula - return null to skip YAML
						console.log(`Rollup field "${fieldSchema.name}" converted to formula, skipping YAML`);
						return null;
					}
				}
			}
			// Fall back to static value
			return convertFormulaResult(fieldValue, fieldSchema);
		
		case 'count':
			// Count fields - check if can be converted to formula
			if (formulaStrategy === 'hybrid' && fieldIdToNameMap) {
				const options = fieldSchema.options;
				const linkedFieldId = options?.recordLinkFieldId;
				
				if (linkedFieldId) {
					const linkedFieldName = fieldIdToNameMap.get(linkedFieldId);
					
					if (linkedFieldName) {
						// Can be converted to formula - return null to skip YAML
						console.log(`Count field "${fieldSchema.name}" converted to formula, skipping YAML`);
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
			// Lookup fields in Airtable API return type 'multipleLookupValues'
			if (formulaStrategy === 'hybrid' && fieldIdToNameMap) {
				const options = fieldSchema.options;
				const linkedFieldId = options?.recordLinkFieldId;
				const lookupFieldId = options?.fieldIdInLinkedTable;
				
				if (linkedFieldId && lookupFieldId) {
					const linkedFieldName = fieldIdToNameMap.get(linkedFieldId);
					const lookupFieldName = fieldIdToNameMap.get(lookupFieldId);
					
					if (linkedFieldName && lookupFieldName) {
						// Can be converted to formula - return null to skip YAML
						console.log(`Lookup field "${fieldSchema.name}" converted to formula, skipping YAML`);
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
 * @param value - Formula result (type varies)
 * @returns Converted value (string, number, boolean, array, or null)
 */
function convertFormulaResult(value: any, fieldSchema: AirtableFieldSchema): any {
	// Airtable formula can return different types
	if (value === null || value === undefined) {
		return null;
	}
	
	// Check if formula options specify the result type
	const options = fieldSchema.options;
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
	
	// Auto-detect type: return primitives and arrays as-is, otherwise convert to string
	if (typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
		return value;
	}
	return String(value);
}

/**
 * Convert Airtable formula to Obsidian formula (if possible)
 * Returns null if conversion is not possible
 */
function convertFormulaToObsidian(
	fieldSchema: AirtableFieldSchema,
	fieldIdToNameMap?: Map<string, string>
): string | null {
	// Get the formula expression from field schema options
	const options = fieldSchema.options;
	const formulaExpression = options?.formula;
	
	console.log(`Converting formula for "${fieldSchema.name}":`, {
		hasOptions: !!options,
		formulaExpression,
		hasFieldIdMap: !!fieldIdToNameMap,
		fieldIdMapSize: fieldIdToNameMap?.size
	});
	
	if (!formulaExpression || typeof formulaExpression !== 'string') {
		// No formula expression available
		console.log(`No formula expression found`);
		return null;
	}
	
	// Check if the formula can be converted
	if (!canConvertFormula(formulaExpression)) {
		console.log(`Formula cannot be converted (unsupported functions)`);
		return null;
	}
	
	// Try to convert the formula
	try {
		const converted = convertAirtableFormulaToObsidian(formulaExpression, fieldIdToNameMap);
		if (converted) {
			// Formula successfully converted - return a marker (actual formula is in .base file)
			console.log(`Converted to: ${converted}`);
			return '__FORMULA_CONVERTED__'; // Marker to indicate formula was converted
		}
	}
	catch (error) {
		console.warn('Failed to convert Airtable formula:', error);
	}
	
	return null;
}


