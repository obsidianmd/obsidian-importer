import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as nodeZlib from 'node:zlib';

import { provideNodeModules } from '../../src/filesystem';
import { DuplicateHandling } from '../../src/format-importer';
import { parseFrontMatterBlock } from '../../src/util';
import { importing } from './importing';
import { NoteSpec } from './store';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath, zlib: nodeZlib });

const SAME_TITLE: NoteSpec[] = [
	{ title: 'Groceries', runs: [{ text: 'Groceries\n' }, { text: 'Milk' }] },
	{ title: 'Groceries', runs: [{ text: 'Groceries\n' }, { text: 'Bread' }] },
];

for (const mode of [DuplicateHandling.Update, DuplicateHandling.Skip, DuplicateHandling.CreateCopy]) {
	test(`two notes of one title stay two notes, importing with ${mode}`, async () => {
		const run = await importing(SAME_TITLE, mode);
		try {
			const first = await run.resolve(run.notePks[0]);
			const second = await run.resolve(run.notePks[1]);

			assert.ok(first && second, 'both notes should be imported');
			assert.notEqual(first.path, second.path, 'the second note took the first one\'s file');
			assert.deepEqual(run.vault.paths().sort(), ['Groceries 1.md', 'Groceries.md']);
			assert.deepEqual(run.skipped, [], 'neither note is a duplicate of the other');

			assert.match(String(run.vault.contents.get(first.path)), /Milk/);
			assert.match(String(run.vault.contents.get(second.path)), /Bread/);
		}
		finally {
			run.close();
		}
	});
}

test('the id a note came from is written when asked for, in any mode', async () => {
	for (const mode of [DuplicateHandling.Update, DuplicateHandling.Skip, DuplicateHandling.CreateCopy]) {
		const run = await importing([SAME_TITLE[0]], mode, { saveSourceId: true });
		try {
			const file = await run.resolve(run.notePks[0]);
			assert.match(String(run.vault.contents.get(file!.path)), /^---\napple-notes-id: NOTE-\d+\n---\n/, mode);
		}
		finally {
			run.close();
		}
	}
});

test('and not written unless it was asked for', async () => {
	for (const mode of [DuplicateHandling.Update, DuplicateHandling.CreateCopy]) {
		const run = await importing([SAME_TITLE[0]], mode);
		try {
			const file = await run.resolve(run.notePks[0]);
			assert.doesNotMatch(String(run.vault.contents.get(file!.path)), /apple-notes-id/, mode);
		}
		finally {
			run.close();
		}
	}
});

test('template list properties are normalized in the Apple Notes write path', async () => {
	const run = await importing([SAME_TITLE[0]], DuplicateHandling.CreateCopy, {
		inlineTemplate: '---\ntags: "#groceries #errands"\n---\n{{content}}',
	});
	try {
		const file = await run.resolve(run.notePks[0]);
		const content = String(run.vault.contents.get(file!.path));

		assert.deepEqual(parseFrontMatterBlock(content)?.frontMatter.tags, ['groceries', 'errands']);
		assert.match(content, /Milk/u);
	}
	finally {
		run.close();
	}
});

test('two notes of one title stay two notes even with no id to tell them apart', async () => {
	const run = await importing([
		{ title: 'Groceries', runs: [{ text: 'Groceries\n' }, { text: 'Milk' }], identifier: null },
		{ title: 'Groceries', runs: [{ text: 'Groceries\n' }, { text: 'Bread' }], identifier: null },
	], DuplicateHandling.Update);

	try {
		const first = await run.resolve(run.notePks[0]);
		const second = await run.resolve(run.notePks[1]);

		assert.notEqual(first!.path, second!.path);
		assert.deepEqual(run.vault.paths().sort(), ['Groceries 1.md', 'Groceries.md']);
		assert.match(String(run.vault.contents.get(first!.path)), /Milk/);
		assert.match(String(run.vault.contents.get(second!.path)), /Bread/);
	}
	finally {
		run.close();
	}
});
