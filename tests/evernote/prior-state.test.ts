import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { Duplicates } from './fs-output';
import { Context, importEnex, inTempDir, tree } from './harness';

const FIXTURES = nodePath.join(__dirname, 'prior-state');
const TWO_ATTACHMENTS = nodePath.join(FIXTURES, 'first', 'report.enex');
const ONE_ATTACHMENT = nodePath.join(FIXTURES, 'second', 'report.enex');
const NO_UPDATED_TIME = nodePath.join(FIXTURES, 'no-updated-time.enex');

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

		assert.equal(nodeFs.readFileSync(nodePath.join(outputDir, NOTE), 'utf8'), 'not ours');
		assert.ok(tree(outputDir).includes('report 1/Quarterly Report.md'));
	});
});

test('a note whose export gives no time is counted once, not imported and skipped', async () => {
	await inTempDir(async outputDir => {
		await importInto(outputDir, NO_UPDATED_TIME);
		const second = await importInto(outputDir, NO_UPDATED_TIME, write);

		assert.deepEqual(second.notes, [], 'nothing is written the second time');
		assert.equal(second.skips.length, 1, 'and it is reported once, as left alone');
	});
});

test('a note edited since the import is preserved rather than written over', async () => {
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
