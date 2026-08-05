/**
 * The Airtable conversion, outside Obsidian.
 *
 * The importer talks to an API rather than reading an export, so a fixture here
 * is a saved API response: the base schema, the records of each table, and the
 * record ids each view holds. Everything from there down is the same code the
 * plugin runs - the formulas a table's .base file computes, each record as a
 * note, and the .base itself - and every table is recorded as the folder of
 * files a user would get.
 *
 * The importer's settings are at their defaults: every field becomes a
 * property, formulas are converted where they can be, and no body template.
 *
 * Two things are the caller's rather than the conversion's, so they are stood
 * in for here: downloading an attachment, and rewriting a linked-record
 * placeholder into a link once every note has a path. Both need a vault.
 *
 * tests/airtable/live.test.ts checks the fixture's shape against the real API,
 * for when Airtable changes what it returns.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { stringifyYaml } from 'obsidian';

import { buildBaseFile } from '../../src/formats/airtable-api/base-file';
import { formatAttachmentsForYAML } from '../../src/formats/airtable-api/attachment-helpers';
import {
	buildRecordNote,
	defaultPropertyConfig,
	frontMatterFieldsForTable,
	isEmptyRecord,
	recordTitle,
	RECORD_LINK_PLACEHOLDER_PATTERN,
} from '../../src/formats/airtable-api/record-note';
import { computeTableFormulas } from '../../src/formats/airtable-api/table-formulas';
import type {
	AirtableFieldSchema,
	AirtableRecord,
	AirtableTableInfo,
	AttachmentResult,
} from '../../src/formats/airtable-api/types';
import { sanitizeFileName } from '../../src/util';
import { expectedFor, expectTree, fixtures } from '../helpers';

const FIXTURES = __dirname;

/** A saved set of API responses for one base. */
interface BaseFixture {
	baseId: string;
	baseName: string;
	schema: { tables: AirtableTableInfo[] };
	/** Table id -> that table's records, as the records endpoint returns them. */
	records: Record<string, { records: AirtableRecord[] }>;
	/** View id -> the record ids it holds, in the order the view has them. */
	viewRecordIds: Record<string, string[]>;
}

/** The importer's own defaults, which is what an unconfigured import produces. */
const VIEW_PROPERTY = 'base';
const OUTPUT_FOLDER = 'Airtable';

/**
 * Stands in for downloading: names the file the way the importer would and puts
 * it where the default attachment setting does, without fetching anything.
 */
function resolveAttachments(tableFolder: string) {
	return async (attachments: { filename: string, url: string, type: string }[]): Promise<AttachmentResult[]> =>
		attachments.map(attachment => ({
			path: `${tableFolder}/Attachments/${sanitizeFileName(attachment.filename)}`,
			isLocal: true,
			filename: sanitizeFileName(attachment.filename),
			mimeType: attachment.type,
		}));
}

/** What generateMarkdownLink returns for a vault at its default settings. */
function formatAttachmentsForBody(results: AttachmentResult[]): string[] {
	return results.map(result => {
		if (!result.isLocal) return `[${result.filename || 'Attachment'}](${result.path})`;
		const embeddable = !!result.mimeType && (result.mimeType.startsWith('image/') || result.mimeType.startsWith('video/'));
		return `${embeddable ? '!' : ''}[[${result.path}]]`;
	});
}

const bases = fixtures(FIXTURES, '.json');

test('there are bases to convert', () => {
	assert.ok(bases.length > 0, 'expected at least one .json in tests/airtable');
});

