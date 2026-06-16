import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeFileName, sanitizeFilePath } from '../../src/sanitize';

test('sanitizeFileName trims leading spaces and trailing periods', () => {
	assert.equal(sanitizeFileName(' Alice Smith. '), 'Alice Smith');
});

test('sanitizeFilePath preserves folders while sanitizing each segment', () => {
	assert.equal(
		sanitizeFilePath(' Contacts / Friends. / Alice Smith. '),
		'Contacts/Friends/Alice Smith'
	);
});

test('sanitizeFilePath removes empty path segments', () => {
	assert.equal(sanitizeFilePath('/ Contacts // Friends /'), 'Contacts/Friends');
});
