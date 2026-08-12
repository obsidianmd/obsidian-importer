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

import { RoamConverterOptions, RoamPageConverter } from '../../src/formats/roam/convert';
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
 * The same graph flattened, recorded beside the outline it came from.
 *
 * Only the written fixture: what flattening decides is what each block was
 * being used *as*, and a recording of that is only worth reading when the
 * blocks were chosen to ask the question.
 */
test('converts shapes.json with the outline flattened', async () => {
	const graph = graphs.find(candidate => candidate.name === 'shapes.json');
	assert.ok(graph, 'shapes.json should be one of the fixtures');

	const pages = JSON.parse(nodeFs.readFileSync(graph.path, 'utf8')) as RoamPage[];
	const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-roam-flat-'));

	try {
		const converted = await new RoamGraphConverter({
			graphFolder: 'shapes',
			userDNPFormat: DAILY_NOTE_FORMAT,
			fileDateYAML: false,
			titleYAML: false,
			deOutline: true,
		}).convert(pages);

		for (const [notePath, markdown] of converted.pages) {
			const file = nodePath.join(produced, nodePath.relative('shapes', notePath));
			nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
			nodeFs.writeFileSync(file, markdown);
		}

		expectTree(produced, expectedFor(graph, 'shapes-flat'), 'shapes.json flattened');
	}
	finally {
		nodeFs.rmSync(produced, { recursive: true, force: true });
	}
});

/**
 * The markup rewrites are where Roam-specific bugs live, so a few are named
 * rather than left to the recordings alone.
 */
function scrubber() {
	return new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: false,
		titleYAML: false,
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

/**
 * What flattening decides. Roam gives every block a bullet, so the question is
 * what each was being used as - and these are the answers the recordings do not
 * make obvious on their own.
 */
async function flattened(children: RoamBlock[]): Promise<string> {
	const converter = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: false,
		titleYAML: false,
		deOutline: true,
	});

	const page = { title: 'Page', uid: 'page', children } as RoamPage;
	return converter.jsonToMarkdown('graph', 'graph/Attachments', page, '', 0, 0);
}

test('a block on its own becomes a paragraph', async () => {
	assert.equal(await flattened([{ string: 'One thought' }, { string: 'Another' }]),
		'One thought\n\nAnother');
});

test('siblings that are really a list stay a list, under their parent as prose', async () => {
	assert.equal(await flattened([
		{ string: 'The shopping', children: [{ string: 'apples' }, { string: 'pears' }] },
	]), 'The shopping\n\n- apples\n- pears');
});

test('a lone child is the same thought, so it joins the paragraph', async () => {
	// One bullet under another is what an outliner encourages and prose does
	// not want; two siblings would have been a list.
	assert.equal(await flattened([
		{ string: 'A claim', children: [{ string: 'and what follows from it' }] },
	]), 'A claim\n\nand what follows from it');
});

test('a heading takes what is under it as its body', async () => {
	assert.equal(await flattened([
		{ string: 'Notes', heading: 2, children: [{ string: 'the body' }] },
	]), '## Notes\n\nthe body');
});

test('a heading is never a list item, however its siblings look', async () => {
	assert.equal(await flattened([
		{ string: 'Introduction', heading: 1 },
		{ string: 'Conclusion', heading: 1 },
	]), '# Introduction\n\n# Conclusion');
});

test('tasks stay a list, and consecutive ones are one list', async () => {
	assert.equal(await flattened([
		{ string: '{{[[TODO]]}} first' },
		{ string: '{{[[DONE]]}} second' },
		{ string: 'a paragraph' },
	]), '- [ ] first\n- [x] second\n\na paragraph');
});

test('a list nested under a list keeps its nesting', async () => {
	assert.equal(await flattened([
		{
			string: 'Kinds', children: [
				{ string: 'fruit', children: [{ string: 'apple' }, { string: 'pear' }] },
				{ string: 'vegetable' },
			],
		},
	]), 'Kinds\n\n- fruit\n    - apple\n    - pear\n- vegetable');
});

test('a block of several lines keeps them, and its anchor stays off the fence', async () => {
	const converter = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: false,
		titleYAML: false,
		deOutline: true,
		isReferenced: uid => uid === 'fenced',
	});

	const page = {
		title: 'Page', uid: 'page',
		children: [{ string: '```js\none();```', uid: 'fenced' }],
	} as RoamPage;

	assert.equal(await converter.jsonToMarkdown('graph', 'graph/Attachments', page, '', 0, 0),
		'```js\none();```\n^fenced');
});

test('a table stands at the margin either way', async () => {
	assert.equal(await flattened([
		{ string: 'Before' },
		{ string: '{{[[table]]}}', children: [{ string: 'One', children: [{ string: 'Two' }] }] },
		{ string: 'After' },
	]), 'Before\n\n| One | Two |\n| --- | --- |\n\nAfter');
});

/**
 * The options, each of which changes one decision the conversion would
 * otherwise make on the reader's behalf.
 */
