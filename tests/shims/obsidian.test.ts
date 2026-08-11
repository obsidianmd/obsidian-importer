/**
 * The shim against the app.
 *
 * These are not tests of the importers - they check that what the shim writes
 * is what Obsidian writes, which every recording depends on. The expected
 * values here came from the app, by round-tripping the same input through
 * processFrontMatter; see CLAUDE.md for how to redo that.
 */
// The table cases convert HTML, which wants a DOM before turndown loads.
import './dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as yaml from 'yaml';

import { htmlToMarkdown, stringifyYaml } from './obsidian';

test('writes YAML the way Obsidian does', () => {
	const written = stringifyYaml({
		date: '2023-12-17',
		datetime: '2024-06-01T12:30:00.000Z',
		time: '12:30',
		numberish: '007',
		boolish: 'true',
		yes: 'yes',
		plain: 'hello',
		colon: 'a: b',
		list: ['2019-03-14', 'plain'],
		num: 42,
		real: 18.99,
		bool: true,
		nul: null,
	});

	// Byte for byte what the app produced for the same object
	assert.equal(written, [
		'date: 2023-12-17',
		'datetime: 2024-06-01T12:30:00.000Z',
		'time: 12:30',
		'numberish: "007"',
		'boolish: "true"',
		'yes: yes',
		'plain: hello',
		'colon: "a: b"',
		'list:',
		'  - 2019-03-14',
		'  - plain',
		'num: 42',
		'real: 18.99',
		'bool: true',
		'nul:',
		'',
	].join('\n'));
});

test('quotes the way Obsidian does', () => {
	// Round-tripped through processFrontMatter in the app, which quotes less
	// than might be expected: a value with a double quote in it is single
	// quoted, and one with both kinds is not quoted at all.
	const written = stringifyYaml({
		aliases: ['Notes: on "quoting" / naming'],
		single: 'it\'s got an apostrophe',
		both: 'has "double" and \'single\'',
		colon: 'a: b',
		backslash: 'a \\ b',
		plain: 'hello',
	});

	assert.equal(written, [
		'aliases:',
		'  - \'Notes: on "quoting" / naming\'',
		'single: it\'s got an apostrophe',
		'both: has "double" and \'single\'',
		'colon: "a: b"',
		'backslash: a \\ b',
		'plain: hello',
		'',
	].join('\n'));
});

test('leaves the inside of a multi-line value alone', () => {
	// The quoting and null rules are applied line by line, and a block
	// scalar's lines are its value rather than YAML
	const value = { note: 'line one\nfoo: null\nquoted: \'x\'\nend', ok: null };

	assert.deepEqual(yaml.parse(stringifyYaml(value)), value);
});

/**
 * Tables, against the app.
 *
 * turndown writes no table at all without its GFM plugin, and the plugin is
 * not what Obsidian uses: it pads a cell to `| a |` and squares off a short
 * row, and the app does neither. Every expectation below is what the app
 * returned for that exact input, collected through the htmlToMarkdown probe
 * described in CLAUDE.md.
 */
