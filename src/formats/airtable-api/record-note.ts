/**
 * One Airtable record as a note, separate from the importer that writes it.
 *
 * A record becomes frontmatter properties plus whatever body template the user
 * configured. Downloading an attachment and deciding where it lands is the
 * caller's, passed in as a callback, as is rendering one into the body - both
 * need a vault. Linked records are written as placeholders here and resolved by
 * the importer once every note has a final path.
 */
import { FrontMatterCache } from 'obsidian';
import { serializeFrontMatter } from '../../util';
import { applyTemplate } from '../../template';
import { convertFieldValue } from './field-converter';
import { sanitizePropertyName } from './base-file';
import type { AirtableAttachment, AirtableFieldSchema, AirtableRecord, AttachmentResult } from './types';

/**
 * Linked records are written as a placeholder and resolved once every record
 * has a final file path. Resolving inline would bake in a title that a later
 * filename conflict can still change, leaving earlier-written records pointing
 * at the wrong file. Both halves live here so the emitted token and the pattern
 * that matches it cannot drift apart.
 */
export function createRecordLinkPlaceholder(baseId: string, recordId: string): string {
	return `[[airtable-record:${baseId}:${recordId}]]`;
}

export const RECORD_LINK_PLACEHOLDER_PATTERN = /\[\[airtable-record:([^:\]]+):([^\]]+)\]\]/g;

/**
 * Render a field value as a plain string, for the note title and for body
 * templates. Handles the shapes a primary field can take: barcode objects,
 * arrays from formula results, and anything else Airtable returns.
 */
export function extractStringValue(value: any): string {
	if (value === null || value === undefined) return '';
	// Handle barcode: { text: "xxx", type: "code39" }
	if (typeof value === 'object' && !Array.isArray(value) && value.text !== undefined) {
		return String(value.text);
	}
	// Handle arrays (some formula results)
	if (Array.isArray(value)) {
		return value.map(v => String(v)).join(', ');
	}
	// Handle other objects (shouldn't happen for primary fields, but just in case)
	if (typeof value === 'object') {
		return JSON.stringify(value);
	}
	return String(value);
}

/** A record with nothing in any field, which is written as no note at all. */
export function isEmptyRecord(record: AirtableRecord): boolean {
	return !Object.values(record.fields || {}).some(value => {
		if (value === null || value === undefined) return false;
		if (typeof value === 'string' && value.trim() === '') return false;
		if (typeof value === 'object' && !Array.isArray(value)) {
			// For aiText objects, check if they have valid state
			if (value.state && value.state !== 'generated') return false;
			if (value.state === 'generated' && !value.value) return false;
		}
		if (Array.isArray(value) && value.length === 0) return false;
		return true;
	});
}

/** The note's title: Airtable always uses the table's primary field. */
export function recordTitle(record: AirtableRecord, primaryFieldName: string): string {
	const title = extractStringValue((record.fields || {})[primaryFieldName]);
	return title.trim() === '' ? 'Untitled Record' : title;
}

export interface BuildRecordNoteOptions {
	baseId: string;
	fields: AirtableFieldSchema[];
	/** Views this record belongs to, as the .base file refers to them. */
	viewReferences: string[];
	/** Property the view references are written under. */
	viewPropertyName: string;
	/** Fields the table's .base file defines a formula for; see ConvertFieldOptions */
	formulaFieldNames: Set<string>;
	/**
	 * This table's fields that get a frontmatter property, with the property name
	 * already resolved.
	 */
	frontMatterFields: Array<{ fieldName: string, propertyName: string }>;
	/**
	 * Write the record's id into the note. Only worth the space when incremental
	 * import is on, which is what matches on it to recognise an already-imported
	 * record.
	 */
	recordId?: boolean;
	bodyTemplate?: string;
	/**
	 * The property name a rollup the .base does not compute is written under, or
	 * null for no property at all.
	 */
	propertyNameForRollup: (fieldName: string) => string | null;
	/** Download one field's attachments and report where they landed. */
	resolveAttachments: (attachments: AirtableAttachment[]) => Promise<AttachmentResult[]>;
	/** Render downloaded attachments into the note body. */
	formatAttachmentsForBody: (results: AttachmentResult[]) => string[];
	/** Render downloaded attachments into a frontmatter property. */
	formatAttachmentsForYAML: (results: AttachmentResult[]) => string[];
}

