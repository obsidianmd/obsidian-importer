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

test('a note title that opens with a word and a colon stays an internal link', () => {
	// The scheme pattern is a bare word and a colon, which is also how plenty
	// of note titles start. Without this these became <Re: budget> - a dead
	// autolink where there used to be a working wiki link.
	assert.equal(isNormalMarkdownHref('Re: budget'), false);
	assert.equal(isNormalMarkdownHref('TODO: follow up'), false);
	assert.equal(isNormalMarkdownHref('Project: Q1 plan'), false);
});

test('a scheme with no space in it is still a normal Markdown link', () => {
	// The guard is on whitespace, so nothing the rule is for is caught by it.
	assert.equal(isNormalMarkdownHref('tel:205-555-8260'), true);
	assert.equal(isNormalMarkdownHref('x-soulver://open?doc=abc'), true);
	assert.equal(isNormalMarkdownHref('C:\\Users\\me\\file.txt'), true);
});
