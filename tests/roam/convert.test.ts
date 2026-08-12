import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { roamDefaults, RoamConverterOptions, RoamPageConverter } from '../../src/formats/roam/convert';
import { RoamGraphConverter } from '../../src/formats/roam/graph';
import { RoamBlock, RoamPage } from '../../src/formats/roam/models/roam-json';
import { expectedFor, expectTree, fixtures } from '../helpers';

const FIXTURES = __dirname;

const DAILY_NOTE_FORMAT = 'YYYY-MM-DD';

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
			const converted = await new RoamGraphConverter({
				graphFolder: name,
				userDNPFormat: DAILY_NOTE_FORMAT,
				...roamDefaults,
			}).convert(pages);

			for (const [notePath, markdown] of converted.pages) {
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

test('converts shapes.json with the outline flattened', async () => {
	const graph = graphs.find(candidate => candidate.name === 'shapes.json');
	assert.ok(graph, 'shapes.json should be one of the fixtures');

	const pages = JSON.parse(nodeFs.readFileSync(graph.path, 'utf8')) as RoamPage[];
	const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-roam-outline-'));

	try {
		const converted = await new RoamGraphConverter({
			graphFolder: 'shapes',
			userDNPFormat: DAILY_NOTE_FORMAT,
			...roamDefaults,
			deOutline: false,
		}).convert(pages);

		for (const [notePath, markdown] of converted.pages) {
			const file = nodePath.join(produced, nodePath.relative('shapes', notePath));
			nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
			nodeFs.writeFileSync(file, markdown);
		}

		expectTree(produced, expectedFor(graph, 'shapes-outline'), 'shapes.json as an outline');
	}
	finally {
		nodeFs.rmSync(produced, { recursive: true, force: true });
	}
});

function scrubber() {
	return new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
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

function referring(blocks: Record<string, string> = { abc123: 'Notes' }) {
	return new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
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
	const twice = await referring().roamMarkupScrubber('', '', '((abc123)) and again ((abc123))');

	assert.equal(twice, '[[Notes#^abc123]] and again [[Notes#^abc123]]');
});

test('an aliased reference keeps the alias the user wrote', async () => {
	assert.equal(await referring().roamMarkupScrubber('', '', '[the block](((abc123)))'), '[[Notes#^abc123|the block]]');
});

test('a checkbox to the left of an aliased reference is not taken into the alias', async () => {
	assert.equal(
		await referring().roamMarkupScrubber('', '', '{{[[TODO]]}} do it [->](((abc123)))'),
		'[ ] do it [[Notes#^abc123|->]]');
});

test('a parenthetical that is nobody\'s block id is left as it was', async () => {
	assert.equal(
		await referring().roamMarkupScrubber('', '', 'a long ((and interesting)) quote'),
		'a long ((and interesting)) quote');
});

test('a reference to a block the graph does not hold is left as it was', async () => {
	assert.equal(await referring().roamMarkupScrubber('', '', '((notinhere))'), '((notinhere))');
	assert.equal(await referring().roamMarkupScrubber('', '', '{{embed: ((notinhere))}}'), '{{embed: ((notinhere))}}');
});

test('turns a Roam quote into a blockquote', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '[[>]] quoted'), '> quoted');
});

test('turns a page alias into an Obsidian alias', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '[shown]([[Real Page]])'), '[[Real Page|shown]]');
});

function outline() {
	const converter = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
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

	return converter.jsonToMarkdown('graph', 'graph/Attachments', page);
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
	});

	const page = {
		title: 'Code',
		children: [{ string: 'Code', children: [{ string: '```js\none();\ntwo();```' }] }],
	} as unknown as RoamPage;

	assert.equal(await converter.jsonToMarkdown('graph', 'graph/Attachments', page), [
		'- Code',
		'    - ```js',
		'      one();',
		'      two();',
		'      ```',
	].join('\n'));
});

async function anchored(page: RoamPage, referenced: string[]): Promise<string> {
	const converter = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		isReferenced: uid => referenced.includes(uid),
	});

	return converter.jsonToMarkdown('graph', 'graph/Attachments', page);
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
	const page = {
		title: 'Notes', uid: 'notes',
		children: [{ string: '```js\none();```', uid: 'fenced' }],
	} as RoamPage;

	assert.equal(await anchored(page, ['fenced']), [
		'- ```js',
		'  one();',
		'  ```',
		'  ^fenced',
	].join('\n'));
});


async function convertTable(rows: RoamBlock[], marker: string = '{{[[table]]}}'): Promise<string> {
	const page = {
		title: 'Tables', uid: 'tables',
		children: [rows.length > 0 ? { string: marker, children: rows } : { string: marker }],
	} as RoamPage;

	return scrubber().jsonToMarkdown('Tables', 'Tables/Attachments', page);
}

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
	assert.equal(await convertTable([row(['One'])], '{{[[table}}'), '- {{[[table}}\n    - One');
});