export interface BuiltRecordNote {
	content: string;
	/** Whether the note carries a linked-record placeholder still to resolve. */
	hasRecordLinks: boolean;
}

export async function buildRecordNote(
	record: AirtableRecord,
	options: BuildRecordNoteOptions
): Promise<BuiltRecordNote> {
	const {
		baseId, fields, viewReferences, viewPropertyName, formulaFieldNames,
		frontMatterFields, recordId, bodyTemplate, propertyNameForRollup,
		resolveAttachments, formatAttachmentsForBody, formatAttachmentsForYAML,
	} = options;

	const recordFields = record.fields || {};
	const hasBodyTemplate = !!bodyTemplate?.trim();
	const templateData: Record<string, string> = {};
	// Cache converted values for frontmatter
	const convertedCache = new Map<string, any>();

	// Convert field values
	// Track rollup fields to ensure their property names appear in YAML (with null value)
	const rollupFieldNames = new Set<string>();
	// Track attachment fields so the frontmatter pass can format the already-downloaded results
	const attachmentFieldNames = new Set<string>();
	// Whether this note ends up carrying a linked-record placeholder
	let hasRecordLinks = false;

	for (const field of fields) {
		const fieldValue = recordFields[field.name];

		// Rollup fields: API doesn't expose aggregation function, so only import property name
		if (field.type === 'rollup') {
			rollupFieldNames.add(field.name);
			if (hasBodyTemplate) templateData[field.name] = '';
			continue;
		}

		if (fieldValue === null || fieldValue === undefined) {
			if (hasBodyTemplate) templateData[field.name] = '';
			continue;
		}

		// Handle linked records - emit placeholders, resolved once every file exists
		if (field.type === 'multipleRecordLinks' && Array.isArray(fieldValue)) {
			const links = fieldValue.map((linkedRecordId: string) =>
				createRecordLinkPlaceholder(baseId, linkedRecordId)
			);
			hasRecordLinks ||= links.length > 0;
			convertedCache.set(field.name, links);
			if (hasBodyTemplate) templateData[field.name] = links.join(', ');
			continue;
		}

		// Handle attachments - download once, then format for body and/or YAML
		if (field.type === 'multipleAttachments' && Array.isArray(fieldValue)) {
			const downloaded = await resolveAttachments(fieldValue as AirtableAttachment[]);
			attachmentFieldNames.add(field.name);
			convertedCache.set(field.name, downloaded);

			if (hasBodyTemplate) {
				templateData[field.name] = formatAttachmentsForBody(downloaded).join('\n');
			}
			continue;
		}

		// Convert other field types
		const convertedValue = convertFieldValue({
			fieldValue,
			fieldSchema: field,
			computedByBase: formulaFieldNames.has(field.name),
		});

		// Cache converted value for frontmatter pass
		convertedCache.set(field.name, convertedValue);

		// Convert to string for template (only if needed).
		// A field the .base computes has no frontmatter value, but a body
		// template still has to render something, so fall back to the value
		// Airtable computed. This is deliberately kept out of convertedCache:
		// writing it there would put the static value back into frontmatter
		// and leave the note and the .base each holding their own copy.
		if (hasBodyTemplate) {
			const templateValue = convertedValue === null && formulaFieldNames.has(field.name)
				? fieldValue
				: convertedValue;

			if (templateValue === null || templateValue === undefined) {
				templateData[field.name] = '';
			}
			else if (Array.isArray(templateValue)) {
				templateData[field.name] = templateValue.map((item: any) => {
					if (typeof item === 'string') return item;
					return String(item);
				}).join(', ');
			}
			else {
				templateData[field.name] = String(templateValue);
			}
		}
	}

	const frontMatter: FrontMatterCache = {};
	if (recordId) {
		frontMatter['airtable-id'] = record.id;
	}

	if (viewReferences.length > 0) {
		frontMatter[viewPropertyName] = viewReferences;
	}

	// Process fields for frontmatter, using the property names resolved once
	// for this table
	for (const { fieldName, propertyName } of frontMatterFields) {
		// Get cached converted value (already processed in first pass)
		const convertedValue = convertedCache.get(fieldName);

		// Skip if convertedValue is null/undefined/empty string
		if (convertedValue === null || convertedValue === undefined || convertedValue === '') {
			continue;
		}

		// Attachments: format the results downloaded in the pass above into
		// wiki links for YAML (no second download)
		const propertyValue = attachmentFieldNames.has(fieldName)
			? formatAttachmentsForYAML(convertedValue as AttachmentResult[])
			: convertedValue;

		// Ensure we're not setting complex objects that could cause YAML serialization issues
		if (typeof propertyValue === 'object' && !Array.isArray(propertyValue)) {
			console.warn(`[Airtable] Skipping complex object for property "${propertyName}"`);
			continue;
		}

		frontMatter[propertyName] = propertyValue;
	}

	// A rollup the .base does not compute gets its property name with a null
	// value, so the property exists for the user to fill in. One the .base
	// does compute needs nothing here - the note would otherwise carry an
	// empty property shadowing the formula column of the same name.
	for (const fieldName of rollupFieldNames) {
		if (formulaFieldNames.has(fieldName)) continue;

		const propertyName = propertyNameForRollup(fieldName);
		if (propertyName) {
			frontMatter[propertyName] = null;
		}
	}

	const bodyContent = hasBodyTemplate ? applyTemplate(bodyTemplate!, templateData) : '';

	return {
		content: `${serializeFrontMatter(frontMatter)}${bodyContent}`.trim(),
		hasRecordLinks,
	};
}

