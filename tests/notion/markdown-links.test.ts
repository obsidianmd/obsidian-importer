import { test } from 'node:test';
import assert from 'node:assert/strict';

import { preserveBareUrlLinks } from '../../src/formats/notion/markdown-links';

test('preserves bare URL links emitted by Notion HTML export', () => {
	const markdown = [
		'Links:',
		'[https://example.com](https://example.com)',
		'[http://example.com/path?x=1#top](http://example.com/path?x=1#top)',
		'[www.example.com](www.example.com)',
	].join('\n');

	assert.equal(preserveBareUrlLinks(markdown), [
		'Links:',
		'https://example.com',
		'http://example.com/path?x=1#top',
		'www.example.com',
	].join('\n'));
});

test('keeps descriptive, mismatched, and image links unchanged', () => {
	const markdown = [
		'[Example](https://example.com)',
		'[https://example.com](https://example.org)',
		'![https://example.com](https://example.com)',
	].join('\n');

	assert.equal(preserveBareUrlLinks(markdown), markdown);
});

test('matches URLs whose display text was markdown-escaped', () => {
	assert.equal(
		preserveBareUrlLinks('[https://example.com/a\\_b](https://example.com/a_b)'),
		'https://example.com/a_b'
	);
});
