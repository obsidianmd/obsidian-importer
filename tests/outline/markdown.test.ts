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
