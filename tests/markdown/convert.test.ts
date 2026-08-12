/**
 * The Markdown conversion, outside Obsidian.
 *
 * Markdown goes in and markdown comes out, so the conversion runs here as it
 * is. Each fixture is recorded twice over: once with every option off, which
 * has to hand the note back exactly as it was written, and once with inline
 * tags moved into the tags property.
 *
 * What the fixtures pin down about which `#` is a tag: one that starts a word,
 * and holds something other than digits. That leaves a heading, a link
 * fragment, a heading reference in a wikilink, and anything inside code out of
 * it - and, deliberately, a tag in brackets too, because `](#heading)` in a
 * link is written the same way.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { convertMarkdownNote } from '../../src/formats/markdown/convert';
import { expectedFor, expectFile, fixtures } from '../helpers';

const FIXTURES = __dirname;

const notes = fixtures(FIXTURES, '.md');

test('there are fixtures to convert', () => {
	assert.ok(notes.length > 0, 'expected at least one .md in tests/markdown');
});

for (const note of notes) {
	const name = nodePath.basename(note.name, '.md');
	const content = () => nodeFs.readFileSync(note.path, 'utf8');

	test(`leaves ${note.name} as it was written`, () => {
		const { markdown, tags } = convertMarkdownNote(content(), { tagsAsProperties: false });

		assert.equal(markdown, content(), 'a conversion with nothing turned on must not touch the note');
		assert.deepEqual(tags, []);
	});

	test(`moves the tags in ${note.name} into properties`, () => {
		const { markdown } = convertMarkdownNote(content(), { tagsAsProperties: true });

		expectFile(markdown, expectedFor(note, name, 'tags-as-properties.md'), note.name);
	});
}
