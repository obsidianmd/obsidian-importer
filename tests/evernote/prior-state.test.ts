/**
 * What an Evernote import does to a vault that already holds something.
 *
 * convert.test.ts imports into an empty directory, which is the only case its
 * recordings cover. Everything the naming and the duplicate handling actually
 * decide - a name already taken, a note an earlier import wrote, attachments
 * beside it - is decided against what is there, and none of it was checked.
 *
 * Three of them recorded behaviour that was wrong and said so. All three have
 * since been fixed, and each fix had to move an expectation here on purpose,
 * which is what these were written for.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { Duplicates } from './fs-output';
import { Context, importEnex, inTempDir, tree } from './harness';

// The same enex name in two directories: a second export of one notebook, one
// of whose attachments has since been removed. Same name, so the second import
// meets what the first left rather than landing in a notebook of its own.
const FIXTURES = nodePath.join(__dirname, 'prior-state');
const TWO_ATTACHMENTS = nodePath.join(FIXTURES, 'first', 'report.enex');
const ONE_ATTACHMENT = nodePath.join(FIXTURES, 'second', 'report.enex');
/** An export that says when the note was made but not when it last changed. */
const NO_UPDATED_TIME = nodePath.join(FIXTURES, 'no-updated-time.enex');

/** Where report.enex puts its note, and what it puts beside it. */
const NOTEBOOK = 'report';
const NOTE = `${NOTEBOOK}/Quarterly Report.md`;
const RESOURCES = `${NOTEBOOK}/attachments`;

async function importInto(outputDir: string, fixture: string, duplicates: Duplicates = 'copy'): Promise<Context> {
	const ctx = await importEnex(outputDir, [fixture], { duplicates });
	assert.deepEqual(ctx.failures, [], 'no note should fail to convert');

	return ctx;
}

const skip = 'skip' as const;
const write = 'update' as const;

test('with no answer to give, a second import copies the note and its attachments', async () => {
	await inTempDir(async outputDir => {
		await importInto(outputDir, TWO_ATTACHMENTS);
		await importInto(outputDir, TWO_ATTACHMENTS);

		assert.deepEqual(tree(outputDir), [
			`${NOTE}`,
			`${RESOURCES}/chart.png`,
			`${RESOURCES}/logo.png`,
			'report 1/Quarterly Report.md',
			'report 1/attachments/chart.png',
			'report 1/attachments/logo.png',
		].sort());
	});
});

test('a note the user asked to leave alone is reported skipped and not written', async () => {
	await inTempDir(async outputDir => {
		await importInto(outputDir, TWO_ATTACHMENTS);
		const before = nodeFs.readFileSync(nodePath.join(outputDir, NOTE), 'utf8');

		const second = await importInto(outputDir, TWO_ATTACHMENTS, skip);

		assert.deepEqual(second.notes, []);
		assert.equal(second.skips.length, 1);
		assert.equal(nodeFs.readFileSync(nodePath.join(outputDir, NOTE), 'utf8'), before);
	});
});

test('a skipped note leaves its attachments, and anything beside them, alone', async () => {
	// The disposition is decided before a single attachment is decoded, so a
	// note the import is leaving alone costs nothing and touches nothing. It
	// used to clear and refill the folder first, taking any file the user had
	// put in there with it.
	await inTempDir(async outputDir => {
		await importInto(outputDir, TWO_ATTACHMENTS);

		const beside = nodePath.join(outputDir, RESOURCES, 'my own notes.txt');
		nodeFs.writeFileSync(beside, 'mine');

		await importInto(outputDir, TWO_ATTACHMENTS, skip);

		assert.equal(nodeFs.readFileSync(beside, 'utf8'), 'mine');
		assert.deepEqual(tree(outputDir), [
			NOTE,
			`${RESOURCES}/chart.png`,
			`${RESOURCES}/logo.png`,
			`${RESOURCES}/my own notes.txt`,
		].sort());
	});
});

test('an attachment dropped from the export is left where it is', async () => {
	// Nothing deletes an attachment any more. An export that has stopped
	// carrying one says nothing about the copy in the vault: this is an import,
	// not a sync, and what is in the vault is the user's.
	await inTempDir(async outputDir => {
		await importInto(outputDir, TWO_ATTACHMENTS);

		await importInto(outputDir, ONE_ATTACHMENT, write);

		assert.deepEqual(tree(outputDir), [
			NOTE,
			`${RESOURCES}/chart.png`,
			`${RESOURCES}/logo.png`,
		]);
	});
});

