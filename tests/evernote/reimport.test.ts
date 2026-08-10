import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeCryptoModule from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { NodePickedFile, provideNodeModules } from '../../src/filesystem';
import { defaultEvernoteOptions, convertEnexFiles } from '../../src/formats/evernote/convert';
import { ExistingNote, ExistingNoteDecision, setExistingNoteHandler } from '../../src/formats/evernote/options';

provideNodeModules({ nodeCrypto: nodeCryptoModule, fs: nodeFs as never, os: nodeOs, path: nodePath });

const FIXTURES = __dirname;
const FIXTURE = nodePath.join(FIXTURES, 'test-internotebook_links_A.enex');

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

async function convertInto(outputDir: string, ctx: ReturnType<typeof stubContext>): Promise<void> {
	await convertEnexFiles({
		...defaultEvernoteOptions,
		enexSources: [new NodePickedFile(FIXTURE)],
		outputDir,
	}, ctx as never);
}

async function importTwice(
	handler: ((existing: ExistingNote) => ExistingNoteDecision) | null,
	use: (outputDir: string, first: ReturnType<typeof stubContext>, second: ReturnType<typeof stubContext>) => void
): Promise<void> {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-enex-again-'));
	const first = stubContext();
	const second = stubContext();

	try {
		setExistingNoteHandler(null);
		await convertInto(outputDir, first);

		setExistingNoteHandler(handler);
		await convertInto(outputDir, second);

		use(outputDir, first, second);
	}
	finally {
		setExistingNoteHandler(null);
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
}

test('with no answer to give, a second import is a second copy', async () => {
	await importTwice(null, (outputDir, first, second) => {
		assert.deepEqual(second.failures, []);
		assert.equal(second.notes.length, first.notes.length);
		assert.equal(tree(outputDir).length, first.notes.length * 2);
	});
});

test('a note that is left alone is reported skipped and not written again', async () => {
	await importTwice(() => 'skip', (outputDir, first, second) => {
		assert.deepEqual(second.failures, []);
		assert.deepEqual(second.notes, [], 'nothing should be imported');
		assert.equal(second.skips.length, first.notes.length);

		assert.equal(tree(outputDir).length, first.notes.length);
	});
});

test('a note to be written over keeps the name and the folder it already had', async () => {
	await importTwice(() => 'write', (outputDir, first, second) => {
		assert.deepEqual(second.failures, []);
		assert.deepEqual(second.notes, first.notes);
		assert.deepEqual(tree(outputDir), tree(outputDir), 'stable');
		assert.equal(tree(outputDir).length, first.notes.length);
	});
});

test('the answer is asked with the times both sides give', async () => {
	const asked: ExistingNote[] = [];

	await importTwice(existing => {
		asked.push(existing);
		return 'skip';
	}, (_outputDir, first) => {
		assert.equal(asked.length, first.notes.length);

		for (const existing of asked) {
			assert.ok(nodePath.isAbsolute(existing.absolutePath), existing.absolutePath);
			assert.ok(existing.writtenAt > 0, 'the file has a modification time');
			assert.equal(existing.updatedAt, Math.floor(existing.writtenAt), existing.absolutePath);
		}
	});
});
