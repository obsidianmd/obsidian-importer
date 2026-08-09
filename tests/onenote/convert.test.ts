/**
 * A OneNote page's conversion, outside Obsidian.
 *
 * The importer's half - fetching attachments, asking the vault for a path -
 * sits between the two halves here, so a fixture with no attachments converts
 * the same way with or without it: tags first, then markdown.
 */
import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { convertPageTags, pageToMarkdown } from '../../src/formats/onenote/convert';
import { parseHTML } from '../../src/util';
import { expectedFor, expectFile, fixtures } from '../helpers';

const FIXTURES = __dirname;

const pages = fixtures(FIXTURES, '.html');

test('there are pages to convert', () => {
	assert.ok(pages.length > 0, 'expected at least one .html in tests/onenote');
});

for (const page of pages) {
	test(`converts ${page.name}`, () => {
		const markdown = pageToMarkdown(parseHTML(convertPageTags(nodeFs.readFileSync(page.path, 'utf8'))));

		expectFile(markdown, expectedFor(page, `${nodePath.basename(page.name, '.html')}.md`), page.name);
	});
}