test('a cell with several children is several rows sharing it', async () => {
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
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{query: {between: [[January 1st, 2021]] [[today]] }}}'),
		'{{query: {between: [[2021-01-01]] [[today]] }}}');

	const partly = '{{query: {and: [[A]] {between: [[x]] [[y]]}}}}';
	assert.equal(await scrubber().roamMarkupScrubber('', '', partly), partly);
});

test('a query shown as an example inside backticks is left alone', async () => {
	const documented = 'write it as `{{query: {and: [[A]] [[B]]}}}` in a block';
	assert.equal(await scrubber().roamMarkupScrubber('', '', documented), documented);
});

test('two queries in one block are both converted', async () => {
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{query: {and: [[A]]}}} and {{query: {and: [[B]]}}}'),
		'```query\nblock:([[A]])\n``` and ```query\nblock:([[B]])\n```');
});

async function flattened(children: RoamBlock[]): Promise<string> {
	const converter = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		deOutline: true,
	});

	const page = { title: 'Page', uid: 'page', children } as RoamPage;
	return converter.jsonToMarkdown('graph', 'graph/Attachments', page);
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
		deOutline: true,
		isReferenced: uid => uid === 'fenced',
	});

	const page = {
		title: 'Page', uid: 'page',
		children: [{ string: '```js\none();```', uid: 'fenced' }],
	} as RoamPage;

	assert.equal(await converter.jsonToMarkdown('graph', 'graph/Attachments', page),
		'```js\none();\n```\n^fenced');
});

test('a table stands at the margin either way', async () => {
	assert.equal(await flattened([
		{ string: 'Before' },
		{ string: '{{[[table]]}}', children: [{ string: 'One', children: [{ string: 'Two' }] }] },
		{ string: 'After' },
	]), 'Before\n\n| One | Two |\n| --- | --- |\n\nAfter');
});

function optioned(options: Partial<RoamConverterOptions>) {
	return new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		resolveBlockReference: uid => uid === 'abc123' ? 'Notes#^abc123' : null,
		isReferenced: uid => uid === 'abc123',
		...options,
	});
}

test('"show referenced blocks in place" makes a reference an embed', async () => {
	assert.equal(
		await optioned({ embedBlockReferences: true }).roamMarkupScrubber('', '', 'see ((abc123))'),
		'see ![[Notes#^abc123]]');
	assert.equal(
		await optioned({ embedBlockReferences: true }).roamMarkupScrubber('', '', '[shown](((abc123)))'),
		'[[Notes#^abc123|shown]]');
});

test('"remove references to missing blocks" takes out what cannot be resolved', async () => {
	const dropping = optioned({ dropUnresolvedReferences: true });

	assert.equal(await dropping.roamMarkupScrubber('', '', 'see ((dmQooXFj9)) here'), 'see  here');
	assert.equal(await dropping.roamMarkupScrubber('', '', '{{embed: ((dmQooXFj9))}}'), '');
	assert.equal(await dropping.roamMarkupScrubber('', '', 'see ((abc123))'), 'see [[Notes#^abc123]]');
});

test('and leaves an aside in parentheses alone, whatever that option says', async () => {
	const dropping = optioned({ dropUnresolvedReferences: true });

	for (const aside of [
		'a long ((and interesting)) quote',
		'It is only a visual change ((you can still find the block in the DOM)) so do not use it',
		'Small improvement to all pages search ((Longer debounce time and normalize the search value))',
		'a Johari Window[2](((https://en.wikipedia.org/wiki/Johari_window))) or a categorization',
		'The format for aliases is `[alias](((blockid)))`',
	]) {
		assert.equal(await dropping.roamMarkupScrubber('', '', aside), aside);
	}
});

test('"remove queries" takes the query out instead of converting it', async () => {
	const dropping = optioned({ dropQueries: true });

	assert.equal(await dropping.roamMarkupScrubber('', '', 'before {{query: {and: [[A]]}}} after'), 'before  after');
	assert.equal(await dropping.roamMarkupScrubber('', '', '{{query: {between: [[a]] [[b]]}}}'), '');
});

test('"keep attributes in the note" leaves them in the outline, double colon and all', async () => {
	const page = {
		title: 'Sapiens', uid: 'sapiens',
		children: [{ string: 'Author:: Ada Lovelace' }, { string: 'a block' }],
	} as RoamPage;

	const keeping = optioned({ keepAttributesInOutline: true });
	assert.equal(await keeping.jsonToMarkdown('graph', 'graph/Attachments', page),
		'- Author:: Ada Lovelace\n- a block');
	assert.deepEqual([...keeping.attributeNames], [], 'nothing lifted means no column for the Base');

	assert.equal(await optioned({}).jsonToMarkdown('graph', 'graph/Attachments', page),
		'---\nAuthor: Ada Lovelace\n---\n- a block');
});