export interface FrontMatterFieldsOptions {
	fields: AirtableFieldSchema[];
	/** Field name -> the property the user chose for it; empty means don't write it. */
	propertyNames: Map<string, string>;
	/** Field name -> the value template for it; empty means don't write it. */
	propertyValues: Map<string, string>;
	viewPropertyName: string;
	propertyNameForField: (fieldName: string) => string;
}

/**
 * The fields of one table that get written as frontmatter properties, paired
 * with the property name each is written under.
 *
 * The template config covers every selected table at once, so resolving this
 * per record would walk every field of every table for each note.
 */
export function frontMatterFieldsForTable(
	options: FrontMatterFieldsOptions
): Array<{ fieldName: string, propertyName: string }> {
	const { fields, propertyNames, propertyValues, viewPropertyName, propertyNameForField } = options;
	const frontMatterFields = [];

	for (const field of fields) {
		const configured = propertyNames.get(field.name);
		if (!configured?.trim()) continue;

		// Skip the view property name to avoid duplicates
		if (configured === viewPropertyName) continue;

		if (!propertyValues.get(field.name)) continue;

		frontMatterFields.push({
			fieldName: field.name,
			propertyName: propertyNameForField(field.name),
		});
	}

	return frontMatterFields;
}

/**
 * What the template configurator starts from: every field becomes a property
 * under its own name, with the value the field holds.
 *
 * A field named like the view property is left out - that one is the importer's
 * own, and a field writing to it would fight with the view references.
 */
export function defaultPropertyConfig(
	fields: Iterable<AirtableFieldSchema>,
	viewPropertyName: string
): { propertyNames: Map<string, string>, propertyValues: Map<string, string> } {
	const propertyNames = new Map<string, string>();
	const propertyValues = new Map<string, string>();

	for (const field of fields) {
		const sanitizedName = sanitizePropertyName(field.name);

		if (sanitizedName.toLowerCase() === viewPropertyName.toLowerCase()) {
			continue;
		}

		propertyNames.set(field.name, sanitizedName);
		propertyValues.set(field.name, `{{${field.name}}}`);
	}

	return { propertyNames, propertyValues };
}
