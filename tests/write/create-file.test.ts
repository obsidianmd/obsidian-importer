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

function importer(configure?: (vault: MemoryVault) => void): { vault: MemoryVault, subject: WritingImporter } {
	const vault = new MemoryVault();
	// The attachment location is read off the vault when the importer is built,
	// so anything the vault has to say has to be said before that.
	configure?.(vault);
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

test('an attachment follows the vault subfolder setting relative to its note', async () => {
	const { subject } = importer(vault => vault.config.set('attachmentFolderPath', './media'));
	await subject.createFolders('Imported/Nested');

	assert.equal(
		await subject.getAvailablePathForAttachment('photo.jpg', [], 'Imported/Nested/Note.md'),
		'Imported/Nested/media/photo.jpg'
	);
});

test('the vault setting is only where the output step starts, not where it ends', async () => {
	// Picking a location for the import must not write it back to the app.
	const { vault, subject } = importer(vault => vault.config.set('attachmentFolderPath', './media'));
	await subject.createFolders('Imported/Nested');

	subject.attachmentLocation = { mode: 'folder', path: 'Files' };

	assert.equal(
		await subject.getAvailablePathForAttachment('photo.jpg', [], 'Imported/Nested/Note.md'),
		'Files/photo.jpg'
	);
	assert.equal(vault.config.get('attachmentFolderPath'), './media');
});

test('each attachment location puts the file where it says', async () => {
	const notePath = 'Imported/Nested/Note.md';
	const cases: [Parameters<typeof importer>[0], { mode: 'vault' | 'folder' | 'note' | 'subfolder', path: string }, string][] = [
		[undefined, { mode: 'vault', path: '' }, 'photo.jpg'],
		[undefined, { mode: 'folder', path: 'Attachments' }, 'Attachments/photo.jpg'],
		[undefined, { mode: 'note', path: '' }, 'Imported/Nested/photo.jpg'],
		[undefined, { mode: 'subfolder', path: 'media' }, 'Imported/Nested/media/photo.jpg'],
	];

	for (const [configure, location, expected] of cases) {
		const { subject } = importer(configure);
		await subject.createFolders('Imported/Nested');
		subject.attachmentLocation = location;

		assert.equal(await subject.getAvailablePathForAttachment('photo.jpg', [], notePath), expected, location.mode);
	}
});

test('an attachment with nowhere to be relative to falls back to the output folder', async () => {
	// Some importers save an attachment before they know which note wants it.
	const { subject } = importer();
	subject.outputLocation = 'Imported';
	subject.attachmentLocation = { mode: 'subfolder', path: 'media' };

	assert.equal(
		await subject.getAvailablePathForAttachment('photo.jpg', []),
		'Imported/media/photo.jpg'
	);
});

test('Markdown finalization reports failures, restores status, and clears its run', async () => {
	const vault = new MemoryVault();
	const app = memoryApp(vault) as unknown as {
		metadataCache?: { computeMetadataAsync: () => Promise<never> };
	};
	app.metadataCache = {
		computeMetadataAsync: async () => { throw new Error('parser failed'); },
	};
	const subject = new WritingImporter(app as never, { sourceEl: null, optionsEl: null } as never);
	await subject.createFile(vault.root, 'Note.md', 'body');
	const ctx = new ImportContext();
	ctx.status('Import complete');

	await subject.finalizeMarkdownOutput(ctx);

	assert.deepEqual(ctx.failed, ['Note.md']);
	assert.equal(ctx.statusMessage, 'Import complete');

	// The failed file belonged to the completed run and is not retried forever.
	await subject.finalizeMarkdownOutput(ctx);
	assert.deepEqual(ctx.failed, ['Note.md']);
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

/** The pass is checked in tests/markdown-output; this is that the write reaches it. */
test('markdown is written with the indent the vault uses', async () => {
	const { vault, subject } = importer();
	vault.config.set('useTab', true);

	const file = await subject.saveAsMarkdownFile(vault.root, 'Outline', '- one\n    - two');

	assert.equal(await vault.read(file), '- one\n\t- two');
});

test('a file that is not markdown is written as it was given', async () => {
	const { vault, subject } = importer();
	vault.config.set('useTab', true);

	const file = await subject.createFile(vault.root, 'View.base', 'views:\n    - type: table');

	assert.equal(await vault.read(file), 'views:\n    - type: table');
});
