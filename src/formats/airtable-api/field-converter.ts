/**
 * Field converter for Airtable fields to Obsidian properties
 */

import type { AirtableFieldSchema, ConvertFieldOptions } from './types';
import { convertAirtableFormulaToObsidian } from './formula-converter';

/** Field types already warned about, so the warning is not repeated per record */
const warnedUnknownFieldTypes: Set<string> = new Set();

/**
 * Convert Airtable field value to Obsidian property value
 * @returns Converted value (string, number, boolean, array, or null)
 */
export function convertFieldValue(options: ConvertFieldOptions): any {
	const { fieldValue, fieldSchema, formulaStrategy, fieldIdToNameMap } = options;

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
		case 'rating':
			// Treat as numbers
			if (fieldValue === null || fieldValue === undefined) return null;
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
			// Return linked record IDs (will be resolved to titles in createRecordFile)
			if (Array.isArray(fieldValue)) {
				return fieldValue.map((link: any) =>
					typeof link === 'string' ? link : link.id
				);
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
					return null;
				}
				// Fall back to static value (formula couldn't be converted)
				return convertFormulaResult(fieldValue, fieldSchema);
			}

		case 'rollup':
			// Rollup fields: Airtable API does not expose the rollup aggregation function,
			// so we cannot convert it to an Obsidian formula.
			// Only import the property name (return null to skip value in YAML).
			// Users can manually add formulas in Obsidian after import.
			return null;

		case 'count':
			// Count fields - check if can be converted to formula
			if (formulaStrategy === 'hybrid' && fieldIdToNameMap) {
				const options = fieldSchema.options;
				const linkedFieldId = options?.recordLinkFieldId;

				if (linkedFieldId) {
					const linkedFieldName = fieldIdToNameMap.get(linkedFieldId);

					if (linkedFieldName) {
						// Can be converted to formula - return null to skip YAML
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
			// Unknown field type, return as-is. Warn once per type rather than
			// once per record.
			if (!warnedUnknownFieldTypes.has(fieldType)) {
				warnedUnknownFieldTypes.add(fieldType);
				console.warn(`Unknown field type: ${fieldType}`);
			}
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
 * Whether a field's formula converted, cached per field.
 *
 * Convertibility depends only on the field schema, but convertFieldValue runs
 * once per record - without this a large table re-parses the same expression
 * thousands of times.
 */
const formulaConversionCache: Map<string, boolean> = new Map();

/**
 * Reset the formula cache. Call between bases, since field IDs are only unique
 * within a base.
 */
export function clearFormulaConversionCache(): void {
	formulaConversionCache.clear();
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

	if (!formulaExpression || typeof formulaExpression !== 'string') {
		// No formula expression available
		return null;
	}

	const cacheKey = fieldSchema.id || fieldSchema.name;
	const cached = formulaConversionCache.get(cacheKey);
	if (cached !== undefined) {
		return cached ? FORMULA_CONVERTED_MARKER : null;
	}

	// Try to convert the formula
	let converted = false;
	try {
		converted = !!convertAirtableFormulaToObsidian(formulaExpression, fieldIdToNameMap);
	}
	catch (error) {
		console.warn('Failed to convert Airtable formula:', error);
	}

	formulaConversionCache.set(cacheKey, converted);

	// The actual formula text is written to the .base file; callers only need to
	// know that it converted, so the value here is just a marker.
	return converted ? FORMULA_CONVERTED_MARKER : null;
}

const FORMULA_CONVERTED_MARKER = '__FORMULA_CONVERTED__';


