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

/**
 * Convert a base into a folder of files, the way an import that just clicks
 * through would.
 *
 * `tables` is what the user ticked, which is not always the whole base. A user
 * can select a single table, and a link pointing out of it then has no note to
 * reach - the case the partial recording covers.
 *
 * Runs in the same two passes the importer does: work out where every note
 * goes, then write each one once, with real links already in it.
 */
async function convertBase(base: BaseFixture, tables: AirtableTableInfo[], produced: string): Promise<void> {
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

	const baseFolder = `${OUTPUT_FOLDER}/${sanitizeFileName(base.baseName)}`;

	// A link pointing at a table the user did not tick can never become a link,
	// so the importer reads that table's primary field to write a name instead
	// of a record id. Worked out the same way it works it out.
	const importedTableIds = new Set(tables.map(table => table.id));
	const linkedTableIds = new Set<string>();
	for (const table of tables) {
		for (const field of table.fields) {
			const linkedTableId = field.options?.linkedTableId;
			if (linkedTableId && !importedTableIds.has(linkedTableId)) linkedTableIds.add(linkedTableId);
		}
	}

	const externalTitle = new Map<string, string>();
	for (const table of base.schema.tables) {
		if (!linkedTableIds.has(table.id)) continue;
		const primary = table.fields.find(f => f.id === table.primaryFieldId)!.name;
		for (const record of base.records[table.id]?.records ?? []) {
			externalTitle.set(record.id, recordTitle(record, primary));
		}
	}

	interface Planned {
		record: AirtableRecord;
		path: string;
		title: string;
	}

	// First pass: where every note goes. A record with nothing in it gets no
	// note and so claims no path, which is what makes a link to it fall back to
	// a name.
	const pathForRecord = new Map<string, string>();
	const claimed = new Set<string>();
	const plans = tables.map(table => {
		const tableFolder = `${baseFolder}/${sanitizeFileName(table.name)}`;
		const records = base.records[table.id]?.records ?? [];
		assert.ok(records.length > 0, `table ${table.name} should have records`);

		const primaryFieldName = table.fields.find(f => f.id === table.primaryFieldId)!.name;
		const planned: Planned[] = [];

		for (const record of records) {
			if (isEmptyRecord(record)) continue;

			// The vault hands back a free path, so a second record with the same
			// title lands beside the first rather than over it
			const title = sanitizeFileName(recordTitle(record, primaryFieldName));
			let path = `${tableFolder}/${title}.md`;
			for (let i = 1; claimed.has(path.toLowerCase()); i++) {
				path = `${tableFolder}/${title} ${i}.md`;
			}
			claimed.add(path.toLowerCase());

			pathForRecord.set(record.id, path.replace(/\.md$/, ''));
			planned.push({ record, path, title: nodePath.basename(path, '.md') });
		}

		return { table, tableFolder, primaryFieldName, planned };
	});

	// Which notes [[Name]] alone reaches. The importer also asks the vault
	// whether the user already had a note by that name; nothing exists here
	// beside what this writes, so counting the plan is the whole answer.
	const timesUsed = new Map<string, number>();
	for (const path of pathForRecord.values()) {
		const basename = nodePath.basename(path).toLowerCase();
		timesUsed.set(basename, (timesUsed.get(basename) ?? 0) + 1);
	}

	const resolveRecordLink = (recordId: string): string | null => {
		const path = pathForRecord.get(recordId);
		if (!path) return null;

		const basename = nodePath.basename(path);
		return timesUsed.get(basename.toLowerCase()) === 1 ? basename : path;
	};

	// Second pass: write each note once, links and all
	for (const { table, tableFolder, primaryFieldName, planned } of plans) {
		const formulas = computeTableFormulas({
			fields: table.fields,
			primaryFieldId: table.primaryFieldId,
			fieldNameById,
			propertyNameForField,
		});

		// A view holding every note needs no filter, so no note names it.
		// Counted over records that become notes: an empty one is written as no
		// note, so a view is still "all of them" without it.
		const tableRecords = base.records[table.id]?.records ?? [];
		const emptyRecordIds = new Set(tableRecords.filter(isEmptyRecord).map(record => record.id));
		const noteCount = tableRecords.length - emptyRecordIds.size;
		const viewsShowingEveryRecord = new Set(
			table.views
				.filter(view => (base.viewRecordIds[view.id] ?? [])
					.filter(recordId => !emptyRecordIds.has(recordId)).length === noteCount)
				.map(view => view.id)
		);

		const built = buildBaseFile({
			tableFolderPath: tableFolder,
			tableName: table.name,
			views: table.views,
			fields: table.fields,
			primaryFieldId: table.primaryFieldId,
			formulas,
			viewPropertyName: VIEW_PROPERTY,
			propertyNameForField,
			viewsShowingEveryRecord,
		});

		write(produced, built.path, stringifyYaml(built.config));

		// Which views each record belongs to, as its note names them
		const viewsForRecord = new Map<string, string[]>();
		for (const view of table.views) {
			const token = built.membershipTokens.get(view.id);
			if (!token) continue;

			for (const recordId of base.viewRecordIds[view.id] ?? []) {
				if (emptyRecordIds.has(recordId)) continue;
				viewsForRecord.set(recordId, [...viewsForRecord.get(recordId) ?? [], token]);
			}
		}

		const frontMatterFields = frontMatterFieldsForTable({
			fields: table.fields,
			primaryFieldName,
			propertyNames,
			propertyValues,
			viewPropertyName: VIEW_PROPERTY,
			propertyNameForField,
		});

		for (const { record, path } of planned) {
			const { content } = await buildRecordNote(record, {
				fields: table.fields,
				primaryFieldName,
				viewReferences: viewsForRecord.get(record.id) ?? [],
				viewPropertyName: VIEW_PROPERTY,
				formulaFieldNames: new Set(formulas.keys()),
				frontMatterFields,
				resolveRecordLink,
				externalRecordTitle: linkedRecordId => externalTitle.get(linkedRecordId),
				resolveAttachments: resolveAttachments(tableFolder),
				formatAttachmentsForBody,
				formatAttachmentsForYAML,
			});

			write(produced, path, content);
		}
	}
}

