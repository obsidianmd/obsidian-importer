import { FrontMatterCache } from 'obsidian';
import { sanitizeFileName, serializeFrontMatter } from '../../util';
import { applyTemplate } from '../../template';
import { convertFieldValue } from './field-converter';
import { sanitizePropertyName } from './base-file';
import type { AirtableAttachment, AirtableFieldSchema, AirtableRecord, AttachmentResult } from './types';

export const RECORD_ID_PROPERTY = 'airtable-id';

/**
 * The times to write onto a record's note: ctime only.
 *
 * Airtable reports when a record was created and nothing about when it last
 * changed - a "Last modified time" field exists only if the base was built
 * with one, is named whatever its author called it, and can be scoped to a few
 * fields rather than all of them. A modification time that is wrong about a
 * record having changed is worse than none, so an import writes none and
 * compares the note's text instead.
 */
export function recordTimestamps(record: AirtableRecord): { ctime?: number } {
	const created = Date.parse(record.createdTime ?? '');

	return Number.isNaN(created) ? {} : { ctime: created };
}

export function extractStringValue(value: any): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'object' && !Array.isArray(value) && value.text !== undefined) {
		return String(value.text);
	}
	if (Array.isArray(value)) {
		return value.map(v => String(v)).join(', ');
	}
	if (typeof value === 'object') {
		return JSON.stringify(value);
	}
	return String(value);
}

export function isEmptyRecord(record: AirtableRecord): boolean {
	return !Object.values(record.fields || {}).some(value => {
		if (value === null || value === undefined) return false;
		if (typeof value === 'string' && value.trim() === '') return false;
		if (typeof value === 'object' && !Array.isArray(value)) {
			if (value.state && value.state !== 'generated') return false;
			if (value.state === 'generated' && !value.value) return false;
		}
		if (Array.isArray(value) && value.length === 0) return false;
		return true;
	});
}

export function recordTitle(record: AirtableRecord, primaryFieldName: string): string {
	const title = extractStringValue((record.fields || {})[primaryFieldName]);
	return title.trim() === '' ? 'Untitled Record' : title;
}

export interface BuildRecordNoteOptions {
	fields: AirtableFieldSchema[];
	primaryFieldName: string;
	viewReferences: string[];
	viewPropertyName: string;
	formulaFieldNames: Set<string>;
	frontMatterFields: Array<{ fieldName: string, propertyName: string }>;
	recordId?: boolean;
	bodyTemplate?: string;
	resolveRecordLink?: (recordId: string) => string | null;
	externalRecordTitle?: (recordId: string) => string | undefined;
	resolveAttachments: (attachments: AirtableAttachment[]) => Promise<AttachmentResult[]>;
	formatAttachmentsForBody: (results: AttachmentResult[]) => string[];
	formatAttachmentsForYAML: (results: AttachmentResult[]) => string[];
}

export interface BuiltRecordNote {
	content: string;
	templateVariables: Record<string, string>;
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
	const templateData: Record<string, string> = {};
	const convertedCache = new Map<string, any>();

	const attachmentFieldNames = new Set<string>();

	for (const field of fields) {
		const fieldValue = recordFields[field.name];

		if (fieldValue === null || fieldValue === undefined) {
			templateData[field.name] = '';
			continue;
		}

		if (field.type === 'multipleRecordLinks' && Array.isArray(fieldValue)) {
			const links = fieldValue.map((linkedRecordId: string) => {
				const target = resolveRecordLink?.(linkedRecordId);
				if (target) return `[[${target}]]`;

				const title = externalRecordTitle?.(linkedRecordId);
				return title ? sanitizeFileName(title) : `Unknown record ${linkedRecordId}`;
			});
			convertedCache.set(field.name, links);
			templateData[field.name] = links.join(', ');
			continue;
		}

		if (field.type === 'multipleAttachments' && Array.isArray(fieldValue)) {
			const downloaded = await resolveAttachments(fieldValue as AirtableAttachment[]);
			attachmentFieldNames.add(field.name);
			convertedCache.set(field.name, downloaded);

			templateData[field.name] = formatAttachmentsForBody(downloaded).join('\n');
			continue;
		}

		const convertedValue = convertFieldValue({
			fieldValue,
			fieldSchema: field,
			computedByBase: formulaFieldNames.has(field.name),
		});

		convertedCache.set(field.name, convertedValue);

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

	const frontMatter: FrontMatterCache = {};
	if (recordId) {
		frontMatter[RECORD_ID_PROPERTY] = record.id;
	}

	const title = recordTitle(record, primaryFieldName);
	const alias = title === sanitizeFileName(title) ? null : title;

	if (viewReferences.length > 0) {
		frontMatter[viewPropertyName] = viewReferences;
	}

	for (const { fieldName, propertyName } of frontMatterFields) {
		const convertedValue = convertedCache.get(fieldName);

		if (convertedValue === null || convertedValue === undefined || convertedValue === '') {
			continue;
		}

		const propertyValue = attachmentFieldNames.has(fieldName)
			? formatAttachmentsForYAML(convertedValue as AttachmentResult[])
			: convertedValue;

		if (typeof propertyValue === 'object' && !Array.isArray(propertyValue)) {
			console.warn(`[Airtable] Skipping complex object for property "${propertyName}"`);
			continue;
		}

		frontMatter[propertyName] = propertyValue;
	}

	if (alias) {
		const existing: unknown = frontMatter['aliases'];
		const rest: unknown[] = Array.isArray(existing) ? existing : [];
		frontMatter['aliases'] = [alias, ...rest];
	}

	const bodyContent = bodyTemplate?.trim() ? applyTemplate(bodyTemplate, templateData) : '';

	return {
		content: `${serializeFrontMatter(frontMatter)}${bodyContent}`.trim(),
		templateVariables: templateData,
	};
}

export interface FrontMatterFieldsOptions {
	fields: AirtableFieldSchema[];
	propertyNames: Map<string, string>;
	propertyValues: Map<string, string>;
	viewPropertyName: string;
	propertyNameForField: (fieldName: string) => string;
	primaryFieldName: string;
}

export function frontMatterFieldsForTable(
	options: FrontMatterFieldsOptions
): Array<{ fieldName: string, propertyName: string }> {
	const { fields, propertyNames, propertyValues, viewPropertyName, propertyNameForField, primaryFieldName } = options;
	const frontMatterFields = [];

	for (const field of fields) {
		if (field.name === primaryFieldName) continue;

		const configured = propertyNames.get(field.name);
		if (!configured?.trim()) continue;

		if (configured === viewPropertyName) continue;

		if (!propertyValues.get(field.name)) continue;

		frontMatterFields.push({
			fieldName: field.name,
			propertyName: propertyNameForField(field.name),
		});
	}

	return frontMatterFields;
}

export function defaultPropertyConfig(
	fields: Iterable<AirtableFieldSchema>,
	_viewPropertyName?: string,
): { propertyNames: Map<string, string>, propertyValues: Map<string, string> } {
	const propertyNames = new Map<string, string>();
	const propertyValues = new Map<string, string>();

	for (const field of fields) {
		const sanitizedName = sanitizePropertyName(field.name);

		propertyNames.set(field.name, sanitizedName);
		propertyValues.set(field.name, `{{${field.name}}}`);
	}

	return { propertyNames, propertyValues };
}
