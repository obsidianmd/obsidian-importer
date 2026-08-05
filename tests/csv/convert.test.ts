/**
 * The CSV conversion, outside Obsidian.
 *
 * A row and a template configuration go in, a note comes out. Each fixture is
 * converted with the configuration the importer offers by default - every
 * column a property, the first column naming the note - and recorded as the
 * markdown files a user would end up with.
 *
 * Quoting is where a CSV parser fails quietly: a comma inside quotes, a
 * newline inside a field, a doubled quote meaning one. comprehensive-test.csv
 * is built around exactly that, so its notes pin the behaviour.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { convertRow, defaultTemplateConfig, sanitizeYAMLKey } from '../../src/formats/csv/convert';
import { parseCSV, parseCSVLine, splitCSVLines } from '../../src/formats/csv/parse';
import { sanitizeFileName } from '../../src/util';
import { expectTree, fixtures } from '../helpers';

const FIXTURES = __dirname;
const EXPECTED = nodePath.join(FIXTURES, 'expected');

const files = fixtures(FIXTURES, '.csv');

test('there are fixtures to convert', () => {
	assert.ok(files.length > 0, 'expected at least one .csv in tests/csv');
});

for (const file of files) {
	test(`converts ${file}`, () => {
		const content = nodeFs.readFileSync(nodePath.join(FIXTURES, file), 'utf8');
		const { headers, rows } = parseCSV(content, true);
		const config = defaultTemplateConfig(headers, sanitizeYAMLKey);

		const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-csv-'));
		try {
			for (const row of rows) {
				const note = convertRow(row, config);
				if (!note.title.trim()) continue; // the importer skips these

				// Written the way the importer would: through the same
				// sanitiser, under the location the template produced.
				const dir = note.location ? nodePath.join(produced, note.location) : produced;
				nodeFs.mkdirSync(dir, { recursive: true });
				nodeFs.writeFileSync(nodePath.join(dir, `${sanitizeFileName(note.title)}.md`), note.content);
			}

			expectTree(produced, nodePath.join(EXPECTED, nodePath.basename(file, '.csv')), file);
		}
		finally {
			nodeFs.rmSync(produced, { recursive: true, force: true });
		}
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
