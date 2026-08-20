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
import { indexedApp, MemoryVault } from '../shims/vault';

function importer(): { vault: MemoryVault, subject: MarkdownImporter } {
	const vault = new MemoryVault();
	const subject = new MarkdownImporter(indexedApp(vault) as never, { sourceEl: null, outputEl: null, optionsEl: null } as never);

	return { vault, subject };
}

async function importing(subject: MarkdownImporter, chosen: (PickedFile | PickedFolder)[]): Promise<ImportContext> {
	await subject.ready;
	subject.chosen = chosen;
	subject.outputLocation = 'Import';

	const ctx = new ImportContext();
	subject.indexImportedNotes();
	await subject.import(ctx);
	await subject.finalizeMarkdownOutput(ctx);

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

test('a link is rewritten in this vault\'s form, still reaching the note it named', async () => {
	const { vault, subject } = importer();

	await importing(subject, [notes()]);

	assert.equal(vault.contents.get('Import/Notes/Index.md'), '# Index\n\n[[Day|A day]]\n\n![](cover.png)\n');
});

test('a link is left as it was written where the source formatting is kept', async () => {
	const { vault, subject } = importer();

	await subject.ready;
	subject.standardizeFormatting = false;
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

const LISTS = '# Shopping\n\n* Bread\n    * Sourdough\n* Milk\n';

test('a list is written the way this vault writes one', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFile('Shopping.md', LISTS)]);

	assert.equal(vault.contents.get('Import/Shopping.md'), '# Shopping\n\n- Bread\n    - Sourdough\n- Milk\n');
});

test('source list formatting is preserved when standardization is turned off', async () => {
	const { vault, subject } = importer();

	await subject.ready;
	subject.standardizeFormatting = false;
	const first = await importing(subject, [new SourceFile('Shopping.md', LISTS)]);
	await subject.finalizeMarkdownOutput();
	const second = await importing(subject, [new SourceFile('Shopping.md', LISTS)]);

	assert.equal(vault.contents.get('Import/Shopping.md'), LISTS);
	assert.equal(first.notes, 1);
	assert.equal(second.notes, 0);
	assert.deepEqual(second.skipped, ['Shopping']);
});

interface PickerInternals {
	picker: { nodes: { path: string, selected: boolean, children?: unknown[] }[] };
	loadFolders(): Promise<void>;
}

test('a folder left unticked is not imported, nor anything inside it', async () => {
	const { vault, subject } = importer();
	const internals = subject as unknown as PickerInternals;

	await subject.ready;
	subject.chosen = [notes()];
	internals.picker = {
		nodes: [{
			path: 'Notes',
			selected: true,
			children: [{ path: 'Notes/Journal', selected: false, children: [] }],
		}],
	} as PickerInternals['picker'];

	await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), ['Import/Notes/Index.md', 'Import/Notes/cover.png']);
});

test('a folder ticked under one that is not brings only itself', async () => {
	const { vault, subject } = importer();
	const internals = subject as unknown as PickerInternals;

	await subject.ready;
	internals.picker = {
		nodes: [{
			path: 'Notes',
			selected: false,
			children: [{ path: 'Notes/Journal', selected: true, children: [] }],
		}],
	} as PickerInternals['picker'];

	await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), ['Import/Notes/Journal/Day.md']);
});

test('unticking the folder that was chosen leaves the import empty', async () => {
	const { vault, subject } = importer();
	const internals = subject as unknown as PickerInternals;

	await subject.ready;
	internals.picker = { nodes: [{ path: 'Notes', selected: false, children: [] }] } as PickerInternals['picker'];

	await importing(subject, [notes()]);

	assert.deepEqual(vault.paths(), []);
});

test('what a vault keeps for itself is left behind', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('Notes', [
		new SourceFile('Index.md', 'one'),
		new SourceFile('.DS_Store', 'noise'),
		new SourceFolder('.obsidian', [new SourceFile('app.json', '{}')]),
		new SourceFolder('.git', [new SourceFile('HEAD', 'ref')]),
	])]);

	assert.deepEqual(vault.paths(), ['Import/Notes/Index.md']);
});

test('a hidden folder picked on purpose is the one thing that is imported', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('.obsidian', [new SourceFile('app.json', '{}')])]);

	// The vault cannot hold a folder whose name starts with a dot.
	assert.deepEqual(vault.paths(), ['Import/obsidian/app.json']);
});

test('a base and a canvas come across as they were written', async () => {
	const { vault, subject } = importer();

	await importing(subject, [new SourceFolder('Notes', [
		new SourceFile('Books.base', 'filters:\n  and: []\n'),
		new SourceFile('Map.canvas', '{"nodes":[]}'),
	])]);

	assert.deepEqual(vault.paths(), ['Import/Notes/Books.base', 'Import/Notes/Map.canvas']);
	const canvas = vault.contents.get('Import/Notes/Map.canvas') as ArrayBuffer;
	assert.equal(new TextDecoder().decode(canvas), '{"nodes":[]}');
});
