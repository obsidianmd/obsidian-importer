/**
 * The importer's half of a Markdown import, against the in-memory vault.
 *
 * What the conversion cannot answer is where a note lands. A folder is
 * imported as the folder it was, files that are not notes included, so that a
 * relative link written between them still points at what it did on disk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TFolder } from 'obsidian';

import { PickedFile, PickedFolder } from '../../src/filesystem';
import { DuplicateHandling } from '../../src/format-importer';
import { MarkdownImporter } from '../../src/formats/markdown';
import { ImportContext } from '../../src/import-context';
import { SourceFile, SourceFolder } from '../shims/picked';
import { MemoryVault, memoryApp } from '../shims/vault';

function importer(): { vault: MemoryVault, subject: MarkdownImporter } {
	const vault = new MemoryVault();
	const subject = new MarkdownImporter(memoryApp(vault), { sourceEl: null, outputEl: null, optionsEl: null } as never);

	return { vault, subject };
}

async function importing(subject: MarkdownImporter, chosen: (PickedFile | PickedFolder)[]): Promise<ImportContext> {
	await subject.ready;
	subject.chosen = chosen;
	subject.outputLocation = 'Import';

	const ctx = new ImportContext();
	subject.indexImportedNotes();
	await subject.import(ctx);

	return ctx;
}

function notes(): SourceFolder {
	return new SourceFolder('Notes', [
		new SourceFile('Index.md', '# Index\n\n[A day](Journal/Day.md)\n\n![](cover.png)\n'),
		new SourceFile('cover.png', 'pretend this is a png'),
		new SourceFolder('Journal', [new SourceFile('Day.markdown', 'A day.\n')]),
	]);
}

test('a folder is imported as the folder it was', async () => {
	const { vault, subject } = importer();

	await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), [
		'Import/Notes/Index.md',
		'Import/Notes/cover.png',
		'Import/Notes/Journal/Day.md',
	]);
});

test('a note keeps the links it was written with', async () => {
	const { vault, subject } = importer();

	await importing(subject, [notes()]);

	assert.equal(vault.contents.get('Import/Notes/Index.md'), '# Index\n\n[A day](Journal/Day.md)\n\n![](cover.png)\n');
});

test('a folder holding nothing is still made', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('Notes', [
		new SourceFile('One.md', 'one'),
		new SourceFolder('Later', []),
	])]);

	assert.ok(vault.getAbstractFileByPath('Import/Notes/Later') instanceof TFolder);
	assert.deepEqual(vault.paths(), ['Import/Notes/One.md']);
});

test('files chosen on their own land in the output folder', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFile('One.md', 'one'), new SourceFile('Two.markdown', 'two')]);

	assert.deepEqual(vault.paths(), ['Import/One.md', 'Import/Two.md']);
});

test('importing the same folder again lands on the notes it wrote', async () => {
	const { vault, subject } = importer();

	const first = await importing(subject, [notes()]);
	const second = await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), [
		'Import/Notes/Index.md',
		'Import/Notes/cover.png',
		'Import/Notes/Journal/Day.md',
	]);
	assert.equal(first.notes, 2);
	assert.equal(second.notes, 0);
	assert.deepEqual(second.skipped, ['Index', 'Day']);
});

test('asking for a copy numbers the folder rather than the notes inside it', async () => {
	const { vault, subject } = importer();

	await subject.ready;
	subject.duplicateHandling = DuplicateHandling.CreateCopy;

	await importing(subject, [notes()]);
	await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), [
		'Import/Notes/Index.md',
		'Import/Notes/cover.png',
		'Import/Notes/Journal/Day.md',
		'Import/Notes 1/Index.md',
		'Import/Notes 1/cover.png',
		'Import/Notes 1/Journal/Day.md',
	]);
});
