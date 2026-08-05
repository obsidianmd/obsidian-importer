/**
 * One Airtable record as a note, separate from the importer that writes it.
 *
 * A record becomes frontmatter properties plus whatever body template the user
 * configured. Downloading an attachment and deciding where it lands is the
 * caller's, passed in as a callback, as is rendering one into the body - both
 * need a vault, as does knowing what path a linked record's note ended up at -
 * the importer settles every path in a base before the first note is built, so
 * a link can be written into the note the first time round.
 */
import { FrontMatterCache } from 'obsidian';
import { sanitizeFileName, serializeFrontMatter } from '../../util';
import { applyTemplate } from '../../template';
import { convertFieldValue } from './field-converter';
import { sanitizePropertyName } from './base-file';
import type { AirtableAttachment, AirtableFieldSchema, AirtableRecord, AttachmentResult } from './types';

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
	fields: AirtableFieldSchema[];
	/** The field the note is titled after. */
	primaryFieldName: string;
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
	 * Where a linked record's note ended up, as the text to put between
	 * brackets, or null where the import writes no note for it - a table the
	 * user did not tick, or a record with nothing in it.
	 *
	 * The caller settles every path in the base before the first note is built,
	 * so this can answer for a record whose note has not been written yet.
	 */
	resolveRecordLink?: (recordId: string) => string | null;
	/**
	 * The title of a record no note is written for, which is the best a link to
	 * it can do. Undefined where the title was never fetched, leaving the id.
	 */
	externalRecordTitle?: (recordId: string) => string | undefined;
	/** Download one field's attachments and report where they landed. */
	resolveAttachments: (attachments: AirtableAttachment[]) => Promise<AttachmentResult[]>;
	/** Render downloaded attachments into the note body. */
	formatAttachmentsForBody: (results: AttachmentResult[]) => string[];
	/** Render downloaded attachments into a frontmatter property. */
	formatAttachmentsForYAML: (results: AttachmentResult[]) => string[];
}

export interface BuiltRecordNote {
	content: string;
}

export async function buildRecordNote(
	record: AirtableRecord,
	options: BuildRecordNoteOptions
): Promise<BuiltRecordNote> {
	const {
		fields, primaryFieldName, viewReferences, viewPropertyName, formulaFieldNames,
		frontMatterFields, recordId, bodyTemplate, resolveRecordLink, externalRecordTitle,
		resolveAttachments, formatAttachmentsForBody, formatAttachmentsForYAML,
	} = options;

	const recordFields = record.fields || {};
	const hasBodyTemplate = !!bodyTemplate?.trim();
	const templateData: Record<string, string> = {};
	// Cache converted values for frontmatter
	const convertedCache = new Map<string, any>();

	// Convert field values
	// Track attachment fields so the frontmatter pass can format the already-downloaded results
	const attachmentFieldNames = new Set<string>();

	for (const field of fields) {
		const fieldValue = recordFields[field.name];

		if (fieldValue === null || fieldValue === undefined) {
			if (hasBodyTemplate) templateData[field.name] = '';
			continue;
		}

		// Handle linked records - a link where the import writes a note, the
		// record's name as plain text where it does not
		if (field.type === 'multipleRecordLinks' && Array.isArray(fieldValue)) {
			const links = fieldValue.map((linkedRecordId: string) => {
				const target = resolveRecordLink?.(linkedRecordId);
				if (target) return `[[${target}]]`;

				// Nothing to point at: a table the user left out, or a record
				// with nothing in it. Its name is the most a reader can use.
				const title = externalRecordTitle?.(linkedRecordId);
				return title ? sanitizeFileName(title) : `Unknown record ${linkedRecordId}`;
			});
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

	// The title is the file name, so it is only worth writing down where the
	// two differ - a title a file name cannot hold is otherwise lost. Written
	// after the fields below, so a field mapped to "aliases" does not lose it.
	const title = recordTitle(record, primaryFieldName);
	const alias = title === sanitizeFileName(title) ? null : title;

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

	if (alias) {
		// FrontMatterCache holds any, so what is already there is narrowed
		// before it is spread rather than after
		const existing: unknown = frontMatter['aliases'];
		const rest: unknown[] = Array.isArray(existing) ? existing : [];
		frontMatter['aliases'] = [alias, ...rest];
	}

	const bodyContent = hasBodyTemplate ? applyTemplate(bodyTemplate!, templateData) : '';

	return {
		content: `${serializeFrontMatter(frontMatter)}${bodyContent}`.trim(),
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
	/**
	 * The table's primary field, left out: it is the note's title, and the
	 * .base file shows it as file.name, so a property would say it twice.
	 */
	primaryFieldName: string;
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
	const { fields, propertyNames, propertyValues, viewPropertyName, propertyNameForField, primaryFieldName } = options;
	const frontMatterFields = [];

	for (const field of fields) {
		if (field.name === primaryFieldName) continue;

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
