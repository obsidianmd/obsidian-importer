/**
 * Issue #687: semicolon-separated CSV files (the default export in locales
 * where the comma is the decimal separator, e.g. Excel in DE/FR).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCSV } from '../../src/formats/csv/parse';

test('a semicolon-separated file splits into columns', () => {
	const { headers, rows } = parseCSV('Name;Price;Note\nApple;1,50;"a;b"\n', true);
	assert.deepEqual(headers, ['Name', 'Price', 'Note']);
	assert.deepEqual(rows, [{ Name: 'Apple', Price: '1,50', Note: 'a;b' }]);
});

test('commas inside an unquoted header do not outvote the real separator', () => {
	const { headers } = parseCSV('Name, first;Name, last;City\nAnn;Lee;Paris\n', true);
	assert.deepEqual(headers, ['Name, first', 'Name, last', 'City']);
});

test('a tab-separated file is detected', () => {
	assert.deepEqual(parseCSV('a\tb\n1,5\t2\n', true).rows, [{ a: '1,5', b: '2' }]);
});
