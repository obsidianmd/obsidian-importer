/**
 * What an Evernote import does to a vault that already holds something.
 *
 * convert.test.ts imports into an empty directory, which is the only case its
 * recordings cover. Everything the naming and the duplicate handling actually
 * decide - a name already taken, a note an earlier import wrote, attachments
 * beside it - is decided against what is there, and none of it was checked.
 *
 * Two of these record behaviour that is wrong, and say so. They are here so
 * that the change which fixes them has to move an expectation on purpose.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeCryptoModule from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { NodePickedFile, provideNodeModules } from '../../src/filesystem';
import { convertEnexFiles } from '../../src/formats/evernote/convert';
import { defaultEvernoteOptions, ExistingNote, ExistingNoteDecision } from '../../src/formats/evernote/options';
import { FsOutput } from './fs-output';

provideNodeModules({ nodeCrypto: nodeCryptoModule, fs: nodeFs as never, os: nodeOs, path: nodePath });

// The same enex name in two directories: a second export of one notebook, one
// of whose attachments has since been removed. Same name, so the second import
// meets what the first left rather than landing in a notebook of its own.
const FIXTURES = nodePath.join(__dirname, 'prior-state');
const TWO_ATTACHMENTS = nodePath.join(FIXTURES, 'first', 'report.enex');
const ONE_ATTACHMENT = nodePath.join(FIXTURES, 'second', 'report.enex');

/** Where report.enex puts its note, and what it puts beside it. */
const NOTEBOOK = 'report';
const NOTE = `${NOTEBOOK}/Quarterly Report.md`;
const RESOURCES = `${NOTEBOOK}/_resources/Quarterly_Report.resources`;

function stubContext() {
	return {
		notes: [] as string[],
		skips: [] as string[],
		failures: [] as string[],
		status() { },
		reportNoteSuccess(name: string) { this.notes.push(name); },
		reportAttachmentSuccess() { },
		reportSkipped(name: string) { this.skips.push(String(name)); },
		reportFailed(name: string, reason?: unknown) { this.failures.push(`${String(name)}: ${String(reason)}`); },
		reportProgress() { },
		isCancelled() { return false; },
		async shouldStop() { return false; },
		cancel() { },
		finish() { },
	};
}

type Context = ReturnType<typeof stubContext>;

async function importInto(
	outputDir: string,
	fixture: string,
	decideExistingNote?: (existing: ExistingNote) => ExistingNoteDecision,
): Promise<Context> {
	const ctx = stubContext();

	await convertEnexFiles({
		...defaultEvernoteOptions,
		enexSources: [new NodePickedFile(fixture)],
		outputDir,
		decideExistingNote,
	}, new FsOutput(), ctx as never);

	assert.deepEqual(ctx.failures, [], 'no note should fail to convert');

	return ctx;
}

/** Every file in the output, as vault-style relative paths. */
function tree(dir: string): string[] {
	const found: string[] = [];
	const walk = (at: string, prefix: string) => {
		for (const entry of nodeFs.readdirSync(at, { withFileTypes: true })) {
			const next = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(nodePath.join(at, entry.name), next);
			else found.push(next);
		}
	};
	walk(dir, '');

	return found.sort();
}

