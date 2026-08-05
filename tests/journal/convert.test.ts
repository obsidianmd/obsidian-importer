/**
 * The Apple Journal conversion, outside Obsidian.
 *
 * An exported entry is one HTML file, mostly presentation: the conversion keeps
 * the reflection prompt and the body paragraphs, and reads the asset grid for
 * the tokens it writes as frontmatter. Each entry here is recorded as the note
 * a user would get, at the importer's default of frontmatter on.
 *
 * Photos, live photos and videos are left out of the frontmatter deliberately -
 * the importer does not bring the files across, so a property naming them would
 * point at nothing.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { convertJournalEntry } from '../../src/formats/apple-journal/convert';
import { expectedFor, expectFile, fixtures } from '../helpers';

const FIXTURES = __dirname;

const entries = fixtures(FIXTURES, '.html');

test('there are entries to convert', () => {
	assert.ok(entries.length > 0, 'expected at least one .html in tests/journal');
});

for (const entry of entries) {
	test(`converts ${entry.name}`, () => {
		const markdown = convertJournalEntry(nodeFs.readFileSync(entry.path, 'utf8'), { frontMatter: true });

		expectFile(markdown, expectedFor(entry, `${nodePath.basename(entry.name, '.html')}.md`), entry.name);
	});
}

test('leaves the frontmatter out when the setting is off', () => {
	const entry = entries.find(e => e.name.startsWith('entry-with-assets'));
	assert.ok(entry, 'expected entry-with-assets.html');

	const markdown = convertJournalEntry(nodeFs.readFileSync(entry.path, 'utf8'), { frontMatter: false });

	// The date comes from the page header rather than the asset grid, so it
	// stays either way
	assert.match(markdown, /^---\ndate: /);
	assert.doesNotMatch(markdown, /state-of-mind/);
});
