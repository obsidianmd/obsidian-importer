/**
 * The Roam conversion, outside Obsidian.
 *
 * A page from an exported graph goes in and markdown comes out. The converter
 * needs no vault: the importer's settings are passed to it, and downloading a
 * file a block links to is a callback, left out here so links are recorded as
 * the export wrote them.
 *
 * Each graph in this directory is converted with the settings the importer
 * uses by default, and every page is recorded as the file it would write.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { RoamPageConverter } from '../../src/formats/roam/convert';
import { RoamGraphConverter } from '../../src/formats/roam/graph';
import { RoamBlock, RoamPage } from '../../src/formats/roam/models/roam-json';
import { expectedFor, expectTree, fixtures } from '../helpers';

const FIXTURES = __dirname;

/** What the importer defaults to when the daily-note plugin is not configured. */
const DAILY_NOTE_FORMAT = 'YYYY-MM-DD';

/**
 * Above this many pages a graph is converted but not recorded.
 *
 * The graphs committed here are small enough to record. A whole exported graph
 * dropped into local/ is not: recording a thousand notes is output nobody is
 * going to read, and a recording nobody reads is not a check - it just goes
 * green. One that size is still worth converting, because that is what catches
 * a page shape that throws, so it is run and counted instead.
 */
const RECORDABLE_PAGES = 25;

const graphs = fixtures(FIXTURES, '.json');

test('there are graphs to convert', () => {
	assert.ok(graphs.length > 0, 'expected at least one .json in tests/roam');
});

for (const graph of graphs) {
	test(`converts ${graph.name}`, async () => {
		const pages = JSON.parse(nodeFs.readFileSync(graph.path, 'utf8')) as RoamPage[];
		assert.ok(Array.isArray(pages) && pages.length > 0, 'the graph should contain pages');

		const name = nodePath.basename(graph.name, '.json');
		const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-roam-'));
		let written = 0;

		try {
			// The graph rather than a page: a block reference names a block on
			// another page, so what a page converts to is not settled until
			// every page has been read.
			const converted = await new RoamGraphConverter({
				graphFolder: name,
				userDNPFormat: DAILY_NOTE_FORMAT,
				fileDateYAML: false,
				titleYAML: false,
				downloadAttachments: false,
			}).convert(pages);

			for (const [notePath, markdown] of converted.pages) {
				// The converter names a note the way the importer does, under
				// the graph folder; the recordings are the folder's contents.
				const file = nodePath.join(produced, nodePath.relative(name, notePath));
				nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
				nodeFs.writeFileSync(file, markdown);
				written++;
			}

			assert.ok(written > 0, 'the graph should have produced notes');

			if (pages.length <= RECORDABLE_PAGES) {
				expectTree(produced, expectedFor(graph, name), graph.name);
			}
		}
		finally {
			nodeFs.rmSync(produced, { recursive: true, force: true });
		}
	});
}

/**
 * The markup rewrites are where Roam-specific bugs live, so a few are named
 * rather than left to the recordings alone.
 */
function scrubber() {
	return new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: false,
		titleYAML: false,
		downloadAttachments: false,
	});
}

test('converts Roam TODO and DONE markers to checkboxes', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '{{[[TODO]]}} a task'), '[ ] a task');
	assert.equal(await scrubber().roamMarkupScrubber('', '', '{{[[DONE]]}} a task'), '[x] a task');
});

test('converts Roam emphasis to Obsidian emphasis', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '__italic__'), '*italic*');
	assert.equal(await scrubber().roamMarkupScrubber('', '', '^^highlight^^'), '==highlight==');
});

/**
 * References and embeds, which are the two things a block can say about
 * another block. Both need the graph to say where that block ended up; a
 * scrubber without one leaves the markup as Roam wrote it.
 */
function referring(blocks: Record<string, string> = { abc123: 'Notes' }) {
	return new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: false,
		titleYAML: false,
		downloadAttachments: false,
		resolveBlockReference: uid => uid in blocks ? `${blocks[uid]}#^${uid}` : null,
		isReferenced: uid => uid in blocks,
	});
}

test('a block embed becomes an embed, not a link (#246)', async () => {
	assert.equal(await referring().roamMarkupScrubber('', '', '{{embed: ((abc123))}}'), '![[Notes#^abc123]]');
	assert.equal(await referring().roamMarkupScrubber('', '', '{{[[embed]]: ((abc123))}}'), '![[Notes#^abc123]]');
	assert.equal(await referring().roamMarkupScrubber('', '', '{{embed-path: ((abc123))}}'), '![[Notes#^abc123]]');
});

test('an embedded page becomes an embed too, and needs nothing looked up', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '{{[[embed]]: [[testing]]}}'), '![[testing]]');
});

test('a block reference becomes a link to the block (#247)', async () => {
	assert.equal(await referring().roamMarkupScrubber('', '', 'see ((abc123))'), 'see [[Notes#^abc123]]');
});

