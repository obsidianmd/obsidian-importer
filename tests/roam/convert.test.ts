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
import { RoamBlock, RoamPage } from '../../src/formats/roam/models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from '../../src/formats/roam/utils';
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
			for (const page of pages) {
				// One converter per page: it carries the timestamps the
				// recursion accumulates.
				const converter = new RoamPageConverter({
					userDNPFormat: DAILY_NOTE_FORMAT,
					fileDateYAML: false,
					titleYAML: false,
					downloadAttachments: false,
				});

				const markdown = await converter.jsonToMarkdown(
					name, `${name}/Attachments`, page, '', false, '', 0, 0);

				// Named the way the importer names it, through the same
				// daily-note conversion and sanitiser.
				const title = convertDateString(sanitizeFileNameKeepPath(page.title), DAILY_NOTE_FORMAT).trim();
				if (!title) continue;

				const file = nodePath.join(produced, `${title}.md`);
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

test('unwraps a block embed to its reference', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '{{embed: ((abc123))}}'), '((abc123))');
});

test('turns a Roam quote into a blockquote', async () => {
	// The excerpt has no page using [[>]], so this is the only check on it
	assert.equal(await scrubber().roamMarkupScrubber('', '', '[[>]] quoted'), '> quoted');
});

test('turns a page alias into an Obsidian alias', async () => {
	assert.equal(await scrubber().roamMarkupScrubber('', '', '[shown]([[Real Page]])'), '[[Real Page|shown]]');
});

/**
 * Tables are the one place the converter reads the tree rather than a block's
 * text, so the shapes Roam can produce are checked here by name. The recorded
 * pages cover the ordinary case.
 */

/** A row, as Roam stores it: each column is the previous column's first child. */
function row(cells: string[]): RoamBlock {
	const [first, ...rest] = cells;
	return rest.length > 0 ? { string: first, children: [row(rest)] } : { string: first };
}

/** One page holding one table marker, converted. */
async function convertTable(rows: string[][], marker: string = '{{[[table]]}}'): Promise<string> {
	const page: RoamPage = {
		title: 'Tables', uid: 'tables',
		children: [rows.length > 0 ? { string: marker, children: rows.map(row) } : { string: marker }],
	};

	return scrubber().jsonToMarkdown('Tables', 'Tables/Attachments', page, '', false, '', 0, 0);
}

test('converts a Roam table to a pipe table, first row as the header', async () => {
	assert.equal(
		await convertTable([['Name', 'Colour'], ['Apple', 'Red']]),
		'\n| Name | Colour |\n| --- | --- |\n| Apple | Red |\n');
});

test('converts the bare {{table}} spelling too', async () => {
	assert.equal(await convertTable([['One']], '{{table}}'), '\n| One |\n| --- |\n');
});

test('leaves an unbalanced table marker as an ordinary block', async () => {
	assert.equal(await convertTable([['One']], '{{[[table}}'), '  * {{[[table}}\n    * One');
});

test('pads a row Roam left short', async () => {
	assert.equal(
		await convertTable([['Name', 'Colour'], ['Apple']]),
		'\n| Name | Colour |\n| --- | --- |\n| Apple |  |\n');
});

test('escapes a pipe inside a cell', async () => {
	assert.equal(await convertTable([['a | b']]), '\n| a \\| b |\n| --- |\n');
});

test('keeps a multi-line cell on one row', async () => {
	assert.equal(await convertTable([['one\ntwo']]), '\n| one<br>two |\n| --- |\n');
});

test('a table marker with no rows leaves nothing behind', async () => {
	assert.equal(await convertTable([]), '');
});

test('converts the markup inside a cell', async () => {
	assert.equal(
		await convertTable([['{{[[TODO]]}} ^^done^^']]),
		'\n| [ ] ==done== |\n| --- |\n');
});
