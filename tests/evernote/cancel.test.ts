import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { importEnex, inTempDir, stubContext } from './harness';

const FIXTURE = nodePath.join(__dirname, 'test-resource-attributes-single-child.enex');

test('a cancelled import finishes, and keeps the notes it had already read', async () => {
	await inTempDir(async outputDir => {
		const ctx = stubContext();
		// The second status announces the first note.
		ctx.isCancelled = () => ctx.statuses >= 2;

		await importEnex(outputDir, [FIXTURE], { ctx });

		assert.deepEqual(ctx.notes, ['test-resource-attributes-single-child/Only File Name']);
		assert.deepEqual(ctx.failures, []);

		const notebook = nodePath.join(outputDir, 'test-resource-attributes-single-child');
		assert.ok(nodeFs.existsSync(nodePath.join(notebook, 'Only File Name.md')), 'the note read before the stop is written');
		assert.ok(!nodeFs.existsSync(nodePath.join(notebook, 'File Name And Source.md')), 'the note after it is not');
	});
});
