import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DuplicateHandling, FormatImporter } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { MemoryVault, memoryApp } from '../shims/vault';

class WritingImporter extends FormatImporter {
	init(): void {}
	async import(_ctx: ImportContext): Promise<void> {}
}

function importer(duplicateHandling: DuplicateHandling) {
	const vault = new MemoryVault();
	const subject = new WritingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = duplicateHandling;
	subject.indexImportedNotes();

	return { vault, subject, ctx: new ImportContext() };
}

test('a note that is not there yet is written, whatever the mode', async () => {
	for (const mode of [DuplicateHandling.CreateCopy, DuplicateHandling.Skip, DuplicateHandling.Update]) {
		const { vault, subject, ctx } = importer(mode);

		const { file, written } = await subject.writeNote(ctx, vault.root, 'Note', 'first');

		assert.equal(file.path, 'Note.md', mode);
		assert.equal(written, true, mode);
		assert.deepEqual(ctx.skipped, [], mode);
	}
});

test('"Create a copy" leaves the note there and writes its own', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.CreateCopy);
	await vault.create('Note.md', 'already here');

	const { file, written } = await subject.writeNote(ctx, vault.root, 'Note', 'second');

	assert.equal(file.path, 'Note 1.md');
	assert.equal(written, true);
	assert.equal(vault.contents.get('Note.md'), 'already here');
});

test('"Skip" leaves the note alone and says which note it was', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Skip);
	await vault.create('Note.md', 'already here');

	const { file, written } = await subject.writeNote(ctx, vault.root, 'Note', 'second');

	assert.equal(file.path, 'Note.md');
	assert.equal(written, false);
	assert.equal(vault.contents.get('Note.md'), 'already here');
	assert.deepEqual(ctx.skipped, ['Note']);
});

test('"Update" writes over a note the source has changed since', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);
	await vault.create('Note.md', 'the last import', { mtime: 1_000 });

	const { file, written } = await subject.writeNote(ctx, vault.root, 'Note', 'changed', { mtime: 2_000 });

	assert.equal(file.path, 'Note.md');
	assert.equal(written, true);
	assert.equal(vault.contents.get('Note.md'), 'changed');
});

test('"Update" leaves a note the source has not touched since', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);
	await vault.create('Note.md', 'the last import', { mtime: 2_000 });

	const { written } = await subject.writeNote(ctx, vault.root, 'Note', 'converted again', { mtime: 2_000 });

	assert.equal(written, false);
	assert.equal(vault.contents.get('Note.md'), 'the last import');
	assert.deepEqual(ctx.skipped, ['Note']);
});

test('"Update" does not write over work done in Obsidian since the import', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);
	await vault.create('Note.md', 'edited by hand', { mtime: 5_000 });

	const { written } = await subject.writeNote(ctx, vault.root, 'Note', 'from the source', { mtime: 2_000 });

	assert.equal(written, false);
	assert.equal(vault.contents.get('Note.md'), 'edited by hand');
});

// Once per import, because a name written twice in one import is two source
// notes sharing a title rather than one note being reconsidered.
test('with no time to go on, "Update" compares the text instead', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);
	await vault.create('Note.md', 'same text');

	const unchanged = await subject.writeNote(ctx, vault.root, 'Note', 'same text');
	assert.equal(unchanged.written, false);

	subject.indexImportedNotes();
	const changed = await subject.writeNote(ctx, vault.root, 'Note', 'different text');
	assert.equal(changed.written, true);
	assert.equal(vault.contents.get('Note.md'), 'different text');
});

test('the source id is recorded only when the importer has one and it was asked for', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.CreateCopy);
	subject.idProperty = 'notion-id';
	subject.saveSourceId = false;

	const bare = await subject.writeNote(ctx, vault.root, 'A', 'body\n', { sourceId: 'abc-123' });
	assert.equal(vault.contents.get(bare.file.path), 'body\n');

	subject.saveSourceId = true;
	const kept = await subject.writeNote(ctx, vault.root, 'B', 'body\n', { sourceId: 'abc-123' });
	assert.equal(vault.contents.get(kept.file.path), '---\nnotion-id: abc-123\n---\nbody\n');

	subject.idProperty = null;
	const none = await subject.writeNote(ctx, vault.root, 'C', 'body\n', { sourceId: 'abc-123' });
	assert.equal(vault.contents.get(none.file.path), 'body\n');
});

