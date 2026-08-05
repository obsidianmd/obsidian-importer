/**
 * Field converter for Airtable fields to Obsidian properties
 */

import type { AirtableFieldSchema, ConvertFieldOptions } from './types';

/**
 * Obsidian property type for each Airtable field type.
 *
 * A null means "computed" — Obsidian infers the type from the value rather than
 * being told. A type absent from the table falls back to text.
 */
export const PROPERTY_TYPE_FOR_FIELD_TYPE: Record<string, string | null> = {
	checkbox: 'checkbox',
	date: 'date',
	dateTime: 'datetime',
	createdTime: 'datetime',
	lastModifiedTime: 'datetime',
	number: 'number',
	percent: 'number',
	duration: 'number',
	autoNumber: 'number',
	currency: 'number',
	rating: 'number',
	singleSelect: 'text',
	singleLineText: 'text',
	multilineText: 'text',
	richText: 'text',
	email: 'text',
	url: 'text',
	phoneNumber: 'text',
	barcode: 'text',
	aiText: 'text',
	singleCollaborator: 'text',
	createdBy: 'text',
	lastModifiedBy: 'text',
	multipleSelects: 'multitext',
	multipleCollaborators: 'multitext',
	multipleRecordLinks: 'multitext',
	multipleAttachments: 'multitext',
	formula: null,
	rollup: null,
	multipleLookupValues: null,
	count: null,
};

/**
 * Map Airtable field type to Obsidian property type
 */
export function mapAirtableTypeToObsidian(airtableType: string): string | null {
	if (airtableType in PROPERTY_TYPE_FOR_FIELD_TYPE) {
		return PROPERTY_TYPE_FOR_FIELD_TYPE[airtableType];
	}

	console.warn(`[Airtable] Unknown field type: ${airtableType}, treating as text`);
	return 'text';
}

/** Field types already warned about, so the warning is not repeated per record */
const warnedUnknownFieldTypes: Set<string> = new Set();

/**
 * Convert Airtable field value to Obsidian property value
 * @returns Converted value (string, number, boolean, array, or null)
 */
export function convertFieldValue(options: ConvertFieldOptions): any {
	const { fieldValue, fieldSchema, computedByBase } = options;

	if (fieldValue === null || fieldValue === undefined) {
		return null;
	}

	// The .base file recomputes this field, so writing Airtable's snapshot of it
	// into the note as well would only give the two a chance to disagree.
	if (computedByBase) {
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
			// Not converted to a .base formula, so keep Airtable's computed value
			return convertFormulaResult(fieldValue, fieldSchema);

		case 'rollup':
			// Rollup fields: Airtable API does not expose the rollup aggregation function,
			// so we cannot convert it to an Obsidian formula.
			// Only import the property name (return null to skip value in YAML).
			// Users can manually add formulas in Obsidian after import.
			return null;

		case 'count':
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