function graphConverter(overrides: Record<string, unknown> = {}) {
	return new RoamGraphConverter({
		graphFolder: 'g',
		userDNPFormat: DAILY_NOTE_FORMAT,
		...overrides,
	});
}

test('two titles that sanitise to one name are still two notes', async () => {
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
	const table = (uid: string) => ({
		string: '{{[[table]]}}', uid,
		children: [{ string: 'Cell', uid: `${uid}-cell` }],
	});

	const pages = [
		{
			title: 'Source', uid: 'p1', children: [
				table('top'),
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

async function headed(string: string, heading: number): Promise<string> {
	const page = { title: 'P', uid: 'p', children: [{ string, heading }] } as unknown as RoamPage;

	return scrubber().jsonToMarkdown('g', 'g/A', page);
}

test('bold wrapped round the whole of a heading is dropped', async () => {
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

test('a bracketed tag becomes the link it always named', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '#[[mental health]]'), '[[mental health]]');
	assert.equal(await scrubber().roamMarkupScrubber('', '', 'about #[[Audio Player]] today'), 'about [[Audio Player]] today');
});

test('and a bare tag is left as the tag Obsidian understands', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', 'filed under #marketing'), 'filed under #marketing');
});

test('"convert tags to links" reads a bare tag as the reference Roam means', async () => {
	const linking = optioned({ tagsAsLinks: true });

	assert.equal(await linking.roamMarkupScrubber('', '', 'filed under #marketing'), 'filed under [[marketing]]');
	assert.equal(await linking.roamMarkupScrubber('', '', '#one #two'), '[[one]] [[two]]');
	assert.equal(await linking.roamMarkupScrubber('', '', 'in #2021'), 'in #2021');
	assert.equal(await linking.roamMarkupScrubber('', '', '#[[mental health]]'), '[[mental health]]');
});

test('removing a reference that leads nowhere keeps the words it was written on', async () => {
	const dropping = optioned({ dropUnresolvedReferences: true });

	assert.equal(
		await dropping.roamMarkupScrubber('', '', '[🚧](((dmQooXFj9)))[🚧](((dmQooXFj9)))'),
		'🚧🚧');
	assert.equal(await dropping.roamMarkupScrubber('', '', 'see ((dmQooXFj9))'), 'see ');
});

test('a closing fence glued to the code is given its own line', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '```js\none();\ntwo();```'),
		'```js\none();\ntwo();\n```');
});

test('and one that already has a line to itself is left alone', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '```js\none();\n```'),
		'```js\none();\n```');
});

test('text after a fenced block is not swallowed by it', async () => {
	const page = {
		title: 'P', uid: 'p',
		children: [{ string: '```js\none();```' }, { string: 'a paragraph after the code' }],
	} as unknown as RoamPage;

	const written = await scrubber().jsonToMarkdown('g', 'g/A', page);

	assert.equal(written, '- ```js\n  one();\n  ```\n- a paragraph after the code');
});

test('a blank line inside a fence is indented with the code around it', async () => {
	const page = {
		title: 'P', uid: 'p',
		children: [{ string: 'Code', children: [{ string: '```js\none();\n\ntwo();```' }] }],
	} as unknown as RoamPage;

	assert.equal(await scrubber().jsonToMarkdown('g', 'g/A', page), [
		'- Code',
		'    - ```js',
		'      one();',
		'      ',
		'      two();',
		'      ```',
	].join('\n'));
});

test('and a blank line outside one is left bare, not filled with spaces', async () => {
	const page = {
		title: 'P', uid: 'p',
		children: [{ string: 'Code', children: [{ string: 'one line\n\nanother line' }] }],
	} as unknown as RoamPage;

	assert.equal(await scrubber().jsonToMarkdown('g', 'g/A', page), [
		'- Code',
		'    - one line',
		'',
		'      another line',
	].join('\n'));
});

/**
 * Roam styles a block by referring to a page whose name begins with a dot.
 * The class is Roam's own and means nothing in a vault.
 */
test('a style reference is removed, and the content beside it kept', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', 'Content #.rm-hide'), 'Content');
	assert.equal(await scrubber().roamMarkupScrubber('', '', '**Components** #.rm-grid'), '**Components**');
	assert.equal(await scrubber().roamMarkupScrubber('', '', 'before [[.bp3-card]] after'), 'before after');
});

test('a block that was nothing but a style reference leaves no bullet', async () => {
	const page = {
		title: 'P', uid: 'p',
		children: [{ string: '[[.--]]' }, { string: 'real content' }],
	} as unknown as RoamPage;

	assert.equal(await scrubber().jsonToMarkdown('g', 'g/A', page), '- real content');
});

