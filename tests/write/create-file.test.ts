/**
 * What an importer does with a name the vault already holds.
 *
 * Every importer writes through FormatImporter.createFile now, so this is one
 * behaviour rather than nine. It has to match Obsidian's own, because that is
 * what it defers to in the app: a taken name gets " 1", then " 2", and the
 * comparison ignores case, so an import cannot land on a note that differs
 * from it only in spelling.
 *
 * That was measured against the running app before it was written down here -
 * createNewMarkdownFile and getAvailablePath were asked for the same names and
 * gave the same answers - and tests/shims/vault.ts reproduces it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FormatImporter } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { MemoryVault, memoryApp } from '../shims/vault';

/** An importer that imports nothing: only the writing is under test. */
class WritingImporter extends FormatImporter {
	init(): void {}
	async import(_ctx: ImportContext): Promise<void> {}
}

function importer(): { vault: MemoryVault, subject: WritingImporter } {
	const vault = new MemoryVault();
	const subject = new WritingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);

	return { vault, subject };
}

test('a free name is used as it is', async () => {
	const { vault, subject } = importer();

	const file = await subject.createFile(vault.root, 'Note.md', 'first');

	assert.equal(file.path, 'Note.md');
	assert.deepEqual(vault.paths(), ['Note.md']);
});

test('a taken name gets a number, and the note there is left alone', async () => {
	const { vault, subject } = importer();

	await subject.createFile(vault.root, 'Note.md', 'first');
	const second = await subject.createFile(vault.root, 'Note.md', 'second');
	const third = await subject.createFile(vault.root, 'Note.md', 'third');

	assert.equal(second.path, 'Note 1.md');
	assert.equal(third.path, 'Note 2.md');
	assert.equal(await vault.read(await subject.createFile(vault.root, 'Other.md', 'x')), 'x');
	assert.equal(vault.contents.get('Note.md'), 'first');
});

test('a name that differs only in case is a taken name', async () => {
	// On macOS and Windows these are one file. An exact comparison would hand
	// back "note.md" as free and the write would land on "Note.md".
	const { vault, subject } = importer();

	await subject.createFile(vault.root, 'Note.md', 'first');
	const second = await subject.createFile(vault.root, 'note.md', 'second');

	assert.equal(second.path, 'note 1.md');
	assert.equal(vault.contents.get('Note.md'), 'first');
});

test('an attachment is given a free name too', async () => {
	// The vault throws on a taken name rather than picking another, so without
	// this the second attachment fails the note it belongs to.
	const { vault, subject } = importer();
	const data = new TextEncoder().encode('bytes').buffer;

	const first = await subject.createBinaryFile(vault.root, 'photo.jpg', data);
	const second = await subject.createBinaryFile(vault.root, 'photo.jpg', data);

	assert.equal(first.path, 'photo.jpg');
	assert.equal(second.path, 'photo 1.jpg');
});

test('a note keeps the extension it was given, and only that one', async () => {
	// The title reaches saveAsMarkdownFile both with and without ".md", and a
	// dotted title is a title rather than a name carrying an extension.
	const { vault, subject } = importer();

	assert.equal((await subject.saveAsMarkdownFile(vault.root, 'Plain', '')).path, 'Plain.md');
	assert.equal((await subject.saveAsMarkdownFile(vault.root, 'Carried.md', '')).path, 'Carried.md');
	assert.equal((await subject.saveAsMarkdownFile(vault.root, 'Dotted.name.here', '')).path, 'Dotted.name.here.md');
});

test('a title a file name cannot hold is sanitized before the name is picked', async () => {
	const { vault, subject } = importer();

	const file = await subject.saveAsMarkdownFile(vault.root, 'Q1/Q2 plan.', '');

	assert.equal(file.path, 'Q1-Q2 plan.md');
});
