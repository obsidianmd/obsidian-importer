import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getNextFilenameIndex } from '../../src/formats/evernote/utils/filename-dedupe';

function indexFor(existing: string[], prefix: string): number {
	return getNextFilenameIndex(existing, prefix);
}

function nameFor(existing: string[], prefix: string): string {
	const index = indexFor(existing, prefix);
	return `${index === 0 ? prefix : `${prefix}.${index}`}.md`;
}

function alreadyThere(existing: string[], candidate: string): boolean {
	return existing.some(file => file.toLowerCase() === candidate.toLowerCase());
}

test('a title differing only in case does not take the other one', () => {
	const existing = ['Sales.md'];

	assert.equal(nameFor(existing, 'sales'), 'sales.1.md');
	assert.ok(!alreadyThere(existing, nameFor(existing, 'sales')));
});

test('a gap in the numbering is filled rather than landed on', () => {
	const existing = ['sales.md', 'sales.2.md'];

	assert.equal(nameFor(existing, 'sales'), 'sales.1.md');
	assert.ok(!alreadyThere(existing, nameFor(existing, 'sales')));
});

test('a note whose title merely ends with another does not push its numbering', () => {
	assert.equal(nameFor(['Q3 sales.1.md'], 'sales'), 'sales.md');
});

test('a numbered copy is recognised through the zettelkasten title', () => {
	assert.equal(indexFor(['202601011230.md', '202601011230.1 Project.md'], '202601011230'), 2);
});

test('an empty folder leaves the title alone', () => {
	assert.equal(nameFor([], 'sales'), 'sales.md');
});
