import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatRoamMarkdownLine, getRoamChildIndent } from '../../src/formats/roam/list-format';

test('formats first-level Roam blocks as unindented bullets', () => {
	const indent = getRoamChildIndent('', false);

	assert.equal(formatRoamMarkdownLine('Roam Bullet 1', indent, true), '* Roam Bullet 1');
	assert.equal(formatRoamMarkdownLine('Roam Bullet 2', indent, true), '* Roam Bullet 2');
});

test('uses tab indentation for nested Roam bullets', () => {
	const firstLevelIndent = getRoamChildIndent('', false);
	const secondLevelIndent = getRoamChildIndent(firstLevelIndent, true);
	const thirdLevelIndent = getRoamChildIndent(secondLevelIndent, true);

	assert.equal(formatRoamMarkdownLine('Roam Bullet 2.1', secondLevelIndent, true), '\t* Roam Bullet 2.1');
	assert.equal(formatRoamMarkdownLine('Roam Bullet 2.1.1', thirdLevelIndent, true), '\t\t* Roam Bullet 2.1.1');
});

test('keeps page-level markdown unbulleted', () => {
	assert.equal(formatRoamMarkdownLine('# Page heading', '', false), '# Page heading');
});