test('an attachment the vault already holds is recognised rather than copied', async () => {
	// The same name holding the same bytes is this attachment again, so the
	// note keeps saying what it said and nothing is written a second time.
	// Without that, every import would leave "chart 1.png" beside the last.
	await inTempDir(async outputDir => {
		await importInto(outputDir, TWO_ATTACHMENTS);
		const before = nodeFs.readFileSync(nodePath.join(outputDir, NOTE), 'utf8');

		await importInto(outputDir, TWO_ATTACHMENTS, write);

		assert.deepEqual(tree(outputDir), [
			NOTE,
			`${RESOURCES}/chart.png`,
			`${RESOURCES}/logo.png`,
		]);
		assert.equal(nodeFs.readFileSync(nodePath.join(outputDir, NOTE), 'utf8'), before);
	});
});

test('a notebook folder someone else made is not imported into', async () => {
	await inTempDir(async outputDir => {
		nodeFs.mkdirSync(nodePath.join(outputDir, NOTEBOOK));
		nodeFs.writeFileSync(nodePath.join(outputDir, NOTEBOOK, 'unrelated.md'), 'not ours');

		await importInto(outputDir, TWO_ATTACHMENTS);

		assert.deepEqual(tree(outputDir), [
			`${NOTEBOOK}/unrelated.md`,
			'report 1/Quarterly Report.md',
			'report 1/attachments/chart.png',
			'report 1/attachments/logo.png',
		].sort());
	});
});

test('a note someone else wrote is left where it is, in the folder being reused', async () => {
	// It used to be written over: a note went to the name its title gave it
	// whatever was there. Now the file at that path is taken to be an earlier
	// import's note - previouslyImported falls back to the path, for every
	// importer - and it is newer than the export, so it is preserved.
	//
	// The imported note is dropped rather than written beside it, which is what
	// preserving means and is the same everywhere. Worth knowing, because a
	// hand-written note that happens to share a title is indistinguishable
	// from one an earlier import left.
	await inTempDir(async outputDir => {
		nodeFs.mkdirSync(nodePath.join(outputDir, NOTEBOOK), { recursive: true });
		nodeFs.writeFileSync(nodePath.join(outputDir, NOTE), 'not ours');

		const ctx = await importInto(outputDir, TWO_ATTACHMENTS, write);

		assert.equal(nodeFs.readFileSync(nodePath.join(outputDir, NOTE), 'utf8'), 'not ours');
		assert.deepEqual(tree(outputDir).filter(path => path.endsWith('.md')), [NOTE]);
		assert.equal(ctx.skips.length, 1, 'and the user is told it was left');
	});
});

test('with no answer to give, a taken note name is left where it is', async () => {
	await inTempDir(async outputDir => {
		nodeFs.mkdirSync(nodePath.join(outputDir, NOTEBOOK), { recursive: true });
		nodeFs.writeFileSync(nodePath.join(outputDir, NOTE), 'not ours');

		await importInto(outputDir, TWO_ATTACHMENTS);

		// The whole notebook folder is numbered past, so the name never meets it.
		assert.equal(nodeFs.readFileSync(nodePath.join(outputDir, NOTE), 'utf8'), 'not ours');
		assert.ok(tree(outputDir).includes('report 1/Quarterly Report.md'));
	});
});

test('a note whose export gives no time is counted once, not imported and skipped', async () => {
	// With no <updated> to compare, nothing can be decided until the markdown
	// exists - so the note is converted, and only the write knows it matched
	// what was already there. Reporting the success at the conversion counted
	// that note as imported and skipped both.
	await inTempDir(async outputDir => {
		await importInto(outputDir, NO_UPDATED_TIME);
		const second = await importInto(outputDir, NO_UPDATED_TIME, write);

		assert.deepEqual(second.notes, [], 'nothing is written the second time');
		assert.equal(second.skips.length, 1, 'and it is reported once, as left alone');
	});
});

test('a note edited since the import is preserved rather than written over', async () => {
	// The note is newer than the export says the source is, so the edit is the
	// user's and the import leaves it. Update is the mode that would otherwise
	// have written over it.
	await inTempDir(async outputDir => {
		await importInto(outputDir, TWO_ATTACHMENTS);

		const note = nodePath.join(outputDir, NOTE);
		nodeFs.writeFileSync(note, 'what I wrote instead');
		const later = new Date(nodeFs.statSync(note).mtimeMs + 60_000);
		nodeFs.utimesSync(note, later, later);

		await importInto(outputDir, TWO_ATTACHMENTS, write);

		assert.equal(nodeFs.readFileSync(note, 'utf8'), 'what I wrote instead');
	});
});
