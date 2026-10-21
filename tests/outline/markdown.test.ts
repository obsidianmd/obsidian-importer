import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { markdownFenceLines, outsideMarkdownCode, outsideMarkdownFences } from '../../src/markdown';

const CRLF_FENCE = ['```', 'code', '```', 'prose', ''].join('\r\n');

test('a fence closes on a line that ends in CRLF', () => {
	assert.deepEqual(markdownFenceLines(CRLF_FENCE), [true, true, true, false, false]);
	assert.equal(outsideMarkdownFences(CRLF_FENCE, segment => segment.toUpperCase()), ['```', 'code', '```', 'PROSE', ''].join('\r\n'));
	assert.equal(outsideMarkdownCode(CRLF_FENCE, segment => segment.toUpperCase()), ['```', 'code', '```', 'PROSE', ''].join('\r\n'));
});

test('a fence closes only on one kind of delimiter', () => {
	const text = ['~~~', '~~~```', '^^code^^', '~~~', '^^prose^^'].join('\n');
	const rewrite = (segment: string) => segment.replace(/\^\^/g, '==');

	assert.equal(outsideMarkdownCode(text, rewrite), ['~~~', '~~~```', '^^code^^', '~~~', '==prose=='].join('\n'));
	assert.deepEqual(markdownFenceLines(text), [true, true, true, true, false]);
});

test('a line that opens with three backticks protects what follows, even when it is a code span', () => {
	const rewrite = (segment: string) => segment.replace(/\^\^/g, '==');

	assert.equal(outsideMarkdownCode('```a `\n^^code^^```', rewrite), '```a `\n^^code^^```');
});
