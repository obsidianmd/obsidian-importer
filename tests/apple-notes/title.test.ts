import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getAppleNotesTitleFromText } from '../../src/formats/apple-notes/title';

test('uses the full first line as the Apple Notes title', () => {
	const title = 'This is a long Apple Notes title that should stay intact instead of being shortened by the database title field';

	assert.equal(getAppleNotesTitleFromText(`${title}\nThe rest of the note body.`), title);
});

test('supports Windows and classic Mac line endings', () => {
	assert.equal(getAppleNotesTitleFromText('Windows line ending\r\nBody'), 'Windows line ending');
	assert.equal(getAppleNotesTitleFromText('Classic Mac line ending\rBody'), 'Classic Mac line ending');
});

test('trims whitespace around the first line', () => {
	assert.equal(getAppleNotesTitleFromText('  Trimmed title  \nBody'), 'Trimmed title');
});

test('returns null when the note text has no title line', () => {
	assert.equal(getAppleNotesTitleFromText(''), null);
	assert.equal(getAppleNotesTitleFromText('   \nBody'), null);
	assert.equal(getAppleNotesTitleFromText(undefined), null);
});
