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

import { convertKeepNote, formatAnnotations, keepTemplateVariables } from '../../src/formats/keep/convert';
import { KeepJson } from '../../src/formats/keep/models';
import { sanitizeFileName } from '../../src/util';
import { expectedFor, expectFile, fixtures } from '../helpers';

const NOTES = nodePath.join(__dirname, 'notes');

const notes = fixtures(NOTES, '.json');

test('there are fixtures to convert', () => {
	assert.ok(notes.length > 0, 'expected at least one .json in tests/keep/notes');
});

for (const note of notes) {
	test(`converts ${note.name}`, () => {
		const keepJson = JSON.parse(nodeFs.readFileSync(note.path, 'utf8')) as KeepJson;

		// The importer names the file after the export's own file name, which
		// is why a title matching it does not also become an alias.
		const filename = nodePath.basename(note.name, '.json');
		const { content } = convertKeepNote(keepJson, filename);

		expectFile(content, expectedFor(note, filename, `${sanitizeFileName(filename)}.md`), note.name);
	});
}

test('turns Keep state into tags', () => {
	const { content } = convertKeepNote({
		color: 'RED',
		isPinned: true,
		isArchived: true,
		isTrashed: true,
		tasks: [{ id: 'task-1' }],
		labels: [{ name: 'Recipes' }],
		title: 'Something',
		textContent: 'body',
		createdTimestampUsec: 0,
		userEditedTimestampUsec: 0,
	} as KeepJson, 'Something');

	for (const tag of ['Keep/Color/Red', 'Keep/Pinned', 'Keep/Task', 'Keep/Archived', 'Keep/Deleted', 'Keep/Label/Recipes']) {
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

test('offers simple list values to the shared template metadata editor', () => {
	const variables = keepTemplateVariables({
		textContent: 'Raw note text',
		listContent: [{ text: 'Raw checklist item', isChecked: false }],
		labels: [{ name: 'Recipes' }, { name: 'Later' }],
		sharees: [{ email: 'owner@example.com', isOwner: true, type: 'USER' }],
		tasks: [{ id: 'task-1' }],
		attachments: [{ filePath: 'drawing.png', mimetype: 'image/png' }],
		annotations: [{ url: 'https://example.com/' }, { title: 'No URL' }],
		createdTimestampUsec: 1690425909718000,
		userEditedTimestampUsec: 1690864927360000,
	} as KeepJson);

	assert.deepEqual(variables.labels, ['Recipes', 'Later']);
	assert.equal(variables.labelNames, undefined);
	assert.deepEqual(variables.sharees, [{ email: 'owner@example.com', isOwner: true, type: 'USER' }]);
	assert.deepEqual(variables.annotations, [{ url: 'https://example.com/' }, { title: 'No URL' }]);
	assert.equal(variables.annotationUrls, undefined);
	assert.equal(variables.tasks, undefined);
	assert.equal(variables.taskIds, undefined);
	assert.equal(variables.attachments, undefined);
	assert.equal(variables.textContent, undefined);
	assert.equal(variables.listContent, undefined);
	assert.equal(variables.createdTimestampUsec, undefined);
	assert.equal(variables.userEditedTimestampUsec, undefined);
});

test('formats annotation fallbacks and skips empty annotations', () => {
	assert.equal(formatAnnotations([
		{},
		{ title: 'Example [Docs]', url: 'https://example.com/docs' },
		{ url: 'https://example.com/path(with-parens)' },
		{ description: 'Only *a* description' },
	]), [
		'## Annotations',
		'',
		'- [Example \\[Docs\\]](<https://example.com/docs>)',
		'- <https://example.com/path(with-parens)>',
		'- Only \\*a\\* description',
	].join('\n'));
});

test('preserves Keep line breaks when the vault uses strict Markdown line breaks', () => {
	const { content } = convertKeepNote({
		textContent: 'first\nsecond\n\nthird',
		createdTimestampUsec: 0,
		userEditedTimestampUsec: 0,
	} as KeepJson, 'note', true);

	assert.ok(content.endsWith('\nfirst  \nsecond  \n  \nthird'));
});
