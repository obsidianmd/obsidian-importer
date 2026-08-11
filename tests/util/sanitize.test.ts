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

import { Platform } from 'obsidian';

import { sanitizeFileName, sanitizeFilePath, stripControlCharacters } from '../../src/util';

function withPlatform(platform: 'windows' | 'elsewhere', check: () => void): void {
	const was = Platform.isWin;
	Platform.isWin = platform === 'windows';
	try {
		check();
	}
	finally {
		Platform.isWin = was;
	}
}

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

test('a name too long for a filesystem is cut down to one that fits', () => withPlatform('elsewhere', () => {
	const sentence = 'In a single-tenant setup, a SaaS application is uniquely deployed to a specific environment not shared with other consumer tenants. This involves having a separate application instance, along with a dedicated database and runtime memory exclusively for each SaaS client.';

	const name = sanitizeFileName(sentence);
	assert.ok(new TextEncoder().encode(name).length <= 240, `${name.length} characters is still too long`);
	assert.ok(sentence.startsWith(name), 'the name should be a prefix of the title');
	assert.ok(!name.endsWith(' '), 'a trailing space would be refused on Windows');
	assert.match(name, /runtime memory$/);
}));

test('the limit is in bytes, and no character is split to reach it', () => withPlatform('elsewhere', () => {
	const encoder = new TextEncoder();

	for (const character of ['a', 'é', '漢', '🙂']) {
		const name = sanitizeFileName(character.repeat(400));
		const bytes = encoder.encode(name).length;

		assert.ok(bytes <= 240, `${character} gave ${bytes} bytes`);
		assert.ok(bytes > 240 - 4, `${character} gave ${bytes} bytes, which wastes the budget`);
		assert.equal([...name].every(c => c === character), true, `${character} came back damaged`);
	}
}));

test('cutting a name short cannot leave one Windows refuses', () => withPlatform('elsewhere', () => {
	assert.equal(sanitizeFileName(`CON${' '.repeat(237)}x`), 'Untitled');
	assert.equal(sanitizeFileName(`Notes.${' '.repeat(300)}`), 'Notes');
}));

test('a name that already fits is not touched', () => withPlatform('elsewhere', () => {
	const name = 'a'.repeat(240);
	assert.equal(sanitizeFileName(name), name);
}));

// Regression cases for obsidianmd/obsidian-importer#617 and #618.
const minifiedCss = 'body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}.header{color:#333;background:#fff;border-bottom:1px solid #e0e0e0;padding:12px 24px}.header .nav{display:flex;gap:16px}';

test('on Windows a name is measured against the folder it goes in', () => withPlatform('windows', () => {
	const folder = 'OneNote/Work notebook/Reference/Snippets';
	const name = sanitizeFileName(minifiedCss, folder);

	assert.ok(`${folder}/${name}.md`.length <= 160,
		`${folder}/${name}.md is ${`${folder}/${name}.md`.length} characters`);
	assert.ok(minifiedCss.replace(/[?<>:*|"]/g, '').startsWith(name), 'what is kept is still the start of the title');
}));

test('the deeper the folder, the less of the title survives', () => withPlatform('windows', () => {
	const shallow = sanitizeFileName(minifiedCss, 'OneNote');
	const deep = sanitizeFileName(minifiedCss, 'OneNote/Work notebook/Archive/2019/Reference/Snippets');

	assert.ok(deep.length < shallow.length, `${deep.length} should be under ${shallow.length}`);
}));

test('a folder with no room left still leaves a name worth reading', () => withPlatform('windows', () => {
	const name = sanitizeFileName(minifiedCss, 'a/'.repeat(90) + 'a');

	assert.equal(name.length, 24, 'the path is lost either way; the name need not be');
}));

test('elsewhere the folder above a name costs it nothing', () => withPlatform('elsewhere', () => {
	const deep = sanitizeFileName(minifiedCss, 'OneNote/Work notebook/Archive/2019/Reference/Snippets');

	assert.equal(deep, sanitizeFileName(minifiedCss), 'only Windows counts the path as a whole');
	assert.ok(deep.length > 200, 'and this one is inside the byte limit anyway');
}));

test('on Windows every segment of a path is measured against the ones before it', () => withPlatform('windows', () => {
	const path = sanitizeFilePath(`Work notebook/${minifiedCss}`);
	const [notebook, snippet] = path.split('/');

	assert.ok(path.length <= 152, `${path.length} characters leaves nothing for a name`);
	assert.equal(notebook, 'Work notebook', 'a folder that fits is left as it is');
	assert.ok(snippet.length < 140, `the one that does not is cut, and ${snippet.length} is not`);
}));

test('a path with no fitting arrangement still names its levels', () => withPlatform('windows', () => {
	const path = sanitizeFilePath(`${minifiedCss}/${minifiedCss}/${minifiedCss}`);

	assert.equal(path.split('/').length, 3, 'every level the source named is still a level');
	assert.ok(path.split('/').every(segment => segment.length >= 24), 'and none of them is a stub');
	assert.ok(path.length < minifiedCss.length, 'what can be given back is');
}));

test('on Windows the folder a path is built under is spent from its budget', () => withPlatform('windows', () => {
	const alone = sanitizeFilePath(minifiedCss);
	const under = sanitizeFilePath(minifiedCss, 'Evernote/Imported/Work notebook');

	assert.ok(under.length < alone.length, `${under.length} should leave less than ${alone.length}`);
}));

test('the folder a path is built under is not sanitized or returned', () => {
	assert.equal(sanitizeFilePath('Inbox', 'Evernote/A folder named after a note.'), 'Inbox');
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
