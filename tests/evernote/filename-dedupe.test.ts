import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	getFilenameIndexForPrefix,
	getFilenamePrefix,
	getNextFilenameIndex,
} from '../../src/formats/evernote/utils/filename-dedupe';

test('chooses the next filename index case-insensitively', () => {
	assert.equal(getNextFilenameIndex([
		'Sales.md',
		'Sales.1.md',
		'salesforce.md',
	], 'sales'), 2);
});

test('fills gaps instead of reusing an existing case-variant suffix', () => {
	assert.equal(getNextFilenameIndex([
		'Sales.md',
		'sales.2.md',
	], 'sales'), 1);
});

test('detects zettelkasten numbered copies before the note title suffix', () => {
	assert.equal(getNextFilenameIndex([
		'202601011230.md',
		'202601011230.1 Project.md',
	], '202601011230'), 2);
});

test('detects numbered copies case-insensitively', () => {
	assert.equal(getFilenameIndexForPrefix('Project.12', 'project'), 12);
	assert.equal(getFilenameIndexForPrefix('PROJECT.12', 'project'), 12);
});

test('escapes regex characters in note titles before matching numbered copies', () => {
	assert.equal(getFilenameIndexForPrefix('Q1.2026 Plan.1', 'q1.2026 plan'), 1);
	assert.equal(getFilenameIndexForPrefix('Q1x2026 Plan.1', 'q1.2026 plan'), null);
});

test('extracts filename prefixes using the existing final-extension rule', () => {
	assert.equal(getFilenamePrefix('archive.tar.gz'), 'archive.tar');
	assert.equal(getFilenamePrefix('Untitled Note.md'), 'Untitled Note');
});