function optioned(options: Partial<RoamConverterOptions>) {
	return new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: false,
		titleYAML: false,
		resolveBlockReference: uid => uid === 'abc123' ? 'Notes#^abc123' : null,
		isReferenced: uid => uid === 'abc123',
		...options,
	});
}

test('"show referenced blocks in place" makes a reference an embed', async () => {
	assert.equal(
		await optioned({ embedBlockReferences: true }).roamMarkupScrubber('', '', 'see ((abc123))'),
		'see ![[Notes#^abc123]]');
	// The alias the user wrote is still a link: an embed has nowhere to show one.
	assert.equal(
		await optioned({ embedBlockReferences: true }).roamMarkupScrubber('', '', '[shown](((abc123)))'),
		'[[Notes#^abc123|shown]]');
});

test('"remove references to missing blocks" takes out what cannot be resolved', async () => {
	const dropping = optioned({ dropUnresolvedReferences: true });

	// A Roam id is nine characters of its own alphabet. This one is shaped
	// like one and names no block, which is a reference to a block the export
	// left behind.
	assert.equal(await dropping.roamMarkupScrubber('', '', 'see ((dmQooXFj9)) here'), 'see  here');
	assert.equal(await dropping.roamMarkupScrubber('', '', '{{embed: ((dmQooXFj9))}}'), '');
	// One that does resolve is untouched.
	assert.equal(await dropping.roamMarkupScrubber('', '', 'see ((abc123))'), 'see [[Notes#^abc123]]');
});

test('and leaves an aside in parentheses alone, whatever that option says', async () => {
	// `((...))` is also how somebody writes an aside. Thirteen of the
	// thirty-one that resolved to nothing in a 1,107-page graph were of that
	// kind, and removing them would take a sentence out of the middle of a note.
	const dropping = optioned({ dropUnresolvedReferences: true });

	for (const aside of [
		'a long ((and interesting)) quote',
		// Roam's own change log writes remarks this way.
		'It is only a visual change ((you can still find the block in the DOM)) so do not use it',
		'Small improvement to all pages search ((Longer debounce time and normalize the search value))',
		// A footnote whose address is in parentheses is written exactly as an
		// aliased reference is, and the help graph has several.
		'a Johari Window[2](((https://en.wikipedia.org/wiki/Johari_window))) or a categorization',
		// The syntax, documented in a code span, with a placeholder for the id.
		'The format for aliases is `[alias](((blockid)))`',
	]) {
		assert.equal(await dropping.roamMarkupScrubber('', '', aside), aside);
	}
});

test('"remove queries" takes the query out instead of converting it', async () => {
	const dropping = optioned({ dropQueries: true });

	assert.equal(await dropping.roamMarkupScrubber('', '', 'before {{query: {and: [[A]]}}} after'), 'before  after');
	// Including one that has no counterpart, which is otherwise kept.
	assert.equal(await dropping.roamMarkupScrubber('', '', '{{query: {between: [[a]] [[b]]}}}'), '');
});

test('"keep attributes in the note" leaves them in the outline, double colon and all', async () => {
	const page = {
		title: 'Sapiens', uid: 'sapiens',
		children: [{ string: 'Author:: Ada Lovelace' }, { string: 'a block' }],
	} as RoamPage;

	const keeping = optioned({ keepAttributesInOutline: true });
	assert.equal(await keeping.jsonToMarkdown('graph', 'graph/Attachments', page, '', 0, 0),
		'- Author:: Ada Lovelace\n- a block');
	assert.deepEqual([...keeping.attributeNames], [], 'nothing lifted means no column for the Base');

	// The default still lifts it.
	assert.equal(await optioned({}).jsonToMarkdown('graph', 'graph/Attachments', page, '', 0, 0),
		'---\nAuthor: Ada Lovelace\n---\n- a block');
});

/**
 * The graph pass, which is where a page's name and a link to it are decided.
 * These are the ways the two came apart, each of which lost something quietly.
 */
function graphConverter(overrides: Record<string, unknown> = {}) {
	return new RoamGraphConverter({
		graphFolder: 'g',
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: false,
		titleYAML: false,
		...overrides,
	});
}

test('two titles that sanitise to one name are still two notes', async () => {
	// The name was decided where the note was written, so the second page
	// overwrote the first in the map before either got there.
	const pages = [
		{ title: 'A[B]', uid: 'p1', children: [{ string: 'the first', uid: 'b1' }] },
		{ title: 'AB', uid: 'p2', children: [{ string: 'the second', uid: 'b2' }] },
	] as unknown as RoamPage[];

	const { pages: written } = await graphConverter().convert(pages);

	assert.deepEqual([...written.keys()], ['g/AB.md', 'g/AB 1.md']);
	assert.equal(written.get('g/AB.md'), '- the first');
	assert.equal(written.get('g/AB 1.md'), '- the second');
});

