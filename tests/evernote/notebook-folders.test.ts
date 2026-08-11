/**
 * The folders an Evernote import puts notebooks in.
 *
 * An enex file name becomes a folder name directly, and a notebook stack -
 * which Evernote writes into the file name as `Stack@@@Notebook` - becomes a
 * folder per segment. Neither went through a sanitiser, so a notebook whose
 * name ends in a dot produced a folder Windows creates but cannot open (#523).
 *
 * The name itself is left alone: it is what a link into another notebook is
 * resolved against. Only the folder it becomes has to be legal.
 *
 * What sanitizeFileName does to a given string is tests/util/sanitize.test.ts;
 * what is checked here is that the notebook path goes through it at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { provideNodeModules } from '../../src/filesystem';
import {
	getNotebookNameAndFolderNames,
	getSanitizedNotebookFolderNames,
	setPaths,
} from '../../src/formats/evernote/utils/folder-utils';
import { defaultEvernoteOptions } from '../../src/formats/evernote/options';
import { EvernoteRun } from '../../src/formats/evernote/run';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath });

test('a notebook stack becomes folders a filesystem will take', () => {
	assert.deepEqual(getSanitizedNotebookFolderNames('Stack.@@@Inbox.'), ['Stack']);
});

test('the notebook name itself is left as the user wrote it', () => {
	// getNotebookStackedProps hands this on as the display name, so the dot
	// belongs in it even though it cannot survive in the folder.
	const { notebookName, notebookFolderNames } = getNotebookNameAndFolderNames('Stack.@@@Inbox.');

	assert.equal(notebookName, 'Inbox.');
	assert.deepEqual(notebookFolderNames, ['Stack.']);
});

test('an enex whose name ends in a dot lands in a folder Windows can open', () => {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-evernote-'));
	try {
		const run = new EvernoteRun({ ...defaultEvernoteOptions, outputDir });
		setPaths(run, 'Inbox.', outputDir);

		assert.equal(nodePath.basename(run.paths.mdPath), 'Inbox');
		assert.ok(nodeFs.existsSync(run.paths.mdPath), 'the folder should have been created');
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('an enex whose name is only dots still gets a folder', () => {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-evernote-'));
	try {
		const run = new EvernoteRun({ ...defaultEvernoteOptions, outputDir });
		setPaths(run, '...', outputDir);

		assert.equal(nodePath.basename(run.paths.mdPath), 'Untitled');
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('a long name is still legal after being truncated', () => {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-evernote-'));
	try {
		// Truncation cuts at 100 characters, which here lands mid-way through a
		// run of dots - so sanitising only before the cut would leave one on.
		const run = new EvernoteRun({ ...defaultEvernoteOptions, outputDir });
		setPaths(run, `${'a'.repeat(98)}${'.'.repeat(20)}`, outputDir);

		assert.ok(!nodePath.basename(run.paths.mdPath).endsWith('.'), `got ${nodePath.basename(run.paths.mdPath)}`);
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
});