test('the id joins the properties the note already had rather than replacing them', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.CreateCopy);
	subject.idProperty = 'notion-id';
	subject.saveSourceId = true;

	const { file } = await subject.writeNote(
		ctx, vault.root, 'Note',
		'---\ntitle: Roadmap\ntags:\n  - work\n---\nbody\n',
		{ sourceId: 'abc-123' }
	);

	const written = String(vault.contents.get(file.path));
	assert.match(written, /^---\nnotion-id: abc-123\n/, 'the id reads first, before the source\'s own properties');
	assert.match(written, /title: Roadmap/);
	assert.match(written, /- work/);
	assert.match(written, /\n---\nbody\n$/);
});

test('a selected Markdown template renders the whole imported note', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.CreateCopy);
	await vault.createFolder('Templates');
	await vault.create('Templates/Import.md', [
		'# {{title|upper}}',
		'',
		'Created: {{created}}',
		'Source: {{source.name}}',
		'',
		'{{body}}',
	].join('\n'));
	subject.templatePath = 'Templates/Import.md';

	const { file } = await subject.writeNote(
		ctx,
		vault.root,
		'Template note',
		'---\ncreated: 2026-08-20\n---\nOriginal body',
		{ templateVariables: { name: 'Export' } },
	);

	assert.equal(vault.contents.get(file.path), [
		'# TEMPLATE NOTE',
		'',
		'Created: 2026-08-20',
		'Source: Export',
		'',
		'Original body',
	].join('\n'));
});

test('source identity is added after rendering the template', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.CreateCopy);
	await vault.create('Template.md', '# {{title}}\n\n{{body}}');
	subject.templatePath = 'Template.md';
	subject.idProperty = 'source-id';
	subject.saveSourceId = true;

	const { file } = await subject.writeNote(ctx, vault.root, 'Note', 'Body', { sourceId: 'abc-123' });

	assert.equal(vault.contents.get(file.path), '---\nsource-id: abc-123\n---\n# Note\n\nBody');
});

test('common variables win collisions while the source value remains namespaced', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.CreateCopy);
	await vault.create('Template.md', '{{body}} / {{source.content}}');
	subject.templatePath = 'Template.md';

	const { file } = await subject.writeNote(
		ctx,
		vault.root,
		'Note',
		'---\ncontent: source property\n---\nGenerated body',
	);

	assert.equal(vault.contents.get(file.path), 'Generated body / source property');
});

test('the selected template must be a Markdown file in the vault', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.CreateCopy);
	await vault.create('Template.txt', '{{content}}');
	subject.templatePath = 'Template.txt';

	await assert.rejects(
		subject.writeNote(ctx, vault.root, 'Note', 'Body'),
		/Template must be a Markdown file in this vault: Template\.txt/,
	);
});

test('two source notes of one name stay two notes', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);

	const first = await subject.writeNote(ctx, vault.root, 'Note', 'one');
	const second = await subject.writeNote(ctx, vault.root, 'Note', 'two');

	assert.equal(first.file.path, 'Note.md');
	assert.equal(second.file.path, 'Note 1.md');
	assert.equal(second.written, true);
});

test('two source notes whose names differ only in case stay two notes', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);

	const first = await subject.writeNote(ctx, vault.root, 'Note', 'one');
	const second = await subject.writeNote(ctx, vault.root, 'note', 'two');

	assert.equal(first.file.path, 'Note.md');
	assert.equal(second.file.path, 'note 1.md');
	assert.equal(vault.contents.get('Note.md'), 'one', 'the first note is untouched');
	assert.deepEqual(ctx.skipped, []);
});

test('and Skip does not drop the second of them either', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Skip);

	await subject.writeNote(ctx, vault.root, 'Note', 'one');
	const second = await subject.writeNote(ctx, vault.root, 'note', 'two');

	assert.equal(second.written, true);
	assert.equal(vault.contents.get('note 1.md'), 'two');
	assert.deepEqual(ctx.skipped, []);
});
