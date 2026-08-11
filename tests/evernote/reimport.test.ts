import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { Duplicates } from './fs-output';
import { Context, importEnex, inTempDir, tree } from './harness';

const FIXTURE = nodePath.join(__dirname, 'test-internotebook_links_A.enex');

async function importTwice(
	duplicates: Duplicates,
	use: (outputDir: string, first: Context, second: Context) => void,
	between?: (outputDir: string) => void
): Promise<void> {
	await inTempDir(async outputDir => {
		const first = await importEnex(outputDir, [FIXTURE]);
		between?.(outputDir);
		const second = await importEnex(outputDir, [FIXTURE], { duplicates });

		use(outputDir, first, second);
	});
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
	await importTwice('update', (outputDir, first, second) => {
		assert.deepEqual(second.notes, [], 'nothing is written a second time');
		assert.equal(second.skips.length, first.notes.length);
		assert.equal(tree(outputDir).length, first.notes.length);
	});
});
