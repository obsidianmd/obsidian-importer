import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EvernoteNote } from '../../src/formats/evernote/models/EvernoteNote';
import { noteTimes } from '../../src/formats/evernote/utils/note-times';

const CREATED = Date.UTC(2019, 3, 17, 20, 7, 40);
const UPDATED = Date.UTC(2019, 3, 22, 19, 38, 0);

function times(note: Partial<EvernoteNote>) {
	return noteTimes(note as EvernoteNote);
}

test('takes the times the note carries', () => {
	assert.deepEqual(times({ created: '20190417T200740Z', updated: '20190422T193800Z' }), {
		ctime: CREATED,
		mtime: UPDATED,
	});
});

test('a note that was never edited was last changed when it was created', () => {
	assert.deepEqual(times({ created: '20190417T200740Z' }), { ctime: CREATED, mtime: CREATED });
});

test('leaves the times to the vault when the note carries neither', () => {
	assert.deepEqual(times({}), { ctime: undefined, mtime: undefined });
});

test('an unreadable date is no date at all', () => {
	assert.deepEqual(times({ created: '20190417T200740Z', updated: 'not a date' }), {
		ctime: CREATED,
		mtime: CREATED,
	});
});
