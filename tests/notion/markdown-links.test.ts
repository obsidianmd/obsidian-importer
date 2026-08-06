import { test } from 'node:test';
import assert from 'node:assert/strict';

import { preserveBareUrlLinks } from '../../src/formats/notion/markdown-links';

test('a link whose text is its own target becomes a bare URL', () => {
	assert.equal(
		preserveBareUrlLinks('[https://example.com](https://example.com)'),
		'https://example.com'
	);
	assert.equal(
		preserveBareUrlLinks('[http://example.com/path?x=1#top](http://example.com/path?x=1#top)'),
		'http://example.com/path?x=1#top'
	);
});

test('descriptive, mismatched and image links are left alone', () => {
	const markdown = [
		'[Example](https://example.com)',
		'[https://example.com](https://example.org)',
		'![https://example.com](https://example.com)',
	].join('\n');

	assert.equal(preserveBareUrlLinks(markdown), markdown);
});

test('a schemeless target stays wrapped, since a bare www is not autolinked', () => {
	assert.equal(
		preserveBareUrlLinks('[www.example.com](www.example.com)'),
		'[www.example.com](www.example.com)'
	);
});

test('text escaped by htmlToMarkdown still matches its target', () => {
	assert.equal(
		preserveBareUrlLinks('[https://example.com/a\\_b](https://example.com/a_b)'),
		'https://example.com/a_b'
	);
});

test('the same syntax inside code is not rewritten', () => {
	const fenced = '```\n[https://example.com](https://example.com)\n```';
	assert.equal(preserveBareUrlLinks(fenced), fenced);

	const inline = 'Write `[https://example.com](https://example.com)` to link it.';
	assert.equal(preserveBareUrlLinks(inline), inline);
});

test('a link at the start of a line is unwrapped', () => {
	assert.equal(
		preserveBareUrlLinks('Links:\n[https://example.com](https://example.com)\n'),
		'Links:\nhttps://example.com\n'
	);
});
