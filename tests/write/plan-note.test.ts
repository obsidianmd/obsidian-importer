/**
 * Planning a note before its markdown exists.
 *
 * writeNote decides everything at the moment it writes, which is fine for an
 * importer holding a converted note already. An importer reading an API needs
 * the answer earlier: where the note goes settles where its attachments and
 * links point, and whether the source has moved on settles whether converting
 * it is worth doing at all.
 *
 * write-note.test.ts covers the rules themselves. This covers reaching them in
 * two steps rather than one.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DuplicateHandling, FormatImporter, NoteDisposition, PlannedNote } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { MemoryVault, memoryApp } from '../shims/vault';

class PlanningImporter extends FormatImporter {
	init(): void {}
	async import(_ctx: ImportContext): Promise<void> {}

	preflight(ctx: ImportContext, planned: PlannedNote, sourceMtime?: number): NoteDisposition {
		return this.preflightNote(ctx, planned, sourceMtime);
	}
}

function importer(duplicateHandling: DuplicateHandling, idProperty?: string) {
	const vault = new MemoryVault();
	const subject = new PlanningImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = duplicateHandling;
	subject.idProperty = idProperty ?? null;
	subject.indexImportedNotes();

	return { vault, subject, ctx: new ImportContext() };
}

test('a name nothing holds is planned as itself', () => {
	const { vault, subject } = importer(DuplicateHandling.Update);

	const planned = subject.planNote(vault.root, 'Note');

	assert.equal(planned.desiredPath, 'Note.md');
	assert.equal(planned.targetPath, 'Note.md');
	assert.equal(planned.file, null);
});

test('two notes planned before either is written are given different names', () => {
	const { vault, subject } = importer(DuplicateHandling.Update);

	const first = subject.planNote(vault.root, 'Note');
	const second = subject.planNote(vault.root, 'Note');

	assert.equal(first.targetPath, 'Note.md');
	assert.equal(second.targetPath, 'Note 1.md', 'the second should not be handed a name the first is holding');
});

test('a note the user moved is planned where it now is, not where it would have gone', async () => {
	const { vault, subject } = importer(DuplicateHandling.Update, 'notion-id');
	await vault.createFolder('Archive');
	await vault.create('Archive/Note.md', '---\nnotion-id: abc\n---\nmoved\n');
	subject.indexImportedNotes();

	const planned = subject.planNote(vault.root, 'Note', 'abc');

	assert.equal(planned.desiredPath, 'Note.md');
	assert.equal(planned.targetPath, 'Archive/Note.md');
	assert.equal(planned.file?.path, 'Archive/Note.md');
});

const KNOWN_AS = { id: 'appBase:rec1', formerly: ['rec1'] };

test('the id written onto a note is the one it is known by now', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update, 'airtable-id');

	const planned = subject.planNote(vault.root, 'Note', KNOWN_AS);
	await subject.writePlannedNote(ctx, planned, 'body');

	assert.match(String(vault.contents.get('Note.md')), /airtable-id: appBase:rec1/);
});

test('a note carrying the id it used to be known by is recognised where it was left', async () => {
	const { vault, subject } = importer(DuplicateHandling.Update, 'airtable-id');
	await vault.create('Note.md', '---\nairtable-id: rec1\n---\nwritten by an older version\n');
	subject.indexImportedNotes();

	const planned = subject.planNote(vault.root, 'Note', KNOWN_AS);

	assert.equal(planned.file?.path, 'Note.md');
});

test('and rewriting it is what stops it being known by the ambiguous one', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update, 'airtable-id');
	await vault.create('Note.md', '---\nairtable-id: rec1\n---\nwritten by an older version\n');
	subject.indexImportedNotes();

	const planned = subject.planNote(vault.root, 'Note', KNOWN_AS);
	await subject.writePlannedNote(ctx, planned, 'brought up to date');

	assert.match(String(vault.contents.get('Note.md')), /airtable-id: appBase:rec1/);
});

// Two sources may each claim it: the id that was written is the one that
// could not tell them apart. At the expected path there is nothing to be
// wrong about, but a note that has moved could have come from either.
test('but the same note moved away is left alone rather than guessed at', async () => {
	const { vault, subject } = importer(DuplicateHandling.Update, 'airtable-id');
	await vault.createFolder('Elsewhere');
	await vault.create('Elsewhere/Note.md', '---\nairtable-id: rec1\n---\nwritten by an older version\n');
	subject.indexImportedNotes();

	const planned = subject.planNote(vault.root, 'Note', KNOWN_AS);

	assert.equal(planned.file, null);
	assert.equal(planned.targetPath, 'Note.md');
});

test('a note carrying the id in use is recognised wherever it went', async () => {
	const { vault, subject } = importer(DuplicateHandling.Update, 'airtable-id');
	await vault.createFolder('Elsewhere');
	await vault.create('Elsewhere/Note.md', '---\nairtable-id: appBase:rec1\n---\nmoved\n');
	subject.indexImportedNotes();

	assert.equal(subject.planNote(vault.root, 'Note', KNOWN_AS).file?.path, 'Elsewhere/Note.md');
});

test('a note this run has already planned onto is not planned onto twice', async () => {
	const { vault, subject } = importer(DuplicateHandling.Update, 'airtable-id');
	await vault.create('Note.md', 'a note from before ids were recorded\n');
	subject.indexImportedNotes();

	const first = subject.planNote(vault.root, 'Note', { id: 'appBase:rec1' });
	const second = subject.planNote(vault.root, 'Note', { id: 'appBase:rec2' });

	assert.equal(first.file?.path, 'Note.md');
	assert.equal(second.file, null, 'the second record cannot have the note the first took');
	assert.equal(second.targetPath, 'Note 1.md');
});

test('what preflight makes of a note nothing matches', () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);

	assert.equal(subject.preflight(ctx, subject.planNote(vault.root, 'Note')), 'create');
	assert.deepEqual(ctx.skipped, []);
});

test('"Create a copy" over a name already taken plans a copy', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.CreateCopy);
	await vault.create('Note.md', 'already here');

	const planned = subject.planNote(vault.root, 'Note');

	assert.equal(planned.targetPath, 'Note 1.md');
	assert.equal(subject.preflight(ctx, planned), 'copy');
});

test('the source time decides, and says why', async () => {
	const cases: [number, NoteDisposition, number][] = [
		[2_000, 'unchanged', 1],
		[1_000, 'preserve', 1],
		[3_000, 'update', 0],
	];

	for (const [sourceMtime, expected, skipped] of cases) {
		const { vault, subject, ctx } = importer(DuplicateHandling.Update);
		await vault.create('Note.md', 'here', { mtime: 2_000 });

		const disposition = subject.preflight(ctx, subject.planNote(vault.root, 'Note'), sourceMtime);

		assert.equal(disposition, expected, `mtime ${sourceMtime}`);
		assert.equal(ctx.skipped.length, skipped, `mtime ${sourceMtime} should ${skipped ? '' : 'not '}report`);
	}
});

test('with no source time there is nothing to decide on yet', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);
	await vault.create('Note.md', 'here');

	assert.equal(subject.preflight(ctx, subject.planNote(vault.root, 'Note')), 'compare-content');
	assert.deepEqual(ctx.skipped, [], 'nothing has been decided, so nothing should be reported');
});

test('"Skip" settles it at preflight, so the markdown need never be made', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Skip);
	await vault.create('Note.md', 'here');

	assert.equal(subject.preflight(ctx, subject.planNote(vault.root, 'Note')), 'skip');
	assert.deepEqual(ctx.skipped, ['Note']);
});

test('an answer preflight already gave is acted on rather than asked again', async () => {
	const { vault, subject, ctx } = importer(DuplicateHandling.Update);
	await vault.create('Note.md', 'here', { mtime: 2_000 });

	const planned = subject.planNote(vault.root, 'Note');
	const disposition = subject.preflight(ctx, planned, 2_000);
	const { written, outcome } = await subject.writePlannedNote(ctx, planned, 'converted anyway', { disposition });

	assert.equal(written, false);
	assert.equal(outcome, 'unchanged');
	assert.equal(vault.contents.get('Note.md'), 'here');
	assert.equal(ctx.skipped.length, 1, 'preflight reported it, so the write should not report it again');
});

test('every outcome a write can end in', async () => {
	const created = importer(DuplicateHandling.Update);
	assert.equal((await created.subject.writePlannedNote(
		created.ctx, created.subject.planNote(created.vault.root, 'Note'), 'body')).outcome, 'created');

	const updated = importer(DuplicateHandling.Update);
	await updated.vault.create('Note.md', 'old', { mtime: 1_000 });
	assert.equal((await updated.subject.writePlannedNote(
		updated.ctx, updated.subject.planNote(updated.vault.root, 'Note'), 'new', { mtime: 2_000 })).outcome, 'updated');

	const skipped = importer(DuplicateHandling.Skip);
	await skipped.vault.create('Note.md', 'old');
	assert.equal((await skipped.subject.writePlannedNote(
		skipped.ctx, skipped.subject.planNote(skipped.vault.root, 'Note'), 'new')).outcome, 'skipped');

	const unchanged = importer(DuplicateHandling.Update);
	await unchanged.vault.create('Note.md', 'old', { mtime: 2_000 });
	assert.equal((await unchanged.subject.writePlannedNote(
		unchanged.ctx, unchanged.subject.planNote(unchanged.vault.root, 'Note'), 'new', { mtime: 2_000 })).outcome, 'unchanged');

	const preserved = importer(DuplicateHandling.Update);
	await preserved.vault.create('Note.md', 'edited by hand', { mtime: 3_000 });
	assert.equal((await preserved.subject.writePlannedNote(
		preserved.ctx, preserved.subject.planNote(preserved.vault.root, 'Note'), 'new', { mtime: 2_000 })).outcome, 'preserved');
	assert.equal(preserved.vault.contents.get('Note.md'), 'edited by hand');
});
