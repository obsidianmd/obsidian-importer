import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isNormalMarkdownHref } from '../../src/formats/yarle/utils/link-hrefs';

test('treats app and phone URI schemes as normal Markdown links', () => {
	assert.equal(isNormalMarkdownHref('tel:205-555-8260'), true);
	assert.equal(isNormalMarkdownHref('x-soulver://open?doc=abc'), true);
	assert.equal(isNormalMarkdownHref('busycalevent://event/123'), true);
	assert.equal(isNormalMarkdownHref('app://example/path'), true);
});

test('keeps existing normal Markdown link schemes', () => {
	assert.equal(isNormalMarkdownHref('https://example.com'), true);
	assert.equal(isNormalMarkdownHref('http://example.com'), true);
	assert.equal(isNormalMarkdownHref('ftp://example.com/file.txt'), true);
	assert.equal(isNormalMarkdownHref('file:///Users/example/file.txt'), true);
	assert.equal(isNormalMarkdownHref('mailto:user@example.com'), true);
	assert.equal(isNormalMarkdownHref('www.example.com'), true);
});

test('does not treat note names or unsafe schemes as normal Markdown links', () => {
	assert.equal(isNormalMarkdownHref('Project note'), false);
	assert.equal(isNormalMarkdownHref('evernote://view/123/abc'), false);
	assert.equal(isNormalMarkdownHref('javascript:alert(1)'), false);
	assert.equal(isNormalMarkdownHref('data:text/html;base64,PGgxPkhlbGxvPC9oMT4='), false);
	assert.equal(isNormalMarkdownHref('vbscript:msgbox(1)'), false);
});
