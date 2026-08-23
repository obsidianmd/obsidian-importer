import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeWhitespace } from '../../src/formats/logseq/normalize';

test('[B1] trims trailing whitespace', () => {
	const input = ['- a   ', '- b\t', 'plain  '].join('\n');
	assert.equal(normalizeWhitespace(input), ['- a', '- b', 'plain'].join('\n'));
});

test('[B1] removes empty bullets', () => {
	const input = ['- a', '- ', '\t-', '- b'].join('\n');
	assert.equal(normalizeWhitespace(input), ['- a', '- b'].join('\n'));
});

test('[B1] converts NBSP to space', () => {
	const input = 'foo\u00A0bar';
	assert.equal(normalizeWhitespace(input), 'foo bar');
});

test('[B1] does not trim inside fenced code blocks', () => {
	const input = ['```', 'code   ', '\tindented  ', '```'].join('\n');
	assert.equal(normalizeWhitespace(input), input);
});

test('[B1] does not trim inside bullet-prefixed code fences', () => {
	const input = ['- ```query', '  (or   ', '  more code  ', '  ```'].join('\n');
	assert.equal(normalizeWhitespace(input), input);
});

test('[B1] off leaves content intact', () => {
	// The option is applied by the caller.
	const input = 'foo\u00A0bar   \n- a  \n- \n- b';
	assert.notEqual(normalizeWhitespace(input), input);
});

test('[B1] keeps an empty bullet that has a ^anchor', () => {
	const input = ['- a', '- ^abc123', '- b'].join('\n');
	assert.equal(normalizeWhitespace(input), input);
});

test('[B1] does not collapse intentional blank lines', () => {
	const input = ['- a', '', '', '- b'].join('\n');
	assert.equal(normalizeWhitespace(input), input);
});

test('[B1] keeps an empty bullet that owns children', () => {
	const input = ['- ', '\t- child one', '\t- child two'].join('\n');
	assert.equal(normalizeWhitespace(input), ['-', '\t- child one', '\t- child two'].join('\n'));
});

test('[B1] does not normalize inside tilde fences', () => {
	const input = ['~~~markdown', 'code\u00a0  ', '- ', '~~~'].join('\n');
	assert.equal(normalizeWhitespace(input), input);
});

test('[B1] preserves the space before inline code while trimming the line end', () => {
	assert.equal(normalizeWhitespace('- Run `npm test` before you push.  '), '- Run `npm test` before you push.');
});
