import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeWhitespace } from '../../src/formats/logseq/normalize';

test('[T6] trims trailing whitespace', () => {
	const input = ['- a   ', '- b\t', 'plain  '].join('\n');
	assert.equal(normalizeWhitespace(input), ['- a', '- b', 'plain'].join('\n'));
});

test('[T6] removes empty bullets', () => {
	const input = ['- a', '- ', '\t-', '- b'].join('\n');
	assert.equal(normalizeWhitespace(input), ['- a', '- b'].join('\n'));
});

test('[T6] converts NBSP to space', () => {
	const input = 'foo\u00A0bar';
	assert.equal(normalizeWhitespace(input), 'foo bar');
});

test('[T6] does not trim inside fenced code blocks', () => {
	const input = ['```', 'code   ', '\tindented  ', '```'].join('\n');
	assert.equal(normalizeWhitespace(input), input);
});

test('[T6] keeps an empty bullet that has a ^anchor', () => {
	const input = ['- a', '- ^abc123', '- b'].join('\n');
	assert.equal(normalizeWhitespace(input), input);
});

test('[T6] does not collapse intentional blank lines', () => {
	const input = ['- a', '', '', '- b'].join('\n');
	assert.equal(normalizeWhitespace(input), input);
});
