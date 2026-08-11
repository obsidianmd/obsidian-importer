/** Regression coverage for notebook folder sanitization (#523). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { Platform } from 'obsidian';

import { provideNodeModules } from '../../src/filesystem';
import {
	getNotebookNameAndFolderNames,
	getSanitizedNotebookFolderNames,
	setPaths,
} from '../../src/formats/evernote/utils/folder-utils';
import { defaultEvernoteOptions } from '../../src/formats/evernote/options';
import { EvernoteRun } from '../../src/formats/evernote/run';
import { FsOutput } from './fs-output';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath });

test('a notebook stack becomes folders a filesystem will take', () => {
	assert.deepEqual(getSanitizedNotebookFolderNames('Stack.@@@Inbox.'), ['Stack']);
});

test('the notebook name itself is left as the user wrote it', () => {
	const { notebookName, notebookFolderNames } = getNotebookNameAndFolderNames('Stack.@@@Inbox.');

	assert.equal(notebookName, 'Inbox.');
	assert.deepEqual(notebookFolderNames, ['Stack.']);
});

test('an enex whose name ends in a dot lands in a folder Windows can open', () => {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-evernote-'));
	try {
		const run = new EvernoteRun({ ...defaultEvernoteOptions, outputDir }, new FsOutput(outputDir));
		setPaths(run, 'Inbox.', outputDir);

		assert.equal(nodePath.basename(run.mdPath), 'Inbox');
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('an enex whose name is only dots still gets a folder', () => {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-evernote-'));
	try {
		const run = new EvernoteRun({ ...defaultEvernoteOptions, outputDir }, new FsOutput(outputDir));
		setPaths(run, '...', outputDir);

		assert.equal(nodePath.basename(run.mdPath), 'Untitled');
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('a long name is still legal once it has been cut down', () => {
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-evernote-'));
	try {
		const run = new EvernoteRun({ ...defaultEvernoteOptions, outputDir }, new FsOutput(outputDir));
		setPaths(run, `${'a'.repeat(98)}${'.'.repeat(20)}`, outputDir);

		assert.ok(!nodePath.basename(run.mdPath).endsWith('.'), `got ${nodePath.basename(run.mdPath)}`);
	}
	finally {
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('off Windows a long notebook name is kept whole', () => {
	const was = Platform.isWin;
	Platform.isWin = false;
	const outputDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-evernote-'));
	try {
		const run = new EvernoteRun({ ...defaultEvernoteOptions, outputDir }, new FsOutput(outputDir));
		const basename = 'Notes from the quarterly planning meeting, including every action item we agreed to follow up on next week';
		setPaths(run, basename, outputDir);

		assert.equal(nodePath.basename(run.mdPath), basename);
	}
	finally {
		Platform.isWin = was;
		nodeFs.rmSync(outputDir, { recursive: true, force: true });
	}
});
