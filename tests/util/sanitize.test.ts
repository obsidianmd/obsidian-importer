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
	// not by the dots being tidied away: the ones the leading pair became are
	// still in there, so what is left reads oddly. It is one path segment,
	// which is the property that matters here.
	const traversal = sanitizeFileName('../../etc/passwd');
	assert.equal(traversal, '-..-etc-passwd');
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

/**
 * A name left starting with a dot is worse than untidy. Obsidian hides those,
 * so the file never enters the vault's index: the next import asks for a free
 * name, is told this one is free, and the write fails against a file that is
 * there on disk and invisible in the app.
 *
 * One dot was all that used to go, which is not what a title opening with an
 * ellipsis needs - and the dots a link character was standing in front of were
 * uncovered after the rule had already run.
 */
test('a name cannot start with a dot or end in a dot or space', () => {
	assert.equal(sanitizeFileName('.hidden'), 'hidden');
	assert.equal(sanitizeFileName('...hidden'), 'hidden');
	assert.equal(sanitizeFileName('. . . In that Empire'), 'In that Empire');
	assert.equal(sanitizeFileName('[.]hidden'), 'hidden');
	assert.equal(sanitizeFileName('trailing.'), 'trailing');
	assert.equal(sanitizeFileName('trailing   '), 'trailing');
});

/**
 * A note whose title is a whole paragraph is not unusual - Notion gives a page
 * with no title the first line of its body - and the file it asks for is one
 * no filesystem will open. macOS reports ENAMETOOLONG and the note is lost,
 * which is what the Notion API importer was doing to hundreds of pages at a
 * time.
 */
test('a name too long for a filesystem is cut down to one that fits', () => {
	const sentence = 'In a single-tenant setup, a SaaS application is uniquely deployed to a specific environment not shared with other consumer tenants. This involves having a separate application instance, along with a dedicated database and runtime memory exclusively for each SaaS client.';

	const name = sanitizeFileName(sentence);
	assert.ok(new TextEncoder().encode(name).length <= 240, `${name.length} characters is still too long`);
	// Cut back to a word, so the name still reads as the start of the title
	assert.ok(sentence.startsWith(name), 'the name should be a prefix of the title');
	assert.ok(!name.endsWith(' '), 'a trailing space would be refused on Windows');
	assert.match(name, /runtime memory$/);
});

/**
 * The budget is in bytes because that is what the filesystem counts. A title
 * in a script that spends three bytes a character gets fewer characters, and a
 * character is never cut in half to reach the limit.
 */
test('the limit is in bytes, and no character is split to reach it', () => {
	const encoder = new TextEncoder();

	for (const character of ['a', 'é', '漢', '🙂']) {
		const name = sanitizeFileName(character.repeat(400));
		const bytes = encoder.encode(name).length;

		assert.ok(bytes <= 240, `${character} gave ${bytes} bytes`);
		assert.ok(bytes > 240 - 4, `${character} gave ${bytes} bytes, which wastes the budget`);
		assert.equal([...name].every(c => c === character), true, `${character} came back damaged`);
	}
});

/**
 * Every rule about what a name may be has to run again after it is cut short,
 * not just the one about trailing dots: a title Windows would have accepted
 * whole can truncate back to one of the names it reserves.
 */
test('cutting a name short cannot leave one Windows refuses', () => {
	assert.equal(sanitizeFileName(`CON${' '.repeat(237)}x`), 'Untitled');
	assert.equal(sanitizeFileName(`Notes.${' '.repeat(300)}`), 'Notes');
});

test('a name that already fits is not touched', () => {
	const name = 'a'.repeat(240);
	assert.equal(sanitizeFileName(name), name);
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