test('and what was under it takes its place rather than staying a level deeper', async () => {
	const page = {
		title: 'P', uid: 'p',
		children: [{ string: '[[.--]]', children: [{ string: 'the content' }] }],
	} as unknown as RoamPage;

	assert.equal(await scrubber().jsonToMarkdown('g', 'g/A', page), '- the content');
});

test('a block Roam left empty still keeps its place', async () => {
	// It said nothing to begin with, which is not the same as having said
	// something that was all markup.
	const page = {
		title: 'P', uid: 'p',
		children: [{ string: '' }, { string: 'after' }],
	} as unknown as RoamPage;

	assert.equal(await scrubber().jsonToMarkdown('g', 'g/A', page), '\n- after');
});

/**
 * A page Roam titled with a slash makes a folder here, so a link to one is
 * written out in full. The rule has to match one link and not a span.
 */
test('a namespaced link beside another link converts only itself', async () => {
	// Greedy, this reached from the first `[[` to the last `]]`, swallowed
	// every link between them and wrote the lot back twice.
	assert.equal(await scrubber().roamMarkupScrubber('g', 'g', '[[a]] and [[b/c]]'),
		'[[a]] and [[g/b/c|b/c]]');
});

test('and a DONE marker beside one is still a checkbox', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('g', 'g', '{{[[DONE]]}} see [[roam/render]]'),
		'[x] see [[g/roam/render|roam/render]]');
	assert.equal(await scrubber().roamMarkupScrubber('g', 'g', '{{[[TODO]]}} see [[roam/render]]'),
		'[ ] see [[g/roam/render|roam/render]]');
});

test('two namespaced links are each written out', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('g', 'g', '[[roam/render]] and [[roam/templates]]'),
		'[[g/roam/render|roam/render]] and [[g/roam/templates|roam/templates]]');
});

/**
 * A Roam component is a widget, and `{{...}}` around a name means nothing in a
 * vault. Markdown takes HTML, so the ones pointing at a URL become the element
 * they stood for.
 */
test('a player pointing somewhere else becomes the element it stood for', async () => {
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{[[video]]: https://www.loom.com/share/abc}}'),
		'<iframe src="https://www.loom.com/share/abc"></iframe>');
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{iframe: https://example.com/page}}'),
		'<iframe src="https://example.com/page"></iframe>');
});

test('a URL naming a media file gets an element that can play it', async () => {
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{[[video]]: https://example.com/clip.mp4}}'),
		'<video controls src="https://example.com/clip.mp4"></video>');
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{[[audio]]: https://example.com/talk.mp3}}'),
		'<audio controls src="https://example.com/talk.mp3"></audio>');
});

test('a YouTube video is left to Obsidian, which embeds it from the link', async () => {
	assert.equal(
		await scrubber().roamMarkupScrubber('', '', '{{[[video]]: https://www.youtube.com/watch?v=abc}}'),
		'![](https://www.youtube.com/watch?v=abc)');
});

test('a component nobody here reads is left as Roam wrote it', async () => {
	// Including the brackets round its name: rewriting those is only worth it
	// for the names something goes on to read.
	for (const text of ['{{[[video-timestamp]]: 00:07:07}}', '{{excalidraw}}', '{{[[mermaid]]}}']) {
		assert.equal(await scrubber().roamMarkupScrubber('', '', text), text);
	}
});

test('a component name is not a page reference', async () => {
	// It was rewritten like any other link, so {{[[query]]}} became
	// {{[[query 1]]}} wherever a page had taken the name first, and nothing
	// downstream recognised it as a query any more.
	const named = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		resolvePageName: title => title === 'query' ? 'query 1' : title,
	});

	assert.equal(await named.roamMarkupScrubber('g', 'g', '{{[[query]]: {and: [[A]]}}}'),
		'```query\nblock:([[A]])\n```');
});

test('a component nobody reads keeps its brackets and its name', async () => {
	// Passed over when links are rewritten, so a page holding the same name
	// cannot renumber it: {{[[kanban]]}} was arriving as {{[[kanban 1]]}}.
	const named = new RoamPageConverter({
		userDNPFormat: DAILY_NOTE_FORMAT,
		resolvePageName: title => `${title} 1`,
	});

	assert.equal(await named.roamMarkupScrubber('g', 'g', '{{[[kanban]]}}'), '{{[[kanban]]}}');
	assert.equal(await named.roamMarkupScrubber('g', 'g', '{{[[kroki]]: a}}'), '{{[[kroki]]: a}}');
	// A page named with a slash is not expanded there either.
	assert.equal(await named.roamMarkupScrubber('g', 'g', '{{[[some/widget]]}}'), '{{[[some/widget]]}}');
	// An argument beside the name is still a page reference.
	assert.equal(await named.roamMarkupScrubber('g', 'g', '{{[[embed]]: [[A Page]]}}'), '![[A Page 1]]');
});
