import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ImportedPathIndex, normalizeTreePath, parentTreePath, resolveTreePath } from '../../src/imported-path-index';

test('source paths resolve by exact case before folded fallback', () => {
	const paths = new ImportedPathIndex<{ path: string }>();
	const upper = { path: 'Import/A.md' };
	const lower = { path: 'Import/a 1.md' };

	paths.remember('A.md', upper);
	paths.remember('a.md', lower);

	assert.equal(paths.get('A.md'), upper);
	assert.equal(paths.get('a.md'), lower);
	assert.equal(paths.get('A.MD'), null);
});

test('a unique path can resolve through different casing', () => {
	const paths = new ImportedPathIndex<{ path: string }>();
	const file = { path: 'Import/Journal/Day.md' };

	paths.remember('Journal/Day.md', file);

	assert.equal(paths.get('journal/day.md'), file);
	assert.equal(paths.sourceFor('IMPORT/JOURNAL/DAY.MD'), 'Journal/Day.md');
});

test('clearing removes both source and output lookups', () => {
	const paths = new ImportedPathIndex<{ path: string }>();
	paths.remember('Note.md', { path: 'Import/Note.md' });

	paths.clear();

	assert.equal(paths.get('Note.md'), null);
	assert.equal(paths.sourceFor('Import/Note.md'), null);
});

test('tree paths normalize separators and cannot escape their root', () => {
	assert.equal(normalizeTreePath('Notes\\Journal/../Day.md'), 'Notes/Day.md');
	assert.equal(resolveTreePath('Notes/Journal', '../../../../../Index.md'), 'Index.md');
	assert.equal(parentTreePath('Notes/Journal/Day.md'), 'Notes/Journal');
});