const TABLES: [name: string, html: string, markdown: string][] = [
	[
		'a header and its rows',
		'<table><thead><tr><th>City</th><th>Days</th></tr></thead><tbody><tr><td>Kyoto</td><td>3</td></tr><tr><td>Osaka</td><td>2</td></tr></tbody></table>',
		'|City|Days|\n|---|---|\n|Kyoto|3|\n|Osaka|2|',
	],
	[
		'no header, so an empty one is written',
		'<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>',
		'|   |   |\n|---|---|\n|a|b|\n|c|d|',
	],
	[
		'a first row of th is the header without a thead',
		'<table><tr><th>h</th></tr><tr><td>a|b</td></tr></table>',
		'|h|\n|---|\n|a\\|b|',
	],
	[
		'a colspan is not expanded, and the header is padded to the widest row',
		'<table><tr><th colspan="2">Spanning</th></tr><tr><td>a</td><td>b</td></tr></table>',
		'|Spanning|   |\n|---|---|\n|a|b|',
	],
	[
		'a short row is left short',
		'<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>',
		'|   |   |   |\n|---|---|---|\n|a|b|c|\n|d|',
	],
	[
		'a header wider than the body sets the width',
		'<table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td>1</td></tr></table>',
		'|a|b|c|\n|---|---|---|\n|1|',
	],
	[
		'blocks inside a cell are joined with br',
		'<table><tr><th>h1</th><th>h2</th></tr><tr><td><p>one</p><p>two</p></td><td><ul><li>x</li><li>y</li></ul></td></tr></table>',
		'|h1|h2|\n|---|---|\n|one<br><br>two|- x<br>- y|',
	],
	[
		'a nested table arrives as escaped pipes',
		'<table><tr><td><table><tr><td>inner1</td><td>inner2</td></tr></table></td></tr></table>',
		'|   |\n|---|\n|\\|   \\|   \\|<br>\\|---\\|---\\|<br>\\|inner1\\|inner2\\||',
	],
	[
		'an empty cell stays empty, where a padded one is spaces',
		'<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td></td></tr></table>',
		'|a|b|\n|---|---|\n|1||',
	],
	[
		'a thead is the header from wherever it stands',
		'<table><tfoot><tr><td>f1</td><td>f2</td></tr></tfoot><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>b1</td><td>b2</td></tr></tbody></table>',
		'|f1|f2|\n|h1|h2|\n|---|---|\n|b1|b2|',
	],
	[
		'a row of th in the middle is not a header',
		'<table><tr><td>a</td><td>b</td></tr><tr><th>h1</th><th>h2</th></tr><tr><td>c</td><td>d</td></tr></table>',
		'|   |   |\n|---|---|\n|a|b|\n|h1|h2|\n|c|d|',
	],
	[
		'a th in the first column is not a header either',
		'<table><tr><th>Name</th><td>Ada</td></tr><tr><th>Job</th><td>Maths</td></tr></table>',
		'|   |   |\n|---|---|\n|Name|Ada|\n|Job|Maths|',
	],
	[
		'a caption is written where it stood, and suppresses the header',
		'<table><caption>The caption</caption><tr><th>a</th></tr><tr><td>1</td></tr></table>',
		'|   |\n|---|\nThe caption\n|a|\n|1|',
	],
	[
		'a colgroup suppresses the header the same way',
		'<table><colgroup><col><col></colgroup><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>',
		'|   |   |\n|---|---|\n|a|b|\n|1|2|',
	],
	[
		'a row with no cells is skipped',
		'<table><tr><th>a</th></tr><tr></tr><tr><td>1</td></tr></table>',
		'|a|\n|---|\n|1|',
	],
	[
		'a thead on its own is a header and nothing else',
		'<table><thead><tr><th>a</th><th>b</th></tr></thead></table>',
		'|a|b|\n|---|---|',
	],
	[
		'a cell is trimmed, and a br inside it survives',
		'<table><tr><th>a</th></tr><tr><td>  x  </td></tr><tr><td>one<br>two</td></tr></table>',
		'|a|\n|---|\n|x|\n|one  <br>two|',
	],
	[
		'a table keeps its place among the blocks around it',
		'<h1>Title</h1><p>Before.</p><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table><p>After.</p>',
		'# Title\n\nBefore.\n\n|a|b|\n|---|---|\n|1|2|\n\nAfter.',
	],
];

for (const [name, html, markdown] of TABLES) {
	test(`writes a table the way Obsidian does: ${name}`, () => {
		assert.equal(htmlToMarkdown(html), markdown);
	});
}

/**
 * The app throws here - `Cannot read properties of undefined (reading
 * 'cells')` - which fails the note being imported rather than losing a table.
 * Measured, and deliberately not reproduced: a crash is not worth matching.
 */
test('writes nothing for a table with no rows, where the app throws', () => {
	assert.equal(htmlToMarkdown('<table></table>'), '');
});
