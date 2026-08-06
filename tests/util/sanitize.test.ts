/**
 * What a file name coming from an imported note is allowed to become.
 *
 * This is the boundary a title crosses on its way to a vault path, so what it
 * strips is worth stating rather than leaving to whichever importer happens to
 * exercise it. Every case here is a rule already in sanitizeFileName; nothing
 * asserts new behaviour.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeFileName, sanitizeFilePath, stripControlCharacters } from '../../src/util';

test('a name with nothing usable in it falls back to Untitled', () => {
	// A source that has no title at all hands over undefined or null rather
	// than an empty string, and lands on the same default.
	for (const name of ['', '   ', undefined, null, '...', '.', '\u0000\u0001']) {
		assert.equal(sanitizeFileName(name), 'Untitled', `for ${JSON.stringify(name)}`);
	}
});

test('a usable name is left alone', () => {
	assert.equal(sanitizeFileName('Meeting notes'), 'Meeting notes');
	assert.equal(sanitizeFileName('Ünïcödé — em dash'), 'Ünïcödé — em dash');
});

test('separators cannot escape the folder they were meant for', () => {
	assert.equal(sanitizeFileName('a/b'), 'a-b');
	assert.equal(sanitizeFileName('a\\b'), 'a-b');

	// Traversal is defeated by there being no separator left to traverse on,
	// not by the dots being tidied away: only the first leading dot goes, so
	// what is left still reads oddly. It is one path segment, which is the
	// property that matters here.
	const traversal = sanitizeFileName('../../etc/passwd');
	assert.equal(traversal, '.-..-etc-passwd');
	assert.ok(!traversal.includes('/') && !traversal.includes('\\'));
});

test('characters no filesystem accepts are dropped', () => {
	assert.equal(sanitizeFileName('a?b<c>d:e*f|g"h'), 'abcdefgh');
});

test('characters that would break a link are dropped', () => {
	assert.equal(sanitizeFileName('a[b]c#d|e^f'), 'abcdef');
});

test('Windows reserved names do not survive', () => {
	assert.equal(sanitizeFileName('CON'), 'Untitled');
	assert.equal(sanitizeFileName('lpt1.txt'), 'Untitled');
	// Only the whole name is reserved, not a name containing it
	assert.equal(sanitizeFileName('CONTENTS'), 'CONTENTS');
});

test('a name cannot start with a dot or end in a dot or space', () => {
	assert.equal(sanitizeFileName('.hidden'), 'hidden');
	assert.equal(sanitizeFileName('trailing.'), 'trailing');
	assert.equal(sanitizeFileName('trailing   '), 'trailing');
});

test('control characters go, astral characters stay', () => {
	assert.equal(stripControlCharacters('a\u0000b\u001fc'), 'abc');
	// C1 as well as C0
	assert.equal(stripControlCharacters('a\u0085b'), 'ab');
	// Surrogate pairs read as their lead unit, which is above the C1 range
	assert.equal(stripControlCharacters('a\u{1F642}b'), 'a\u{1F642}b');
	assert.equal(sanitizeFileName('note\u0000name'), 'notename');
});

/**
 * A path from the source is a run of names, each of which becomes a folder,
 * so each has to survive as one. A CSV template like `{{Category}}/{{Name}}`
 * puts a cell value straight into one of those positions.
 */
test('every segment of a path goes through the same rule a name does', () => {
	assert.equal(sanitizeFilePath('Work/Q1 Plan'), 'Work/Q1 Plan');
	// The separators are what sanitizeFileName would otherwise turn into dashes
	assert.equal(sanitizeFilePath('a/b/c'), 'a/b/c');
});

test('a segment Windows would refuse is fixed where it stands', () => {
	// The folder this used to make can be created on Windows and then not opened
	assert.equal(sanitizeFilePath('Reports./Q1'), 'Reports/Q1');
	assert.equal(sanitizeFilePath('Work/  Draft  '), 'Work/Draft');
	assert.equal(sanitizeFilePath('Work/con/notes'), 'Work/Untitled/notes');
});

test('an empty segment contributes nothing rather than a folder', () => {
	assert.equal(sanitizeFilePath('Work//Q1'), 'Work/Q1');
	assert.equal(sanitizeFilePath('/Work/'), 'Work');
	assert.equal(sanitizeFilePath('   '), '');
});

test('a segment with nothing usable still becomes a folder', () => {
	// Unlike an empty one: the source named it, so a level is expected here.
	assert.equal(sanitizeFilePath('Work/.../Q1'), 'Work/Untitled/Q1');
});