test('and carries no copy of what the block says, however often it is referred to', async () => {
	// The alias used to hold the block's text, and the second reference to one
	// block got the anchor the first reference had appended to it (#247).
	const twice = await referring().roamMarkupScrubber('', '', '((abc123)) and again ((abc123))');

	assert.equal(twice, '[[Notes#^abc123]] and again [[Notes#^abc123]]');
});

test('an aliased reference keeps the alias the user wrote', async () => {
	assert.equal(await referring().roamMarkupScrubber('', '', '[the block](((abc123)))'), '[[Notes#^abc123|the block]]');
});

test('a checkbox to the left of an aliased reference is not taken into the alias', async () => {
	// `{{[[TODO]]}}` becomes `[ ]` before the reference is read, and an alias
	// allowed to reach across a bracket takes the checkbox with it.
	assert.equal(
		await referring().roamMarkupScrubber('', '', '{{[[TODO]]}} do it [->](((abc123)))'),
		'[ ] do it [[Notes#^abc123|->]]');
});

test('a parenthetical that is nobody\'s block id is left as it was', async () => {
	// It used to lose its brackets and be left as bare text.
	assert.equal(
		await referring().roamMarkupScrubber('', '', 'a long ((and interesting)) quote'),
		'a long ((and interesting)) quote');
});

test('a reference to a block the graph does not hold is left as it was', async () => {
	assert.equal(await referring().roamMarkupScrubber('', '', '((notinhere))'), '((notinhere))');
	assert.equal(await referring().roamMarkupScrubber('', '', '{{embed: ((notinhere))}}'), '{{embed: ((notinhere))}}');
});

test('turns a Roam quote into a blockquote', async () => {
	// The excerpt has no page using [[>]], so this is the only check on it
	assert.equal(await scrubber().roamMarkupScrubber('', '', '[[>]] quoted'), '> quoted');
});

test('turns a page alias into an Obsidian alias', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '[shown]([[Real Page]])'), '[[Real Page|shown]]');
});

/** The conversion writes four spaces a level; markdown-output.ts applies what the vault uses. */
function outline() {
	const converter = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: false,
		titleYAML: false,
		downloadAttachments: false,
	});

	const page = {
		title: 'Outline',
		children: [{
			string: 'Block level',
			children: [
				{ string: 'testing' },
				{ string: 'test', children: [{ string: 'testing' }] },
			],
		}],
	} as unknown as RoamPage;

	return converter.jsonToMarkdown('graph', 'graph/Attachments', page, '', 0, 0);
}

test('starts the outline at the margin and indents each level by four spaces', async () => {
	assert.equal(await outline(), [
		'- Block level',
		'    - testing',
		'    - test',
		'        - testing',
	].join('\n'));
});

test('indents the lines after the first to the item text, so a fence stays in the item', async () => {
	const converter = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: false,
		titleYAML: false,
		downloadAttachments: false,
	});

	const page = {
		title: 'Code',
		children: [{ string: 'Code', children: [{ string: '```js\none();\ntwo();```' }] }],
	} as unknown as RoamPage;

	assert.equal(await converter.jsonToMarkdown('graph', 'graph/Attachments', page, '', 0, 0), [
		'- Code',
		'    - ```js',
		'      one();',
		'      two();```',
	].join('\n'));
});

/**
 * The anchor a reference reaches. It used to be patched into the finished
 * markdown by looking for a line holding the block's text, which found the
 * wrong line as readily as the right one and no line at all for a block of
 * more than one.
 */
async function anchored(page: RoamPage, referenced: string[]): Promise<string> {
	const converter = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: false,
		titleYAML: false,
		downloadAttachments: false,
		isReferenced: uid => referenced.includes(uid),
	});

	return converter.jsonToMarkdown('graph', 'graph/Attachments', page, '', 0, 0);
}

test('a block something points at grows an anchor', async () => {
	const page = { title: 'Notes', uid: 'notes', children: [{ string: 'the block', uid: 'abc123' }] } as RoamPage;

	assert.equal(await anchored(page, ['abc123']), '- the block ^abc123');
});

test('and a block nothing points at is left without one', async () => {
	const page = { title: 'Notes', uid: 'notes', children: [{ string: 'the block', uid: 'abc123' }] } as RoamPage;

	assert.equal(await anchored(page, []), '- the block');
});

test('a block of several lines takes its anchor on a line of its own', async () => {
	// Appended to the closing fence it would be read as part of the code.
	const page = {
		title: 'Notes', uid: 'notes',
		children: [{ string: '```js\none();```', uid: 'fenced' }],
	} as RoamPage;

	assert.equal(await anchored(page, ['fenced']), [
		'- ```js',
		'  one();```',
		'  ^fenced',
	].join('\n'));
});

/**
 * Tables are the one place the converter reads the tree rather than a block's
 * text, so the shapes Roam can build are named here. The recorded pages cover
 * the ordinary case.
 */

/** One page holding one table marker, converted. */
async function convertTable(rows: RoamBlock[], marker: string = '{{[[table]]}}'): Promise<string> {
	const page = {
		title: 'Tables', uid: 'tables',
		children: [rows.length > 0 ? { string: marker, children: rows } : { string: marker }],
	} as RoamPage;

	return scrubber().jsonToMarkdown('Tables', 'Tables/Attachments', page, '', 0, 0);
}

