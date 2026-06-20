import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseNotionNumberPropertyValue } from '../../src/formats/notion/property-values';

test('plain Notion number properties stay numeric', () => {
	assert.equal(parseNotionNumberPropertyValue('67.3'), 67.3);
	assert.equal(parseNotionNumberPropertyValue(' -42 '), -42);
});

test('formatted Notion number properties are preserved as text', () => {
	assert.equal(parseNotionNumberPropertyValue('R$67.3'), 'R$67.3');
	assert.equal(parseNotionNumberPropertyValue('$1,234.56'), '$1,234.56');
});
