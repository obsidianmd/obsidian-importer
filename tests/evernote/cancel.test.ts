/**
 * Stopping an Evernote import part-way through an enex.
 *
 * Cancelling closes the read, which ends it without ever ending the parser -
 * so the parser's own 'end' never arrives. Nothing waited on that, and the
 * import hung there rather than finishing with what it had. A test that fails
 * here fails by timing out.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { importEnex, inTempDir, stubContext } from './harness';

// Two notes, so there is one to reach and one to stop before.
const FIXTURE = nodePath.join(__dirname, 'test-resource-attributes-single-child.enex');

test('a cancelled import finishes, and keeps the notes it had already read', async () => {
	await inTempDir(async outputDir => {
		const ctx = stubContext();
		// status() is called once for the enex being read and then once per
		// note, so the second message is the first note: that one converts, and
		// the read stops before the one after it. The note count cannot drive
		// this - a note is not reported until it is written, which is after the
		// whole file has been read.
		ctx.isCancelled = () => ctx.statuses >= 2;

		await importEnex(outputDir, [FIXTURE], { ctx });

		assert.deepEqual(ctx.notes, ['test-resource-attributes-single-child/Only File Name']);
		assert.deepEqual(ctx.failures, []);

		const notebook = nodePath.join(outputDir, 'test-resource-attributes-single-child');
		assert.ok(nodeFs.existsSync(nodePath.join(notebook, 'Only File Name.md')), 'the note read before the stop is written');
		assert.ok(!nodeFs.existsSync(nodePath.join(notebook, 'File Name And Source.md')), 'the note after it is not');
	});
});
