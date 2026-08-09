/**
 * What an import does with a note the vault already holds.
 *
 * Every importer writes through writeNote now, so this is one behaviour rather
 * than fourteen. Five importers had their own version of it and nine had none
 * at all, which is what #142 was about: run an import twice and the second run
 * wrote "Note 1.md" beside everything the first one had already brought in.
 *
 * The interesting case is the third one. Where the source says when a note last
 * changed, the previous import stamped that time on the file it wrote, so the
 * file's own mtime is what the source said last time - which is what separates
 * "changed at the source" from "edited here since". Where it does not, all
 * there is to go on is the text.
 */
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

	// The note still comes back: a link to it has to resolve to something.
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
	// The point of the mtime comparison: a second run over 10,000 notes is a
	// stat check each, not a convert and a rewrite each.
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);
	await vault.create('Note.md', 'the last import', { mtime: 2_000 });

	const { written } = await subject.writeNote(ctx, vault.root, 'Note', 'converted again', { mtime: 2_000 });

	assert.equal(written, false);
	assert.equal(vault.contents.get('Note.md'), 'the last import');
	assert.deepEqual(ctx.skipped, ['Note']);
});

test('"Update" does not write over work done in Obsidian since the import', async () => {
	// The file is newer than the source says the note is, so the note was
	// edited here. Overwriting it would throw that away silently.
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);
	await vault.create('Note.md', 'edited by hand', { mtime: 5_000 });

	const { written } = await subject.writeNote(ctx, vault.root, 'Note', 'from the source', { mtime: 2_000 });

	assert.equal(written, false);
	assert.equal(vault.contents.get('Note.md'), 'edited by hand');
});

test('with no time to go on, "Update" compares the text instead', async () => {
	// Roam, CSV, HTML and Textbundle carry no modification time. Identical
	// output is still recognised as nothing to do; an edit here is not, which
	// is the cost of the source not saying when it last changed.
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);
	await vault.create('Note.md', 'same text');

	const unchanged = await subject.writeNote(ctx, vault.root, 'Note', 'same text');
	assert.equal(unchanged.written, false);

	const changed = await subject.writeNote(ctx, vault.root, 'Note', 'different text');
	assert.equal(changed.written, true);
	assert.equal(vault.contents.get('Note.md'), 'different text');
});

/**
 * The id is written in one place, so an importer declares idProperty and hands
 * writeNote a sourceId rather than assembling frontmatter of its own. Five of
 * them did, and disagreed about when to write it.
 */
test('the source id is recorded only when the importer has one and it was asked for', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.CreateCopy);
	subject.idProperty = 'notion-id';

	// Off by default: a one-time import leaves nothing behind.
	const bare = await subject.writeNote(ctx, vault.root, 'A', 'body\n', { sourceId: 'abc-123' });
	assert.equal(vault.contents.get(bare.file.path), 'body\n');

	subject.saveSourceId = true;
	const kept = await subject.writeNote(ctx, vault.root, 'B', 'body\n', { sourceId: 'abc-123' });
	assert.equal(vault.contents.get(kept.file.path), '---\nnotion-id: abc-123\n---\nbody\n');

	// Nothing to record for an importer whose source has no id.
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

test('two source notes of one name stay two notes', async () => {
	// Not a duplicate of anything: the first one is a note this run just wrote.
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);

	const first = await subject.writeNote(ctx, vault.root, 'Note', 'one');
	const second = await subject.writeNote(ctx, vault.root, 'Note', 'two');

	assert.equal(first.file.path, 'Note.md');
	assert.equal(second.file.path, 'Note 1.md');
	assert.equal(second.written, true);
});
