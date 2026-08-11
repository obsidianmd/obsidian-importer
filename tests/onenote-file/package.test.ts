import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupsOf } from '../../src/formats/onenote-file/package';

test('a section at the top of a notebook is in no group', () => {
	assert.deepEqual(groupsOf('Week 1.one'), []);
	assert.deepEqual(groupsOf('.\\Week 1.one'), []);
});

test('a section inside section groups keeps them, outermost first', () => {
	// A Cabinet records a directory on the entry, with either separator.
	assert.deepEqual(groupsOf('Projects\\Roadmap.one'), ['Projects']);
	assert.deepEqual(groupsOf('Projects/Roadmap.one'), ['Projects']);
	assert.deepEqual(groupsOf('Work\\Projects\\Roadmap.one'), ['Work', 'Projects']);
});

test('an empty path segment is not a group', () => {
	assert.deepEqual(groupsOf('Work\\\\Roadmap.one'), ['Work']);
});
