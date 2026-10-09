/**
 * The Supernotes conversion, outside Obsidian.
 *
 * Each export is converted twice - every card as its own note, and children
 * folded into their top-level card - and recorded under expected/<fixture>/
 * separate/ and merged/, as the tree of notes the importer would write.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { SupernotesConverter, demoteHeadings, headingText } from '../../src/formats/supernotes/convert';
import { parseSupernotesExport, supernotesTime } from '../../src/formats/supernotes/models';
import { normalizeListProperties } from '../../src/list-properties';
import { expectedFor, expectTree, fixtures } from '../helpers';

const FIXTURES = __dirname;

const exports = fixtures(FIXTURES, '.json');

/** Every top-level card, which merges the whole export into as few notes as it can. */
function topLevel(converter: SupernotesConverter): Set<string> {
	return new Set(converter.parentCards().map(parent => parent.id));
}

function readCards(path: string) {
	const parsed = parseSupernotesExport(JSON.parse(nodeFs.readFileSync(path, 'utf8')));
	assert.ok(parsed, 'the fixture should parse as a Supernotes export');
	return parsed;
}

async function convertTo(dir: string, converter: SupernotesConverter): Promise<number> {
	let written = 0;
	for (const note of converter.planned) {
		const file = nodePath.join(dir, note.folder, `${note.name}.md`);
		nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
		// The importer normalizes list properties before writing; the recording should match the note that reaches the vault.
		nodeFs.writeFileSync(file, normalizeListProperties(await converter.render(note)));
		written++;
	}
	return written;
}

test('there are exports to convert', () => {
	assert.ok(exports.length > 0, 'expected at least one .json in tests/supernotes');
});

for (const fixture of exports) {
	for (const mergeChildren of [false, true]) {
		const mode = mergeChildren ? 'merged' : 'separate';

		test(`converts ${fixture.name} with children ${mode}`, async () => {
			const { cards } = readCards(fixture.path);
			const name = nodePath.basename(fixture.name, '.json');
			const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), `importer-supernotes-${mode}-`));

			try {
				const mergeInto = mergeChildren ? topLevel(new SupernotesConverter(cards)) : new Set<string>();
				const written = await convertTo(produced, new SupernotesConverter(cards, { mergeInto }));
				assert.ok(written > 0, 'the export should have produced notes');
				expectTree(produced, expectedFor(fixture, name, mode), `${fixture.name} (${mode})`);
			}
			finally {
				nodeFs.rmSync(produced, { recursive: true, force: true });
			}
		});
	}
}

test('a card missing its fields is dropped, and a file of nothing else is not an export', () => {
	const { cards, dropped } = readCards(nodePath.join(FIXTURES, 'cards.json'));
	assert.equal(dropped, 1);
	assert.ok(cards.every(card => card.data.id));

	assert.equal(parseSupernotesExport({ 'x': { membership: {} } }), null);
	assert.equal(parseSupernotesExport([]), null);
	assert.deepEqual(parseSupernotesExport({}), { cards: [], dropped: 0 });
});

test('timestamps without a zone are read as UTC, with the fraction trimmed', () => {
	assert.equal(supernotesTime('2026-01-02T03:04:05.123456'), Date.UTC(2026, 0, 2, 3, 4, 5, 123));
	assert.equal(supernotesTime('2026-01-02T03:04:05.123Z'), Date.UTC(2026, 0, 2, 3, 4, 5, 123));
	assert.equal(supernotesTime('nonsense'), undefined);
	assert.equal(supernotesTime(null), undefined);
});

test('a parent cycle is cut rather than looped over', () => {
	const { cards } = readCards(nodePath.join(FIXTURES, 'cards.json'));
	const converter = new SupernotesConverter(cards, { mergeInto: topLevel(new SupernotesConverter(cards)) });
	const names = converter.planned.map(note => note.name);
	assert.ok(names.includes('Loop A') || names.includes('Loop B'), `one of the loop cards should be a top-level note: ${names.join(', ')}`);
});

test('links to a folded card point at its heading, named after the card', () => {
	const { cards } = readCards(nodePath.join(FIXTURES, 'cards.json'));
	const converter = new SupernotesConverter(cards, { mergeInto: topLevel(new SupernotesConverter(cards)) });
	assert.equal(converter.linkTarget('aaaaaaaa-0000-4000-8000-000000000004'), 'Projects#Alpha notes');
	assert.equal(converter.linkTarget('aaaaaaaa-0000-4000-8000-00000000ffff'), 'Old card name-with slash');
	assert.equal(converter.linkTarget('aaaaaaaa-0000-4000-8000-00000000eeee'), null);
});

test('the parent cards form a tree of the cards that have children', () => {
	const { cards } = readCards(nodePath.join(FIXTURES, 'cards.json'));
	const parents = new SupernotesConverter(cards).parentCards();
	assert.deepEqual(parents.map(parent => [parent.name, parent.descendants, parent.children.map(child => [child.name, child.children.map(grandchild => grandchild.name)])]), [
		['Projects', 5, [['Alpha', ['Alpha notes']]]],
		['Reading', 2, []],
		['Loop B', 1, []],
	]);
});

test('merging one card folds only its own subtree', async () => {
	const { cards } = readCards(nodePath.join(FIXTURES, 'cards.json'));
	const alpha = 'aaaaaaaa-0000-4000-8000-000000000002';
	const converter = new SupernotesConverter(cards, { mergeInto: new Set([alpha]) });

	const names = converter.planned.map(note => `${note.folder}/${note.name}`);
	assert.ok(names.includes('Projects/Alpha'), names.join(', '));
	assert.ok(!names.some(name => name.endsWith('/Alpha notes') || name.endsWith('/Deep detail')), names.join(', '));
	assert.ok(names.includes('Projects/Beta'), 'a sibling that was not ticked stays separate');

	assert.equal(converter.linkTarget('aaaaaaaa-0000-4000-8000-000000000005'), 'Alpha#Deep detail');
	const alphaNote = converter.planned.find(note => note.card.data.id === alpha);
	assert.ok(alphaNote);
	assert.match(await converter.render(alphaNote), /^## Alpha notes$[\s\S]*^### Deep detail$/m);
});

test('heading text drops what a wikilink cannot carry', () => {
	assert.equal(headingText('A #tag | [bracket] ^caret'), 'A tag bracket caret');
	assert.equal(headingText('   '), 'Untitled');
});

test('demoting headings stops at six and leaves code alone', () => {
	assert.equal(demoteHeadings('# One\n\n```\n# code\n```\n\n##### Five', 2), '### One\n\n```\n# code\n```\n\n###### Five');
	assert.equal(demoteHeadings('# One', 0), '# One');
});
