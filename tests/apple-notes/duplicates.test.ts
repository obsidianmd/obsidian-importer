/**
 * Two Apple Notes with one title, imported.
 *
 * Apple Notes lets two notes share a title. The importer used to decide
 * whether an incoming note was one it had already written by looking for a
 * file of that name, which inside a single import is always the wrong answer:
 * the second note found the first and, under the modes that update, replaced
 * it. That was the default, so it was the ordinary path (#554).
 *
 * The database here is the same built fixture the conversion tests use, which
 * already gives each note its own zidentifier. The importer is driven straight
 * at resolveNote, since import() would ask for a folder through a dialog.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as nodeZlib from 'node:zlib';

import { provideNodeModules } from '../../src/filesystem';
import { DuplicateHandling } from '../../src/format-importer';
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

			// The note each file holds is its own, not the other's
			assert.match(String(run.vault.contents.get(first.path)), /Milk/);
			assert.match(String(run.vault.contents.get(second.path)), /Bread/);
		}
		finally {
			run.close();
		}
	});
}

test('the id a note came from is written only where it will be read', async () => {
	const updating = await importing([SAME_TITLE[0]], DuplicateHandling.Update);
	try {
		const file = await updating.resolve(updating.notePks[0]);
		assert.match(String(updating.vault.contents.get(file!.path)), /^---\napple-notes-id: NOTE-\d+\n---\n/);
	}
	finally {
		updating.close();
	}

	// A one-time import writes no property, which is every import by default
	const copying = await importing([SAME_TITLE[0]], DuplicateHandling.CreateCopy);
	try {
		const file = await copying.resolve(copying.notePks[0]);
		assert.doesNotMatch(String(copying.vault.contents.get(file!.path)), /apple-notes-id/);
	}
	finally {
		copying.close();
	}
});

test('two notes of one title stay two notes even with no id to tell them apart', async () => {
	// The id is what usually separates them. A note that carries none falls
	// back on the file name, and every name this run has written is a note of
	// its own rather than one an earlier import left.
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
