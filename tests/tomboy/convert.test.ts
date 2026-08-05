/**
 * The Tomboy conversion, outside Obsidian.
 *
 * TomboyCoreConverter parses a .note and returns markdown. It touches nothing
 * but a DOMParser, so it runs here as-is - the importer class around it is the
 * Obsidian shell, and none of that is needed to check what the conversion
 * produces.
 *
 * Each .note is recorded as expected/<fixture>/<title>.md: the file name the
 * importer would give it, holding the body it would write.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { TomboyCoreConverter } from '../../src/formats/tomboy/core';
import { sanitizeFileName } from '../../src/util';
import { expectedFor, expectFile, fixtures } from '../helpers';

const FIXTURES = __dirname;

const notes = fixtures(FIXTURES, '.note');

test('there are fixtures to convert', () => {
	assert.ok(notes.length > 0, 'expected at least one .note in tests/tomboy');
});

for (const note of notes) {
	test(`converts ${note.name}`, () => {
		const converter = new TomboyCoreConverter();
		const parsed = converter.parseTomboyXML(nodeFs.readFileSync(note.path, 'utf8'));
		const markdown = converter.convertToMarkdown(parsed);

		// Recorded under the name the importer would give it, through the same
		// sanitiser, holding the body it produced.
		const name = `${sanitizeFileName(parsed.title)}.md`;
		expectFile(markdown, expectedFor(note, nodePath.basename(note.name, '.note'), name), note.name);
	});
}