for (const fixture of bases) {
	test(`converts ${fixture.name}`, async () => {
		const base = JSON.parse(nodeFs.readFileSync(fixture.path, 'utf8')) as BaseFixture;
		const tables = base.schema.tables;
		assert.ok(tables.length > 0, 'the base should contain tables');

		// Every field of every table, as the importer collects them: a lookup can
		// point at a field in another table, so this has to span the base.
		const fieldNameById = new Map<string, string>();
		const allFields = new Map<string, AirtableFieldSchema>();
		for (const table of tables) {
			for (const field of table.fields) {
				fieldNameById.set(field.id, field.name);
				if (!allFields.has(field.name)) allFields.set(field.name, field);
			}
		}

		// The configurator's starting point, which is what an import that just
		// clicks through produces
		const { propertyNames, propertyValues } = defaultPropertyConfig(allFields.values(), VIEW_PROPERTY);
		const propertyNameForField = (fieldName: string) => propertyNames.get(fieldName) ?? fieldName;

		const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-airtable-'));
		const baseFolder = `${OUTPUT_FOLDER}/${sanitizeFileName(base.baseName)}`;

		// Record id -> the note it became, for resolving links at the end
		const noteForRecord = new Map<string, string>();

		try {
			for (const table of tables) {
				const tableFolder = `${baseFolder}/${sanitizeFileName(table.name)}`;
				const records = base.records[table.id]?.records ?? [];
				assert.ok(records.length > 0, `table ${table.name} should have records`);

				const formulas = computeTableFormulas({
					fields: table.fields,
					primaryFieldId: table.primaryFieldId,
					fieldNameById,
					propertyNameForField,
				});

				const built = buildBaseFile({
					tableFolderPath: tableFolder,
					tableName: table.name,
					views: table.views,
					fields: table.fields,
					primaryFieldId: table.primaryFieldId,
					formulas,
					viewPropertyName: VIEW_PROPERTY,
					propertyNameForField,
				});

				write(produced, built.path, stringifyYaml(built.config));

				// Which views each record belongs to, as its note refers to them
				const viewsForRecord = new Map<string, string[]>();
				for (const view of table.views) {
					for (const recordId of base.viewRecordIds[view.id] ?? []) {
						const reference = `[[${built.viewReferenceBasePath}#${view.name.replace(/[[\]#|^"\\]/g, '_')}]]`;
						viewsForRecord.set(recordId, [...viewsForRecord.get(recordId) ?? [], reference]);
					}
				}

				const primaryFieldName = table.fields.find(f => f.id === table.primaryFieldId)!.name;
				const frontMatterFields = frontMatterFieldsForTable({
					fields: table.fields,
					propertyNames,
					propertyValues,
					viewPropertyName: VIEW_PROPERTY,
					propertyNameForField,
				});

				const takenPaths = new Set<string>();

				for (const record of records) {
					// An empty record is written as no note at all
					if (isEmptyRecord(record)) continue;

					const { content } = await buildRecordNote(record, {
						baseId: base.baseId,
						fields: table.fields,
						viewReferences: viewsForRecord.get(record.id) ?? [],
						viewPropertyName: VIEW_PROPERTY,
						formulaFieldNames: new Set(formulas.keys()),
						frontMatterFields,
						resolveAttachments: resolveAttachments(tableFolder),
						formatAttachmentsForBody,
						formatAttachmentsForYAML,
					});

					// The vault hands back a free path, so a second record with the
					// same title lands beside the first rather than over it
					const title = sanitizeFileName(recordTitle(record, primaryFieldName));
					let path = `${tableFolder}/${title}.md`;
					for (let i = 1; takenPaths.has(path.toLowerCase()); i++) {
						path = `${tableFolder}/${title} ${i}.md`;
					}
					takenPaths.add(path.toLowerCase());

					noteForRecord.set(record.id, nodePath.basename(path, '.md'));
					write(produced, path, content);
				}
			}

			resolveRecordLinks(produced, noteForRecord);

			expectTree(produced, expectedFor(fixture, nodePath.basename(fixture.name, '.json')), fixture.name);
		}
		finally {
			nodeFs.rmSync(produced, { recursive: true, force: true });
		}
	});
}

function write(root: string, vaultPath: string, content: string): void {
	const file = nodePath.join(root, vaultPath);
	nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
	nodeFs.writeFileSync(file, content);
}

/**
 * The importer's second pass, which runs once every note has a final path. The
 * vault resolves a link to its shortest unambiguous form, which for these
 * fixtures is the note name.
 */
function resolveRecordLinks(root: string, noteForRecord: Map<string, string>): void {
	for (const file of nodeFs.readdirSync(root, { recursive: true, encoding: 'utf8' })) {
		const full = nodePath.join(root, file);
		if (!file.endsWith('.md') || !nodeFs.statSync(full).isFile()) continue;

		const content = nodeFs.readFileSync(full, 'utf8');
		const resolved = content.replace(
			RECORD_LINK_PLACEHOLDER_PATTERN,
			(_match, _baseId: string, recordId: string) =>
				`[[${noteForRecord.get(recordId) ?? `Unknown record ${recordId}`}]]`
		);

		if (resolved !== content) nodeFs.writeFileSync(full, resolved);
	}
}