/** Convert into a temporary folder, compare against a recording, clean up. */
async function recordConversion(
	base: BaseFixture,
	tables: AirtableTableInfo[],
	expected: string,
	label: string
): Promise<void> {
	const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-airtable-'));
	try {
		await convertBase(base, tables, produced);
		expectTree(produced, expected, label);
	}
	finally {
		nodeFs.rmSync(produced, { recursive: true, force: true });
	}
}

for (const fixture of bases) {
	const read = () => JSON.parse(nodeFs.readFileSync(fixture.path, 'utf8')) as BaseFixture;
	const name = nodePath.basename(fixture.name, '.json');

	test(`converts ${fixture.name}`, async () => {
		const base = read();
		assert.ok(base.schema.tables.length > 0, 'the base should contain tables');

		await recordConversion(base, base.schema.tables, expectedFor(fixture, name), fixture.name);
	});

	// A user can tick one table out of a base. Its links to the tables they left
	// behind have no note to point at, and the record ids Airtable returns for
	// them are not something to write into a note.
	test(`converts one table of ${fixture.name}`, async () => {
		const base = read();
		const [first, ...rest] = base.schema.tables;
		assert.ok(rest.length > 0, 'the fixture should have more than one table for this to mean anything');
		assert.ok(
			first.fields.some(f => f.type === 'multipleRecordLinks'),
			'the table imported alone should link out, or this records nothing'
		);

		await recordConversion(base, [first], expectedFor(fixture, `${name}-single-table`), fixture.name);
	});
}

function write(root: string, vaultPath: string, content: string): void {
	const file = nodePath.join(root, vaultPath);
	nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
	nodeFs.writeFileSync(file, content);
}
