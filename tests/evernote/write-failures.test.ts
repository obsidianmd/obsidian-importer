import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { NodePickedFile } from '../../src/filesystem';
import { convertEnexFiles } from '../../src/formats/evernote/convert';
import { defaultEvernoteOptions } from '../../src/formats/evernote/options';
import { FileTimes } from '../../src/formats/evernote/output';
import { FsOutput } from './fs-output';
import { inTempDir, stubContext, tree } from './harness';

const FIXTURES = ['web-clip-image-query.enex', 'test-file-with-many-dots.enex'].map(n => nodePath.join(__dirname, n));
const REJECTED = 'File name cannot contain any of the following characters';

async function importRejecting(outputDir: string, rejects: (path: string) => boolean) {
	const ctx = stubContext();
	const output = new FsOutput(outputDir, { ctx });
	const writeNote = output.writeNote.bind(output);
	const writeAttachment = output.writeAttachment.bind(output);

	output.writeNote = async (path: string, markdown: string, times: FileTimes) => {
		if (rejects(path)) throw new Error(REJECTED);
		await writeNote(path, markdown, times);
	};
	output.writeAttachment = async (path: string, data: ArrayBuffer, times: FileTimes) => {
		if (rejects(path)) throw new Error(REJECTED);
		await writeAttachment(path, data, times);
	};

	await convertEnexFiles({
		...defaultEvernoteOptions,
		enexSources: FIXTURES.map(path => new NodePickedFile(path)),
		outputDir,
	}, output, ctx as never);

	return ctx;
}

test('an attachment the vault rejects is reported and the import continues', async () => {
	await inTempDir(async outputDir => {
		const ctx = await importRejecting(outputDir, path => path.endsWith('23e4a5a4.png'));

		assert.deepEqual(ctx.failures, [`23e4a5a4.png: Error: ${REJECTED}`]);
		assert.deepEqual(tree(outputDir), [
			'test-file-with-many-dots/Test with files contains multiple dots.md',
			'test-file-with-many-dots/attachments/test.file.with.many.dots.txt',
			'web-clip-image-query/Clipped article.md',
		]);

		const note = nodeFs.readFileSync(nodePath.join(outputDir, 'web-clip-image-query/Clipped article.md'), 'utf8');
		assert.match(note, /!\[\[web-clip-image-query\/attachments\/23e4a5a4\.png\]\]/);
	});
});

test('a note the vault rejects is reported and the import continues', async () => {
	await inTempDir(async outputDir => {
		const ctx = await importRejecting(outputDir, path => path.endsWith('Clipped article.md'));

		assert.deepEqual(ctx.failures, [`Clipped article: Error: ${REJECTED}`]);
		assert.ok(tree(outputDir).includes('test-file-with-many-dots/Test with files contains multiple dots.md'));
	});
});