test('and a link to one of them names the note that was written', async () => {
	const pages = [
		{ title: 'A[B]', uid: 'p1', children: [{ string: 'the first', uid: 'b1' }] },
		{ title: 'AB', uid: 'p2', children: [{ string: 'the second', uid: 'b2' }] },
		{ title: 'Pointing', uid: 'p3', children: [{ string: 'see [[AB]]', uid: 'b3' }] },
	] as unknown as RoamPage[];

	const { pages: written } = await graphConverter().convert(pages);

	assert.equal(written.get('g/Pointing.md'), '- see [[AB 1]]');
});

test('a link to a title too long for a file name is cut the same way the file was', async () => {
	const long = 'Like optical illusions intellectual illusions can trick us into thinking something that is not actually there or true and even when we know they are there we still have to actively override our default perception to get at the truth behind it';
	const pages = [
		{ title: long, uid: 'p1', children: [{ string: 'body', uid: 'b1' }] },
		{ title: 'Pointing', uid: 'p2', children: [{ string: `see [[${long}]]`, uid: 'b2' }] },
	] as unknown as RoamPage[];

	const { pages: written } = await graphConverter().convert(pages);
	const named = /\[\[(.+?)\]\]/.exec(written.get('g/Pointing.md') as string)?.[1];

	assert.ok(named && written.has(`g/${named}.md`), `the link names "${named}", which is not among ${[...written.keys()]}`);
});

test('a reference to a table cell stays as Roam wrote it, having nowhere to reach', async () => {
	// A table's marker becomes the table and its cells become rows, so neither
	// can carry a `^id`. A link to an anchor that was never written is worse
	// than the reference it replaced.
	const table = (uid: string) => ({
		string: '{{[[table]]}}', uid,
		children: [{ string: 'Cell', uid: `${uid}-cell` }],
	});

	const pages = [
		{
			title: 'Source', uid: 'p1', children: [
				table('top'),
				// A marker is a marker wherever it sits. Asking whether the
				// *parent* was one left every nested marker indexed.
				{ string: 'Under a block', uid: 'head', children: [table('deep')] },
			],
		},
		{
			title: 'Pointing', uid: 'p2', children: [
				{ string: 'a ((top)) b ((top-cell)) c ((deep)) d ((deep-cell))', uid: 'b1' },
			],
		},
	] as unknown as RoamPage[];

	const { pages: written } = await graphConverter().convert(pages);

	assert.equal(written.get('g/Pointing.md'), '- a ((top)) b ((top-cell)) c ((deep)) d ((deep-cell))');
});

test('an attribute something points at stays in the outline, where its anchor can go', async () => {
	// A property has nowhere to carry an anchor, so lifting a referenced
	// attribute would leave the reference pointing at nothing.
	const pages = [
		{
			title: 'Sapiens', uid: 'p1', children: [
				{ string: 'Author:: Ada', uid: 'attr' },
				{ string: 'Status:: read', uid: 'plain' },
			],
		},
		{ title: 'Pointing', uid: 'p2', children: [{ string: 'see ((attr))', uid: 'b1' }] },
	] as unknown as RoamPage[];

	const { pages: written } = await graphConverter().convert(pages);

	assert.equal(written.get('g/Sapiens.md'), '---\nStatus: read\n---\n- Author:: Ada ^attr');
	assert.equal(written.get('g/Pointing.md'), '- see [[Sapiens#^attr]]');
});

test('a lifted attribute still counts towards the page timestamps', async () => {
	// It is taken out of the outline before the walk, so its own times are
	// folded in where it is lifted or the page comes out dated without it.
	const page = {
		title: 'Sapiens', uid: 'p1', 'create-time': 1000, 'edit-time': 1000,
		children: [{ string: 'Author:: Ada', uid: 'attr', 'create-time': 1000, 'edit-time': 9_000_000_000_000 }],
	} as unknown as RoamPage;

	const converter = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		fileDateYAML: true,
		titleYAML: false,
	});
	await converter.jsonToMarkdown('g', 'g/A', page, '', 1000, 1000);

	assert.equal(converter.newestTimestamp, 9_000_000_000_000);
});

/**
 * Roam marks a heading on the block rather than in its text, so a block can be
 * a heading and be written in bold as well. The help graph has sixty.
 */
async function headed(string: string, heading: number): Promise<string> {
	const page = { title: 'P', uid: 'p', children: [{ string, heading }] } as unknown as RoamPage;

	return scrubber().jsonToMarkdown('g', 'g/A', page, '', 0, 0);
}

test('bold wrapped round the whole of a heading is dropped', async () => {
	// A heading is already bold, so the markup only shows.
	assert.equal(await headed('**Quick Start**', 2), '- ## Quick Start');
	assert.equal(await headed('**Types of queries**', 1), '- # Types of queries');
});

test('but bold over part of a heading is kept, since it still marks something out', async () => {
	assert.equal(await headed('The **important** part', 2), '- ## The **important** part');
	assert.equal(await headed('**one** and **two**', 2), '- ## **one** and **two**');
});

test('and a block that is not a heading keeps its bold either way', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '**Quick Start**'), '**Quick Start**');
});
