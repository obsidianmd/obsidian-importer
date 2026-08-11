import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeCryptoModule from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { NodePickedFile, provideNodeModules } from '../../src/filesystem';
import { convertEnexFiles } from '../../src/formats/evernote/convert';
import { defaultEvernoteOptions } from '../../src/formats/evernote/options';
import { Duplicates, FsOutput } from './fs-output';

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

async function convertInto(
	outputDir: string,
	ctx: ReturnType<typeof stubContext>,
	duplicates: Duplicates = 'copy'
): Promise<void> {
	await convertEnexFiles({
		...defaultEvernoteOptions,
		enexSources: [new NodePickedFile(FIXTURE)],
		outputDir,
	}, new FsOutput(outputDir, { duplicates, ctx }), ctx as never);
}

async function importTwice(
	duplicates: Duplicates,
	use: (outputDir: string, first: ReturnType<typeof stubContext>, second: ReturnType<typeof stubContext>) => void,
	between?: (outputDir: string) => void
): Promise<void> {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-enex-again-'));
	const first = stubContext();
	const second = stubContext();

	try {
		await convertInto(outputDir, first);
		between?.(outputDir);
		await convertInto(outputDir, second, duplicates);

		use(outputDir, first, second);
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
}

test('with no answer to give, a second import is a second copy', async () => {
	await importTwice('copy', (outputDir, first, second) => {
		assert.deepEqual(second.failures, []);
		assert.equal(second.notes.length, first.notes.length);
		assert.equal(tree(outputDir).length, first.notes.length * 2);
	});
});

test('a note that is left alone is reported skipped and not written again', async () => {
	await importTwice('skip', (outputDir, first, second) => {
		assert.deepEqual(second.failures, []);
		assert.deepEqual(second.notes, [], 'nothing should be imported');
		assert.equal(second.skips.length, first.notes.length);

		assert.equal(tree(outputDir).length, first.notes.length);
	});
});

test('a note the source has moved on from keeps the name and folder it had', async () => {
	// Backdating the notes is what an export carrying newer ones amounts to:
	// the import writes each one again, in place, taking no new name.
	await importTwice('update', (outputDir, first, second) => {
		assert.deepEqual(second.failures, []);
		assert.deepEqual(second.notes, first.notes);
		assert.equal(tree(outputDir).length, first.notes.length);
	}, outputDir => {
		for (const file of tree(outputDir)) {
			const at = nodePath.join(outputDir, file);
			const earlier = new Date(nodeFs.statSync(at).mtimeMs - 60_000);
			nodeFs.utimesSync(at, earlier, earlier);
		}
	});
});

test('a note nobody has touched at either end is left as unchanged', async () => {
	// The import writes the export's own modification time onto the note, so a
	// second import of the same export finds the two equal and leaves it.
	await importTwice('update', (outputDir, first, second) => {
		assert.deepEqual(second.notes, [], 'nothing is written a second time');
		assert.equal(second.skips.length, first.notes.length);
		assert.equal(tree(outputDir).length, first.notes.length);
	});
});
