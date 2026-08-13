import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeAltText } from '../../src/formats/onenote/alt-text';

test('the characters that would end a markdown label are removed', () => {
	assert.equal(sanitizeAltText('a [bracketed] label'), 'a bracketed label');
	assert.equal(sanitizeAltText('back\\slash and `code` and <tag>'), 'backslash and code and tag');
});

test('alt text spanning lines becomes one line', () => {
	assert.equal(sanitizeAltText('  first line\n\n\tsecond line  '), 'first line second line');
});

test('alt text worth keeping is kept as it was', () => {
	assert.equal(sanitizeAltText('Text Box: Background Check Authorization'), 'Text Box: Background Check Authorization');
	assert.equal(sanitizeAltText(''), '');
});

test('a page of OCR is cut at a word rather than mid-sentence', () => {
	const cut = sanitizeAltText('word '.repeat(200).trim());

	assert.equal(cut.length, 300);
	assert.ok(cut.endsWith('word…'), cut);
});

test('the cut counts Unicode code points instead of UTF-16 units', () => {
	const cut = sanitizeAltText('🙂'.repeat(10), 4);

	assert.equal(cut, '🙂🙂🙂🙂…');
});

test('a single word longer than the limit is still cut', () => {
	assert.equal(sanitizeAltText('abcdefghij', 4), 'abcd…');
});
