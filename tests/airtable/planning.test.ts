/**
 * Where each Airtable record's note is going, settled before any is written.
 *
 * Records link to each other, so every path has to be known before the first
 * note is built - including the path of a note an earlier import already
 * wrote, wherever the user has since moved it to. This is the step that
 * decides them.
 *
 * convert.test.ts covers turning a record into markdown; this covers naming
 * the file it lands in.
 */
import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AirtableAPIImporter } from '../../src/formats/airtable-api';
import { DuplicateHandling } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { RECORD_ID_PROPERTY, recordTimestamps } from '../../src/formats/airtable-api/record-note';
import type { AirtableRecord, PreparedTableData, TablePlan } from '../../src/formats/airtable-api/types';
import { MemoryVault, memoryApp } from '../shims/vault';

const BASE_ID = 'appExample00000001';

class PlanningImporter extends AirtableAPIImporter {
	plan(ctx: ImportContext, rootPath: string, tables: PreparedTableData[]): Promise<TablePlan[]> {
		this.preparedData = tables;
		return this.planRecordPaths(ctx, rootPath);
	}
}

function record(id: string, title: string): AirtableRecord {
	return { id, createdTime: '2024-01-01T00:00:00.000Z', fields: { Name: title } };
}

function table(records: AirtableRecord[]): PreparedTableData {
	return {
		baseId: BASE_ID,
		baseName: '',
		tableName: 'Books',
		primaryFieldId: 'fldName0000000001',
		fields: [{ id: 'fldName0000000001', name: 'Name', type: 'singleLineText' }] as never,
		views: [],
		records,
		recordViewMemberships: new Map(),
		viewsShowingEveryRecord: new Set(),
	};
}

async function planning(vault: MemoryVault, mode: DuplicateHandling) {
	const subject = new PlanningImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = mode;
	subject.indexImportedNotes();

	return subject;
}

/** Each record's planned path, in the order the table has them. */
const paths = (plans: TablePlan[]) => plans[0].records.map(planned => planned.filePath);

test('a record nothing matches is planned at its title', async () => {
	const vault = new MemoryVault();
	const subject = await planning(vault, DuplicateHandling.Skip);

	const plans = await subject.plan(new ImportContext(), 'Airtable', [table([record('rec1', 'The Long Way')])]);

	assert.deepEqual(paths(plans), ['Airtable/Books/The Long Way.md']);
	assert.equal(plans[0].records[0].note?.file, null);
});

test('two records of one title are planned as two notes', async () => {
	const vault = new MemoryVault();
	const subject = await planning(vault, DuplicateHandling.Skip);

	const plans = await subject.plan(new ImportContext(), 'Airtable', [table([
		record('rec1', 'Dune'),
		record('rec2', 'Dune'),
	])]);

	assert.deepEqual(paths(plans), ['Airtable/Books/Dune.md', 'Airtable/Books/Dune 1.md']);
});

test('a record an earlier import wrote is planned onto that note', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Airtable');
	await vault.createFolder('Airtable/Books');
	await vault.create('Airtable/Books/Dune.md', `---\n${RECORD_ID_PROPERTY}: rec1\n---\nold\n`);

	const subject = await planning(vault, DuplicateHandling.Skip);
	const plans = await subject.plan(new ImportContext(), 'Airtable', [table([record('rec1', 'Dune')])]);

	assert.deepEqual(paths(plans), ['Airtable/Books/Dune.md']);
	assert.equal(plans[0].records[0].note?.file?.path, 'Airtable/Books/Dune.md');
});

test('and is still planned onto it after the user moved it', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Reading');
	await vault.create('Reading/Dune.md', `---\n${RECORD_ID_PROPERTY}: rec1\n---\nold\n`);

	const subject = await planning(vault, DuplicateHandling.Skip);
	const plans = await subject.plan(new ImportContext(), 'Airtable', [table([record('rec1', 'Dune')])]);

	assert.deepEqual(paths(plans), ['Reading/Dune.md'], 'the note it already wrote is where the record belongs');
	assert.equal(plans[0].records[0].note?.desiredPath, 'Airtable/Books/Dune.md');
});

test('"Create a copy" plans beside the note rather than onto it', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Airtable');
	await vault.createFolder('Airtable/Books');
	await vault.create('Airtable/Books/Dune.md', `---\n${RECORD_ID_PROPERTY}: rec1\n---\nold\n`);

	const subject = await planning(vault, DuplicateHandling.CreateCopy);
	const plans = await subject.plan(new ImportContext(), 'Airtable', [table([record('rec1', 'Dune')])]);

	assert.deepEqual(paths(plans), ['Airtable/Books/Dune 1.md']);
	assert.equal(plans[0].records[0].note?.file, null);
});

test('a record note is stamped with when Airtable says the record was made', () => {
	assert.deepEqual(recordTimestamps(record('rec1', 'Dune')), { ctime: Date.parse('2024-01-01T00:00:00.000Z') });
});

test('and with nothing at all when there is no time to read', () => {
	assert.deepEqual(recordTimestamps({ id: 'rec1', fields: {} } as never), {});
	assert.deepEqual(recordTimestamps({ id: 'rec1', createdTime: 'not a date', fields: {} }), {});
});

test('an empty record is passed over before it is ever planned', async () => {
	const vault = new MemoryVault();
	const subject = await planning(vault, DuplicateHandling.Skip);

	const plans = await subject.plan(new ImportContext(), 'Airtable', [table([
		{ id: 'rec1', createdTime: '2024-01-01T00:00:00.000Z', fields: {} },
	])]);

	assert.equal(plans[0].records[0].note, null);
	assert.equal(plans[0].records[0].filePath, '');
	assert.ok(plans[0].records[0].skipped);
});
