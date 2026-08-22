import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectRecords } from '../../src/formats/airtable-api/api-helpers';

test('record sampling asks Airtable for only the preview limit', async () => {
	let selected: Record<string, unknown> | undefined;
	const records = [{ id: 'one' }, { id: 'two' }];
	const base = (_table: string) => ({
		select: (options: Record<string, unknown>) => {
			selected = options;
			return {
				eachPage: async (page: (records: readonly unknown[], next: () => void) => void) => {
					page(records, () => {});
				},
			};
		},
	});

	const result = await selectRecords(base, 'Table', {
		view: 'viwExample',
		fields: [],
		filterByFormula: 'RECORD_ID()="recExample"',
		maxRecords: 5,
	});

	assert.deepEqual(selected, {
		view: 'viwExample',
		fields: [],
		filterByFormula: 'RECORD_ID()="recExample"',
		maxRecords: 5,
		pageSize: 5,
	});
	assert.deepEqual(result, records);
});
