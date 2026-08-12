import { test } from 'node:test';
import assert from 'node:assert/strict';

import { importersForFiles, readableFiles } from '../../src/importer-match';

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
	assert.deepEqual(importersForFiles(IMPORTERS, ['zip', 'png']).slice(0, 1), ['keep']);
});

test('an importer is offered for the files it can read, not the ones it cannot', () => {
	assert.deepEqual(importersForFiles(IMPORTERS, ['html', 'docx']), ['html', 'apple-journal']);
});

test('an export dropped with ten other things is a drop of an export', () => {
	const dropped = [
		{ extension: 'zip', name: 'export.zip' },
		...Array.from({ length: 10 }, (_, n) => ({ extension: 'docx', name: `report ${n}.docx` })),
	];

	assert.deepEqual(readableFiles(IMPORTERS, dropped).map(file => file.name), ['export.zip']);
});

test('a drop nothing here reads keeps nothing', () => {
	assert.deepEqual(readableFiles(IMPORTERS, [{ extension: 'docx' }, { extension: 'pages' }]), []);
});
