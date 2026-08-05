import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeTableFormulas } from '../../src/formats/airtable-api/table-formulas';
import { convertFieldValue } from '../../src/formats/airtable-api/field-converter';
import type { AirtableFieldSchema } from '../../src/formats/airtable-api/types';

/**
 * What a rollup becomes.
 *
 * Airtable's metadata API reports which field a rollup reads and through which
 * link, but not what it does with the values - no rollup in any real base
 * checked carried an aggregation. A rollup is therefore imported as the value
 * Airtable computed, which is right whatever the aggregation was; the recorded
 * conversion in convert.test.ts covers that path.
 *
 * The aggregations below are still reachable if Airtable ever starts reporting
 * one, and tests/airtable/live.test.ts is what would notice, so they are kept
 * working here rather than only through a fixture that cannot exercise them.
 */

const LINK_FIELD: AirtableFieldSchema = {
	id: 'fldLink',
	name: 'Movies',
	type: 'multipleRecordLinks',
	options: { linkedTableId: 'tblMovies' },
};

const SCORE_FIELD: AirtableFieldSchema = { id: 'fldScore', name: 'Score', type: 'number' };

function rollup(formula?: string): AirtableFieldSchema {
	return {
		id: 'fldRollup',
		name: 'Average score',
		type: 'rollup',
		options: {
			recordLinkFieldId: 'fldLink',
			fieldIdInLinkedTable: 'fldScore',
			result: { type: 'number' },
			...(formula ? { formula } : {}),
		},
	};
}

function formulasFor(field: AirtableFieldSchema): Map<string, string> {
	return computeTableFormulas({
		fields: [LINK_FIELD, field],
		primaryFieldId: 'fldPrimary',
		fieldNameById: new Map([['fldLink', 'Movies'], ['fldScore', 'Score']]),
		propertyNameForField: name => name,
	});
}

const MAP_EXPRESSION = 'note["Movies"].map(value.asFile().properties["Score"])';

test('a rollup with no aggregation gets no formula, so the imported value stands', () => {
	// Listing every rolled-up value was the old answer, which showed an average
	// as all of its inputs
	assert.equal(formulasFor(rollup()).get('Average score'), undefined);
});

test('an aggregation Airtable does report is converted', () => {
	assert.equal(formulasFor(rollup('AVERAGE(values)')).get('Average score'), `${MAP_EXPRESSION}.mean()`);
	assert.equal(formulasFor(rollup('SUM(values)')).get('Average score'), `${MAP_EXPRESSION}.sum()`);
	assert.equal(formulasFor(rollup('MAX(values)')).get('Average score'), `max(${MAP_EXPRESSION})`);
	assert.equal(formulasFor(rollup('COUNTALL(values)')).get('Average score'), `${MAP_EXPRESSION}.length`);
});

test('a lookup still lists its values, which is what a lookup is', () => {
	const lookup: AirtableFieldSchema = {
		id: 'fldLookup',
		name: 'Scores',
		type: 'multipleLookupValues',
		options: { recordLinkFieldId: 'fldLink', fieldIdInLinkedTable: 'fldScore' },
	};

	assert.equal(formulasFor(lookup).get('Scores'), MAP_EXPRESSION);
});

test('the value Airtable computed is imported as it stands', () => {
	assert.equal(convertFieldValue({ fieldValue: 9, fieldSchema: rollup(), computedByBase: false }), 9);
	assert.equal(convertFieldValue({ fieldValue: 8.5, fieldSchema: rollup(), computedByBase: false }), 8.5);
});

test('a result Airtable has no number for is imported as nothing', () => {
	// An average over no values, a division by zero. Coercing it wrote NaN
	// into the note.
	assert.equal(convertFieldValue({ fieldValue: { specialValue: 'NaN' }, fieldSchema: rollup(), computedByBase: false }), null);
});
