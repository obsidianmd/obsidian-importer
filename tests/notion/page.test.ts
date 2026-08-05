/**
 * One exported Notion page, converted on its own.
 *
 * convert.test.ts beside this drives a whole export, which is what catches the
 * parts that need pages to resolve against each other. A single page needs
 * none of that, and it is the cheaper way to cover markup an export here does
 * not happen to contain.
 *
 * What it covers today is a database row's properties. The conversion turns
 * table.properties into frontmatter, reading it through tbody.rows and
 * tr.cells - neither of which linkedom implements, so tests/shims/dom.ts
 * supplies them. No committed export carries a property table, so without a
 * page here the whole path, and the YAML it produces, would go unchecked.
 *
 * Drop any exported page in this directory - or in local/, which is
 * gitignored, for one that cannot be committed - and its markdown is recorded
 * beside it.
 */
import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { convertHtmlToMarkdown } from '../../src/formats/notion/convert-to-md';
import { NotionResolverInfo } from '../../src/formats/notion/notion-types';
import { expectFile, expectedFor, fixtures } from '../helpers';

const FIXTURES = __dirname;

const pages = fixtures(FIXTURES, '.html');

test('there are pages to convert', () => {
	assert.ok(pages.length > 0, 'expected at least one .html in tests/notion');
});

for (const page of pages) {
	test(`converts ${page.name}`, () => {
		// A page on its own resolves no links to other pages, so the info it is
		// handed is empty - the same one the importer builds before its first
		// pass has read anything.
		const markdown = convertHtmlToMarkdown(new NotionResolverInfo('', false), nodeFs.readFileSync(page.path, 'utf8'));

		expectFile(markdown, expectedFor(page, `${nodePath.basename(page.name, '.html')}.md`), page.name);
	});
}
