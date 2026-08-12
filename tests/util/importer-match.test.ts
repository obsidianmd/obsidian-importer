import { test } from 'node:test';
import assert from 'node:assert/strict';

import { importersForFiles } from '../../src/importer-match';

const IMPORTERS = [
	{ id: 'bear', extensions: ['bear2bk'] },
	{ id: 'evernote', extensions: ['enex'] },
	{ id: 'html', extensions: ['htm', 'html'] },
	{ id: 'apple-journal', extensions: ['htm', 'html'] },
	{ id: 'keep', extensions: ['zip', 'json', 'png', 'jpg'] },
	{ id: 'notion', extensions: ['zip'] },
	{ id: 'textbundle', extensions: ['textbundle', 'textpack', 'zip'] },
];

test('an extension only one importer reads names that importer', () => {
	assert.deepEqual(importersForFiles(IMPORTERS, ['enex']), ['evernote']);
	assert.deepEqual(importersForFiles(IMPORTERS, ['bear2bk', 'bear2bk']), ['bear']);
});

test('an extension several importers read leaves the choice open', () => {
	assert.deepEqual(importersForFiles(IMPORTERS, ['zip']), ['notion', 'textbundle', 'keep']);
});

test('an extension no importer reads matches nothing', () => {
	assert.deepEqual(importersForFiles(IMPORTERS, ['docx']), []);
});

test('the importer that reads more of what was dropped comes first', () => {
	// Keep takes both; Notion only the zip.
	assert.deepEqual(importersForFiles(IMPORTERS, ['zip', 'png']).slice(0, 1), ['keep']);
});

test('an importer is offered for the files it can read, not the ones it cannot', () => {
	assert.deepEqual(importersForFiles(IMPORTERS, ['html', 'docx']), ['html', 'apple-journal']);
});
