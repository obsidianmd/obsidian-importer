import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getAvailableKeepMarkdownPath } from '../../src/formats/keep/paths';

test('resolves Google Keep note imports to a unique markdown path', () => {
	const files = new Set<string>(['Google Keep/Shopping.md']);

	const path = getAvailableKeepMarkdownPath(
		path => files.has(path),
		'Google Keep',
		'Shopping',
	);

	assert.equal(path, 'Google Keep/Shopping 1.md');
});

test('scopes Google Keep note imports to the output folder', () => {
	const files = new Set<string>(['Archive/Shopping.md']);

	const path = getAvailableKeepMarkdownPath(
		path => files.has(path),
		'Google Keep',
		'Shopping',
	);

	assert.equal(path, 'Google Keep/Shopping.md');
});

test('sanitizes Google Keep note filenames before resolving collisions', () => {
	const files = new Set<string>(['Google Keep/Untitled.md']);

	const path = getAvailableKeepMarkdownPath(
		path => files.has(path),
		'Google Keep',
		'???',
	);

	assert.equal(path, 'Google Keep/Untitled 1.md');
});
