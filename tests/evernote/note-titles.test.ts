import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTitle } from '../../src/formats/evernote/utils/filename-utils';

test('a title keeps the characters a wikilink can carry', () => {
	assert.equal(normalizeTitle('Q3 sales & marketing (draft)'), 'Q3 sales & marketing (draft)');
});

test('a title loses the characters that would break the link to it', () => {
	assert.equal(normalizeTitle('Notes [2024] #plan | draft^2'), 'Notes 2024 plan  draft2');
});

test('a title with nothing left to link to falls back with the note', () => {
	assert.equal(normalizeTitle('###'), 'Untitled');
});
