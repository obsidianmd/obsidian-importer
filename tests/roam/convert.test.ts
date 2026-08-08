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
import { RoamPage } from '../../src/formats/roam/models/roam-json';
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

	return converter.jsonToMarkdown('graph', 'graph/Attachments', page, '', false, '', 0, 0);
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

	assert.equal(await converter.jsonToMarkdown('graph', 'graph/Attachments', page, '', false, '', 0, 0), [
		'- Code',
		'    - ```js',
		'      one();',
		'      two();```',
	].join('\n'));
});
