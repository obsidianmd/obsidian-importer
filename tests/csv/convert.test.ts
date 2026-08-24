/**
 * The CSV conversion, outside Obsidian.
 *
 * A row and a template configuration go in, a note comes out. Each fixture is
 * converted with the configuration the importer offers by default - every
 * column a property, the first column naming the note - and recorded as the
 * markdown files a user would end up with.
 *
 * An empty column still gets its frontmatter key, written as "Key: " with the
 * trailing space YAML leaves behind. That is visible in the recordings.
 *
 * Quoting is where a CSV parser fails quietly: a comma inside quotes, a
 * newline inside a field, a doubled quote meaning one. comprehensive-test.csv
 * is built around exactly that, so its notes pin the behaviour.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { convertRow, defaultNoteTemplate, defaultTemplateConfig, sanitizeYAMLKey } from '../../src/formats/csv/convert';
import { parseCSV, parseCSVLine, splitCSVLines } from '../../src/formats/csv/parse';
import { parseFrontMatterBlock, sanitizeFileName } from '../../src/util';
import { renderNoteTemplate } from '../../src/note-template';
import { applyTemplate } from '../../src/template';
import { normalizeListProperties } from '../../src/list-properties';
import { expectedFor, expectTree, fixtures } from '../helpers';

const FIXTURES = __dirname;

const files = fixtures(FIXTURES, '.csv');

test('there are fixtures to convert', () => {
	assert.ok(files.length > 0, 'expected at least one .csv in tests/csv');
});

test('generates a Markdown template from CSV headers', () => {
	assert.equal(defaultNoteTemplate(
		['Name', 'Project: status', 'Tags', 'ALIASES', 'cssclasses', ''],
		sanitizeYAMLKey,
	), [
		'---',
		'Name: {{source["Name"] | yaml}}',
		'Project status: {{source["Project: status"] | yaml}}',
		'Tags: {{source["Tags"] | yaml}}',
		'ALIASES: {{source["ALIASES"] | yaml}}',
		'cssclasses: {{source["cssclasses"] | yaml}}',
		'---',
	].join('\n'));
});

test('CSV defaults render Obsidian list properties as lists', async () => {
	const headers = ['Title', 'Tags', 'Aliases', 'cssclasses'];
	const source = {
		Title: 'Example',
		Tags: '#travel, #wishlist #reference',
		Aliases: '["Doe, John", "John Doe"]',
		cssclasses: 'wide, dashboard compact',
	};

	const rendered = await renderNoteTemplate(defaultNoteTemplate(headers, sanitizeYAMLKey), {
		...source,
		source,
	});
	const parsed = parseFrontMatterBlock(normalizeListProperties(rendered));
	assert.deepEqual(parsed?.frontMatter, {
		Title: 'Example',
		Tags: ['travel', 'wishlist', 'reference'],
		Aliases: ['Doe, John', 'John Doe'],
		cssclasses: ['wide', 'dashboard', 'compact'],
	});
});

test('CSV defaults resolve safe source expressions for punctuated headers', async () => {
	const config = defaultTemplateConfig(['Price ($)', 'Notes/Extra'], sanitizeYAMLKey);
	const row = { 'Price ($)': '12', 'Notes/Extra': 'Ready' };
	const converted = convertRow(row, config);

	assert.equal(config.titleTemplate, '{{source["Price ($)"]}}');
	assert.equal(await renderNoteTemplate(config.titleTemplate, { ...row, source: row }), '12');
	assert.equal(converted.title, '12');
	assert.match(converted.content, /Price : 12/u);
	assert.match(converted.content, /NotesExtra: "Ready"/u);
});

test('an invalid quoted source escape falls back to its literal field name', () => {
	const expression = String.raw`source["\q"]`;
	assert.equal(applyTemplate(`{{${expression}}}`, { [expression]: 'literal' }), 'literal');
});

for (const file of files) {
	test(`converts ${file.name}`, () => {
		const content = nodeFs.readFileSync(file.path, 'utf8');
		const { headers, rows } = parseCSV(content, true);
		const config = defaultTemplateConfig(headers, sanitizeYAMLKey);

		const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-csv-'));
		try {
			for (const row of rows) {
				const note = convertRow(row, config);
				if (!note.title.trim()) continue; // the importer skips these

				// Written the way the importer would: through the shared final normalization
				// and sanitiser, under the location the template produced.
				const dir = note.location ? nodePath.join(produced, note.location) : produced;
				nodeFs.mkdirSync(dir, { recursive: true });
				nodeFs.writeFileSync(
					nodePath.join(dir, `${sanitizeFileName(note.title)}.md`),
					normalizeListProperties(note.content),
				);
			}

			expectTree(produced, expectedFor(file, nodePath.basename(file.name, '.csv')), file.name);
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

/**
 * Two things the parser does that are worth knowing about rather than
 * discovering. Both predate this test and are pinned here so a change to
 * either is a decision rather than a surprise.
 */
test('trims a quoted field, padding and all', () => {
	// Quoting normally means "keep this exactly", so losing the spaces is
	// arguably wrong - but it is what the importer has always done.
	assert.deepEqual(parseCSVLine('a,"  padded  ",c'), ['a', 'padded', 'c']);
});

test('drops fields beyond the number of headers', () => {
	const { rows } = parseCSV('h1,h2\nv1,v2,v3\n', true);

	assert.deepEqual(rows, [{ h1: 'v1', h2: 'v2' }], 'v3 has nowhere to go and is discarded');
});

test('names the columns when there is no header row', () => {
	const { headers, rows } = parseCSV('x,y\n1,2\n', false);

	assert.deepEqual(headers, ['Column 1', 'Column 2']);
	assert.equal(rows.length, 2, 'the first row is data, not headers');
	assert.deepEqual(rows[0], { 'Column 1': 'x', 'Column 2': 'y' });
});