/** A row, as Roam nests it: each column is a child of the column before it. */
function row(cells: string[]): RoamBlock {
	const [first, ...rest] = cells;
	return rest.length > 0 ? { string: first, children: [row(rest)] } : { string: first };
}

test('converts a Roam table to a pipe table, the first row its header', async () => {
	assert.equal(
		await convertTable([row(['Name', 'Colour']), row(['Apple', 'Red'])]),
		'\n| Name | Colour |\n| --- | --- |\n| Apple | Red |\n');
});

test('converts the bare {{table}} spelling too', async () => {
	assert.equal(await convertTable([row(['One'])], '{{table}}'), '\n| One |\n| --- |\n');
});

test('leaves an unbalanced table marker as an ordinary block', async () => {
	// `{{[[table}}` is not a spelling Roam writes.
	assert.equal(await convertTable([row(['One'])], '{{[[table}}'), '- {{[[table}}\n    - One');
});

test('a cell with several children is several rows sharing it', async () => {
	// The cell is shown once and left empty on the rows below, which is how
	// Roam draws it. Reading only the first child would drop the rest.
	const shared: RoamBlock = {
		string: 'Fruit',
		children: [{ string: 'Apple' }, { string: 'Pear' }],
	};

	assert.equal(await convertTable([row(['Kind', 'Name']), shared]), [
		'',
		'| Kind | Name |',
		'| --- | --- |',
		'| Fruit | Apple |',
		'|  | Pear |',
		'',
	].join('\n'));
});

test('pads a row Roam left short', async () => {
	assert.equal(
		await convertTable([row(['Name', 'Colour']), row(['Apple'])]),
		'\n| Name | Colour |\n| --- | --- |\n| Apple |  |\n');
});

test('escapes a pipe inside a cell, which would otherwise end it', async () => {
	assert.equal(await convertTable([row(['a | b'])]), '\n| a \\| b |\n| --- |\n');
});

test('keeps a cell of several lines on one row', async () => {
	assert.equal(await convertTable([row(['one\ntwo'])]), '\n| one<br>two |\n| --- |\n');
});

test('a table marker with no rows leaves nothing behind, marker included', async () => {
	assert.equal(await convertTable([]), '');
});

test('converts the markup inside a cell', async () => {
	assert.equal(
		await convertTable([row(['{{[[TODO]]}} ^^done^^'])]),
		'\n| [ ] ==done== |\n| --- |\n');
});

/**
 * Queries. These used to be deleted outright, so a page built around one was
 * imported with nothing on it.
 */

test('converts a Roam query to an Obsidian query block', async () => {
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{query: {and: [[A]] [[B]]}}}'),
		'```query\nblock:([[A]] [[B]])\n```');
});

test('converts the {{[[query]]}} spelling too', async () => {
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{[[query]]: {and: [[A]]}}}'),
		'```query\nblock:([[A]])\n```');
});

test('or becomes OR, and not becomes an exclusion', async () => {
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{query: {or: [[A]] [[B]]}}}'),
		'```query\nblock:([[A]] OR [[B]])\n```');
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{query: {not: [[A]]}}}'),
		'```query\nblock:(-[[A]])\n```');
});

test('a nested clause is parenthesised, so an or inside an and keeps its meaning', async () => {
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{query: {and: [[A]] {or: [[B]] [[C]]}}}}'),
		'```query\nblock:([[A]] ([[B]] OR [[C]]))\n```');
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{query: {and: [[A]] {not: [[B]] }}}}'),
		'```query\nblock:([[A]] (-[[B]]))\n```');
});

test('a tag is a term like any other', async () => {
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{query: {and: #done [[A]]}}}'),
		'```query\nblock:(#done [[A]])\n```');
});

test('a query Obsidian cannot express is left as Roam wrote it', async () => {
	// `{between:}` has no counterpart, and half a query is worse than a legible
	// one to rewrite by hand. The daily notes it names are still renamed, so
	// what is left to rewrite points at the notes that were written.
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{query: {between: [[January 1st, 2021]] [[today]] }}}'),
		'{{query: {between: [[2021-01-01]] [[today]] }}}');

	const partly = '{{query: {and: [[A]] {between: [[x]] [[y]]}}}}';
	assert.equal(await scrubber().roamMarkupScrubber('', '', partly), partly);
});

test('a query shown as an example inside backticks is left alone', async () => {
	// Roam's own help pages document the syntax this way, and a fence opened
	// inside a code span makes a mess of both.
	const documented = 'write it as `{{query: {and: [[A]] [[B]]}}}` in a block';
	assert.equal(await scrubber().roamMarkupScrubber('', '', documented), documented);
});

test('two queries in one block are both converted', async () => {
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{query: {and: [[A]]}}} and {{query: {and: [[B]]}}}'),
		'```query\nblock:([[A]])\n``` and ```query\nblock:([[B]])\n```');
});
