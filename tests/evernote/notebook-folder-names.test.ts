import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	getNotebookNameAndFolderNames,
	getSanitizedNotebookFolderNames,
	sanitizeNotebookFolderName,
} from '../../src/formats/yarle/utils/notebook-folder-utils';

test('removes Windows trailing dots from Evernote notebook folder names', () => {
	assert.equal(sanitizeNotebookFolderName('Inbox.'), 'Inbox');
});

test('removes Windows trailing spaces from Evernote notebook folder names', () => {
	assert.equal(sanitizeNotebookFolderName('Inbox   '), 'Inbox');
});

test('falls back when an Evernote notebook folder name has no usable characters', () => {
	assert.equal(sanitizeNotebookFolderName('...'), 'Untitled');
});

test('sanitizes Evernote notebook stack folder segments', () => {
	assert.deepEqual(getSanitizedNotebookFolderNames('Stack.@@@Inbox.'), ['Stack']);
});

test('preserves the display notebook name when splitting Evernote notebook stacks', () => {
	const names = getNotebookNameAndFolderNames('Stack.@@@Inbox.');

	assert.equal(names.notebookName, 'Inbox.');
	assert.deepEqual(names.notebookFolderNames, ['Stack.']);
});

test('preserves safe Evernote notebook folder names', () => {
	assert.equal(sanitizeNotebookFolderName('Project Notes'), 'Project Notes');
});
