/**
 * Stopping an Evernote import part-way through an enex.
 *
 * Cancelling closes the read stream, which ends it without ever ending the
 * parser - so the parser's own 'end' never arrives. Nothing waited on the
 * stream closing, and the import hung there rather than finishing with what it
 * had. A test that fails here fails by timing out.
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
import { defaultEvernoteOptions } from '../../src/formats/evernote/options';
import { FsOutput } from './fs-output';

provideNodeModules({ nodeCrypto: nodeCryptoModule, fs: nodeFs as never, os: nodeOs, path: nodePath });

// Two notes, so there is one to reach and one to stop before.
const FIXTURE = nodePath.join(__dirname, 'test-resource-attributes-single-child.enex');

/**
 * Reports itself cancelled once the import has announced a note.
 *
 * status() is called once for the enex being read and then once per note, so
 * the second message is the first note: that one converts, and the read stops
 * before the one after it. The note count cannot drive this - a note is not
 * reported until it is written, which is after the whole file has been read.
 */
function cancelAfterFirstNote() {
	return {
		notes: [] as string[],
		announcements: 0,
		status() { this.announcements++; },
		reportNoteSuccess(name: string) { this.notes.push(name); },
		reportAttachmentSuccess() { },
		reportSkipped() { },
		reportFailed(name: string, reason?: unknown) {
			throw new Error(`unexpected failure: ${String(name)}: ${String(reason)}`);
		},
		reportProgress() { },
		isCancelled() { return this.announcements >= 2; },
		async shouldStop() { return this.isCancelled(); },
		cancel() { },
		finish() { },
	};
}

test('a cancelled import finishes, and keeps the notes it had already read', async () => {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-enex-cancel-'));
	const ctx = cancelAfterFirstNote();

	try {
		await convertEnexFiles({
			...defaultEvernoteOptions,
			enexSources: [new NodePickedFile(FIXTURE)],
			outputDir,
		}, new FsOutput(outputDir, { ctx }), ctx as never);

		assert.deepEqual(ctx.notes, ['test-resource-attributes-single-child/Only File Name']);

		const notebook = nodePath.join(outputDir, 'test-resource-attributes-single-child');
		assert.ok(nodeFs.existsSync(nodePath.join(notebook, 'Only File Name.md')), 'the note read before the stop is written');
		assert.ok(!nodeFs.existsSync(nodePath.join(notebook, 'File Name And Source.md')), 'the note after it is not');
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
});
