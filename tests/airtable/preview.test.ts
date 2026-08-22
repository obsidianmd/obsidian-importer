import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AirtableAPIImporter } from '../../src/formats/airtable-api';
import { ImportContext } from '../../src/import-context';
import type { AirtableRecord, AirtableViewInfo } from '../../src/formats/airtable-api/types';

test('preview samples read bounded membership from supported Airtable views', async () => {
	const records: AirtableRecord[] = [
		{ id: 'recOne', createdTime: '', fields: { Name: 'One' } },
		{ id: 'recTwo', createdTime: '', fields: { Name: 'Two' } },
	];
	const selected: Array<Record<string, unknown>> = [];
	const recordsByView: Record<string, AirtableRecord[]> = {
		viwGrid: records,
		viwList: [records[1]],
	};
	const base = (_table: string) => ({
		select: (options: Record<string, unknown>) => {
			selected.push(options);
			return {
				eachPage: async (page: (pageRecords: readonly AirtableRecord[], next: () => void) => void) => {
					page(recordsByView[String(options.view)] ?? [], () => {});
				},
			};
		},
	});

	const subject = Object.create(AirtableAPIImporter.prototype) as AirtableAPIImporter;
	Object.defineProperty(subject, 'getAirtableBase', { value: () => base });
	const inner = subject as unknown as {
		loadPreviewViewReferences(
			ctx: ImportContext,
			baseId: string,
			tableIdOrName: string,
			views: AirtableViewInfo[],
			records: AirtableRecord[],
		): Promise<Map<string, string[]>>;
	};
	const references = await inner.loadPreviewViewReferences(
		new ImportContext(),
		'appExample',
		'tblExample',
		[
			{ id: 'viwGrid', name: 'Everything', type: 'grid' },
			{ id: 'viwList', name: 'Next [up]', type: 'list' },
			{ id: 'viwForm', name: 'Intake', type: 'form' },
		],
		records,
	);

	assert.deepEqual(references.get('recOne'), ['Everything']);
	assert.deepEqual(references.get('recTwo'), ['Everything', 'Next _up_']);
	assert.equal(selected.length, 2, 'unsupported views should not be queried');
	for (const options of selected) {
		assert.equal(options.maxRecords, 2);
		assert.equal(options.pageSize, 2);
		assert.equal(options.fields instanceof Array, true);
		assert.match(String(options.filterByFormula), /^OR\(RECORD_ID\(\)="recOne",RECORD_ID\(\)="recTwo"\)$/u);
	}
});