async function inTempDir(use: (outputDir: string) => Promise<void>): Promise<void> {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-enex-prior-'));
	try {
		await use(outputDir);
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
}

const skip = () => 'skip' as const;
const write = () => 'write' as const;

test('with no answer to give, a second import copies the note and its attachments', async () => {
	await inTempDir(async outputDir => {
		await importInto(outputDir, TWO_ATTACHMENTS);
		await importInto(outputDir, TWO_ATTACHMENTS);

		assert.deepEqual(tree(outputDir), [
			`${NOTE}`,
			`${RESOURCES}/chart.png`,
			`${RESOURCES}/logo.png`,
			'report (1)/Quarterly Report.md',
			'report (1)/_resources/Quarterly_Report.resources/chart.png',
			'report (1)/_resources/Quarterly_Report.resources/logo.png',
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

test('BUG: an attachment dropped from the export is deleted on the next import', async () => {
	// The whole folder goes, so an attachment the export has stopped carrying
	// goes with it. Retiring the cleanup leaves it where it is: this is an
	// import, not a sync, and the vault is the user's.
	await inTempDir(async outputDir => {
		await importInto(outputDir, TWO_ATTACHMENTS);
		assert.ok(nodeFs.existsSync(nodePath.join(outputDir, RESOURCES, 'logo.png')));

		await importInto(outputDir, ONE_ATTACHMENT, write);

		assert.deepEqual(tree(outputDir), [
			NOTE,
			`${RESOURCES}/chart.png`,
		], 'logo.png is gone, though nothing asked for it to be');
	});
});

test('an attachment kept by the export is written again at the same name', async () => {
	await inTempDir(async outputDir => {
		await importInto(outputDir, TWO_ATTACHMENTS);
		await importInto(outputDir, TWO_ATTACHMENTS, write);

		assert.deepEqual(tree(outputDir), [
			NOTE,
			`${RESOURCES}/chart.png`,
			`${RESOURCES}/logo.png`,
		]);
	});
});

test('a notebook folder someone else made is not imported into', async () => {
	await inTempDir(async outputDir => {
		nodeFs.mkdirSync(nodePath.join(outputDir, NOTEBOOK));
		nodeFs.writeFileSync(nodePath.join(outputDir, NOTEBOOK, 'unrelated.md'), 'not ours');

		await importInto(outputDir, TWO_ATTACHMENTS);

		assert.deepEqual(tree(outputDir), [
			`${NOTEBOOK}/unrelated.md`,
			'report (1)/Quarterly Report.md',
			'report (1)/_resources/Quarterly_Report.resources/chart.png',
			'report (1)/_resources/Quarterly_Report.resources/logo.png',
		].sort());
	});
});

test('BUG: a note someone else wrote is written over once the folder is reused', async () => {
	// Answering at all means the folder is reused, and then a note goes to the
	// name its title gives it whatever is there. The file here was never
	// imported - it has no id and no earlier import behind it - and "write"
	// takes it. getUniqueFilePath would number past it instead.
	await inTempDir(async outputDir => {
		nodeFs.mkdirSync(nodePath.join(outputDir, NOTEBOOK), { recursive: true });
		nodeFs.writeFileSync(nodePath.join(outputDir, NOTE), 'not ours');

		await importInto(outputDir, TWO_ATTACHMENTS, write);

		assert.notEqual(nodeFs.readFileSync(nodePath.join(outputDir, NOTE), 'utf8'), 'not ours');
		assert.deepEqual(tree(outputDir).filter(path => path.endsWith('.md')), [NOTE]);
	});
});

test('with no answer to give, a taken note name is left where it is', async () => {
	await inTempDir(async outputDir => {
		nodeFs.mkdirSync(nodePath.join(outputDir, NOTEBOOK), { recursive: true });
		nodeFs.writeFileSync(nodePath.join(outputDir, NOTE), 'not ours');

		await importInto(outputDir, TWO_ATTACHMENTS);

		// The whole notebook folder is numbered past, so the name never meets it.
		assert.equal(nodeFs.readFileSync(nodePath.join(outputDir, NOTE), 'utf8'), 'not ours');
		assert.ok(tree(outputDir).includes('report (1)/Quarterly Report.md'));
	});
});

test('the times both sides give are what the answer is asked with', async () => {
	await inTempDir(async outputDir => {
		const asked: ExistingNote[] = [];

		await importInto(outputDir, TWO_ATTACHMENTS);
		await importInto(outputDir, TWO_ATTACHMENTS, existing => {
			asked.push(existing);
			return 'skip';
		});

		assert.equal(asked.length, 1);
		// The note carries <updated>, and the import writes it onto the file.
		assert.equal(asked[0].updatedAt, Math.floor(asked[0].writtenAt));
	});
});
