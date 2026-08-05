/**
 * Does Airtable still return what the fixture says it does?
 *
 * The recorded conversion in convert.test.ts runs against a saved response,
 * which is what makes it deterministic and offline - and also what makes it go
 * stale without saying so. This test asks the real API the same questions the
 * importer asks and checks that the answers still have the shape the fixture
 * and the converters assume.
 *
 * It needs a token, so it skips unless one is set. Put it in .env, which is not
 * committed:
 *
 *   AIRTABLE_TOKEN=pat...
 *   AIRTABLE_BASE_ID=app...   # optional, otherwise the first base it can see
 *
 * A personal access token with schema.bases:read and data.records:read is
 * enough. Nothing here writes anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROPERTY_TYPE_FOR_FIELD_TYPE } from '../../src/formats/airtable-api/field-converter';
import { env } from '../helpers';

const token = env('AIRTABLE_TOKEN');
const skip = token ? false : 'set AIRTABLE_TOKEN in .env to check the fixture against the live API';

async function api(path: string): Promise<any> {
	const response = await fetch(`https://api.airtable.com/v0${path}`, {
		headers: { Authorization: `Bearer ${token}` },
	});

	assert.equal(response.status, 200, `GET ${path} returned ${response.status}`);
	return await response.json();
}

/** The keys the importer reads off a response, and what it expects to find. */
function assertShape(value: any, shape: Record<string, string>, what: string): void {
	assert.equal(typeof value, 'object', `${what} should be an object`);

	for (const [key, type] of Object.entries(shape)) {
		const actual = Array.isArray(value[key]) ? 'array' : typeof value[key];
		assert.equal(actual, type, `${what}.${key} should be ${type}, got ${actual}`);
	}
}

test('the API still returns the shape the fixture is written to', { skip }, async () => {
	const baseId = env('AIRTABLE_BASE_ID') ?? (await api('/meta/bases')).bases?.[0]?.id;
	assert.ok(baseId, 'no base to read - set AIRTABLE_BASE_ID or use a token that can see one');

	const schema = await api(`/meta/bases/${baseId}/tables?include%5B%5D=visibleFieldIds`);
	assert.ok(Array.isArray(schema.tables) && schema.tables.length > 0, 'the base should have tables');

	const unknownTypes = new Set<string>();
	const rollupsWithAnAggregation: string[] = [];

	for (const table of schema.tables) {
		assertShape(table, {
			id: 'string',
			name: 'string',
			primaryFieldId: 'string',
			fields: 'array',
			views: 'array',
		}, 'table');

		for (const field of table.fields) {
			assertShape(field, { id: 'string', name: 'string', type: 'string' }, `field ${field.name}`);
			if (!(field.type in PROPERTY_TYPE_FOR_FIELD_TYPE)) unknownTypes.add(field.type);

			// The metadata API says which field a rollup reads and through which
			// link, but not what it does with the values, so a rollup is imported
			// as the value Airtable computed rather than as a .base formula.
			if (field.type === 'rollup' && field.options?.formula) {
				rollupsWithAnAggregation.push(`${table.name} > ${field.name}: ${field.options.formula}`);
			}
		}

		for (const view of table.views) {
			assertShape(view, { id: 'string', name: 'string', type: 'string' }, `view ${view.name}`);
		}
	}

	// A grid view is where visibleFieldIds comes from, and column order in the
	// generated .base depends on it
	const grid = schema.tables.flatMap((t: any) => t.views).find((v: any) => v.type === 'grid');
	if (grid) {
		assert.ok(Array.isArray(grid.visibleFieldIds), 'a grid view should carry visibleFieldIds');
	}

	const table = schema.tables[0];
	const { records } = await api(`/${baseId}/${table.id}?maxRecords=3`);
	assert.ok(Array.isArray(records), 'records should be an array');

	for (const record of records) {
		assertShape(record, { id: 'string', createdTime: 'string', fields: 'object' }, 'record');
	}

	// Not a failure of the fixture, but of coverage: a type nobody has taught
	// the converter about is imported as text.
	assert.deepEqual([...unknownTypes], [],
		'field types this base uses that the importer does not know');

	// If this fires, Airtable has started reporting rollup aggregations and the
	// conversion in table-formulas.ts can compute them in the .base file again
	// instead of importing Airtable's computed value. Good news, not a fault.
	assert.deepEqual(rollupsWithAnAggregation, [],
		'rollups now report their aggregation; rollup conversion can be turned back on');
});
