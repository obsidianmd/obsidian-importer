/**
 * What the template leaves behind, and what is written instead.
 *
 * The recordings cover the shapes an ENEX produces; these are the ones a note
 * can arrive in that no fixture here has - a block that is not YAML, a note
 * that starts with a thematic break rather than a block at all.
 */
import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { standardizeFrontMatter } from '../../src/formats/evernote/utils/front-matter';

test('a block with nothing in it is dropped', () => {
	assert.equal(standardizeFrontMatter('---\n---\nThe note\n'), 'The note\n');
});

test('properties are written the way the vault writes them', () => {
	assert.equal(
		standardizeFrontMatter('---\n\ntags: \n  - one\n  - two\n\nsource: https://example.com\n---\nThe note\n'),
		'---\ntags:\n  - one\n  - two\nsource: https://example.com\n---\nThe note\n');
});

test('a note with no block of its own is left alone', () => {
	assert.equal(standardizeFrontMatter('The note\n\n---\n\nand more\n'), 'The note\n\n---\n\nand more\n');
});

test('a block that is not YAML is left as it was', () => {
	const note = '---\ntags: [one\n---\nThe note\n';

	assert.equal(standardizeFrontMatter(note), note);
});

test('a block that is a list rather than properties is left as it was', () => {
	const note = '---\n- one\n- two\n---\nThe note\n';

	assert.equal(standardizeFrontMatter(note), note);
});
