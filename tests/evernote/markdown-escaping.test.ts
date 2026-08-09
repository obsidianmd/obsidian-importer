import { test } from 'node:test';
import assert from 'node:assert/strict';

import { restoreIntraWordEscapedUnderscores } from '../../src/formats/evernote/utils/markdown-escaping';

test('restores escaped underscores inside words', () => {
	assert.equal(
		restoreIntraWordEscapedUnderscores('A file named foo\\_bar.txt was imported.'),
		'A file named foo_bar.txt was imported.'
	);
});

test('restores repeated intra-word underscores', () => {
	assert.equal(
		restoreIntraWordEscapedUnderscores('one\\_two\\_three'),
		'one_two_three'
	);
});

test('restores intra-word underscores between Unicode letters', () => {
	assert.equal(
		restoreIntraWordEscapedUnderscores('cafe\\_moka and café\\_moka'),
		'cafe_moka and café_moka'
	);
});

test('preserves escapes used for Markdown emphasis delimiters', () => {
	assert.equal(
		restoreIntraWordEscapedUnderscores('\\_emphasis\\_ and word \\_ word'),
		'\\_emphasis\\_ and word \\_ word'
	);
});

test('preserves underscores outside word boundaries', () => {
	assert.equal(
		restoreIntraWordEscapedUnderscores('\\_leading trailing\\_ foo\\__bar'),
		'\\_leading trailing\\_ foo\\__bar'
	);
});
