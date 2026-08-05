/**
 * The Google Keep conversion, outside Obsidian.
 *
 * A parsed Takeout note goes in and markdown comes out, so it runs here
 * directly. The fixtures in notes/ are real Takeout exports lifted out of the
 * .zip in this directory, chosen to cover the states Keep records and
 * Obsidian has nowhere to put but tags: pinned, archived, deleted, coloured,
 * labelled, and a checklist rather than text.
 *
 * Each is recorded as the file the importer would write. Note that Keep's
 * checklists have no nesting in the export - sub-items arrive as ordinary
 * items - so the recorded notes are flat, which is a faithful conversion
 * rather than a lost level.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { convertKeepNote } from '../../src/formats/keep/convert';
import { KeepJson } from '../../src/formats/keep/models';
import { sanitizeFileName } from '../../src/util';
import { expectFile, fixtures } from '../helpers';

const NOTES = nodePath.join(__dirname, 'notes');
const EXPECTED = nodePath.join(__dirname, 'expected');

const notes = fixtures(NOTES, '.json');

test('there are fixtures to convert', () => {
	assert.ok(notes.length > 0, 'expected at least one .json in tests/keep/notes');
});

for (const note of notes) {
	test(`converts ${note}`, () => {
		const keepJson = JSON.parse(nodeFs.readFileSync(nodePath.join(NOTES, note), 'utf8')) as KeepJson;

		// The importer names the file after the export's own file name, which
		// is why a title matching it does not also become an alias.
		const filename = nodePath.basename(note, '.json');
		const { content } = convertKeepNote(keepJson, filename);

		expectFile(content, nodePath.join(EXPECTED, filename, `${sanitizeFileName(filename)}.md`), note);
	});
}

test('turns Keep state into tags', () => {
	const { content } = convertKeepNote({
		color: 'RED',
		isPinned: true,
		isArchived: true,
		isTrashed: true,
		labels: [{ name: 'Recipes' }],
		title: 'Something',
		textContent: 'body',
		createdTimestampUsec: 0,
		userEditedTimestampUsec: 0,
	} as KeepJson, 'Something');

	for (const tag of ['Keep/Color/Red', 'Keep/Pinned', 'Keep/Archived', 'Keep/Deleted', 'Keep/Label/Recipes']) {
		assert.ok(content.includes(tag), `expected ${tag} in:\n${content}`);
	}
});

test('converts microseconds to the milliseconds the vault wants', () => {
	const { ctime, mtime } = convertKeepNote({
		createdTimestampUsec: 1690425909718000,
		userEditedTimestampUsec: 1690864927360000,
	} as KeepJson, 'note');

	assert.equal(ctime, 1690425909718);
	assert.equal(mtime, 1690864927360);
});
