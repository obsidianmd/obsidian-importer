/**
 * CSV parsing, outside Obsidian.
 *
 * The parser takes the text of a file and returns headers and rows, so it runs
 * here directly. What it produces for each fixture is recorded as JSON, since
 * the parse result is data rather than a document - the markdown the importer
 * builds from it comes later.
 *
 * Quoting is where a CSV parser goes wrong quietly: a comma inside quotes, a
 * newline inside a field, a doubled quote meaning one. comprehensive-test.csv
 * exists for exactly that, so the recording pins it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { parseCSV, parseCSVLine, splitCSVLines } from '../../src/formats/csv/parse';
import { expectFile, fixtures } from '../helpers';

const FIXTURES = __dirname;
const EXPECTED = nodePath.join(FIXTURES, 'expected');

const files = fixtures(FIXTURES, '.csv');

test('there are fixtures to parse', () => {
	assert.ok(files.length > 0, 'expected at least one .csv in tests/csv');
});

for (const file of files) {
	test(`parses ${file}`, () => {
		const content = nodeFs.readFileSync(nodePath.join(FIXTURES, file), 'utf8');
		const parsed = parseCSV(content, true);

		expectFile(
			JSON.stringify(parsed, null, '\t') + '\n',
			nodePath.join(EXPECTED, `${nodePath.basename(file, '.csv')}.json`),
			file,
		);
	});
}

test('keeps a comma that is inside quotes', () => {
	assert.deepEqual(parseCSVLine('a,"b,c",d'), ['a', 'b,c', 'd']);
});

test('reads a doubled quote as one quote', () => {
	assert.deepEqual(parseCSVLine('a,"say ""hi""",c'), ['a', 'say "hi"', 'c']);
});

test('keeps a newline that is inside quotes on one line', () => {
	assert.deepEqual(splitCSVLines('a,b\n"one\ntwo",d\n'), ['a,b', '"one\ntwo",d']);
});

test('names the columns when there is no header row', () => {
	const { headers, rows } = parseCSV('x,y\n1,2\n', false);

	assert.deepEqual(headers, ['Column 1', 'Column 2']);
	assert.equal(rows.length, 2, 'the first row is data, not headers');
	assert.deepEqual(rows[0], { 'Column 1': 'x', 'Column 2': 'y' });
});
