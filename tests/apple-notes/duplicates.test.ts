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

import { Root } from 'protobufjs';

import { provideNodeModules } from '../../src/filesystem';
import { DuplicateHandling } from '../../src/format-importer';
import { AppleNotesImporter } from '../../src/formats/apple-notes';
import { descriptor } from '../../src/formats/apple-notes/descriptor';
import { MemoryVault } from '../shims/vault';
import { buildStore, NoteSpec } from './store';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath, zlib: nodeZlib });

/** Reports everything, so a test can see what the import decided. */
function reporter() {
	const skipped: string[] = [];
	return {
		skipped,
		ctx: {
			isCancelled: () => false,
			status: () => {},
			reportProgress: () => {},
			reportNoteSuccess: () => {},
			reportAttachmentSuccess: () => {},
			reportSkipped: (name: string) => skipped.push(name),
			reportFailed: (name: string, reason?: unknown) => assert.fail(`${name}: ${String(reason)}`),
		},
	};
}

/**
 * An importer pointed at a built database, ready for resolveNote.
 *
 * import() picks a folder through a dialog and opens the real Notes database,
 * so what it sets up is set up here instead.
 */
async function importing(notes: NoteSpec[], mode: DuplicateHandling) {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), { notes });

	const vault = new MemoryVault();
	const { ctx, skipped } = reporter();
	const subject = new AppleNotesImporter(
		{ vault, loadLocalStorage: () => null, saveLocalStorage: () => {} } as never,
		{ contentEl: null } as never
	);

	subject.ctx = ctx as never;
	subject.vault = vault as never;
	subject.rootFolder = vault.root;
	subject.protobufRoot = Root.fromJSON(descriptor);
	subject.duplicateHandling = mode;
	subject.keys = Object.fromEntries(
		(await store.database.all`SELECT z_ent, z_name FROM z_primarykey`).map(k => [k.Z_NAME, k.Z_ENT])
	);
	subject.database = store.database;

	return {
		vault, skipped, notePks: store.notePks,
		resolve: (pk: number) => subject.resolveNote(pk),
		close: () => {
			store.close();
			nodeFs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

const SAME_TITLE: NoteSpec[] = [
	{ title: 'Groceries', runs: [{ text: 'Groceries' }, { text: 'Milk' }] },
	{ title: 'Groceries', runs: [{ text: 'Groceries' }, { text: 'Bread' }] },
];

for (const mode of [DuplicateHandling.ImportUpdated, DuplicateHandling.Skip, DuplicateHandling.CreateCopy]) {
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
	const updating = await importing([SAME_TITLE[0]], DuplicateHandling.ImportUpdated);
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
		{ title: 'Groceries', runs: [{ text: 'Groceries' }, { text: 'Milk' }], identifier: null },
		{ title: 'Groceries', runs: [{ text: 'Groceries' }, { text: 'Bread' }], identifier: null },
	], DuplicateHandling.ImportUpdated);

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
