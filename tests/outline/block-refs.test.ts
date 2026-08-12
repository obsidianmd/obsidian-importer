/**
 * The block index every outliner importer builds.
 *
 * What it is for is the two answers a reference needs - where is this block,
 * and does anything point at it - kept apart, because only the second decides
 * whether an anchor is written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BlockIndex } from '../../src/block-refs';
import { outsideCodeSpans } from '../../src/markdown';

test('a block that was defined can be found again', () => {
	const index = new BlockIndex();
	index.define('abc123', 'Notes');

	assert.deepEqual(index.resolve('abc123'), { page: 'Notes', anchor: 'abc123' });
	assert.equal(index.resolve('nosuch'), null);
});

test('an id the format writes long carries the anchor to be written instead', () => {
	// A uuid is legal but unreadable as an anchor, so an importer shortens it
	// and the index remembers both halves of the pairing.
	const index = new BlockIndex();
	index.define('6a0f2c1e-6c4c-4c1a-9f0e-2b8d3a1c7e55', 'Notes', '6a0f2c');

	assert.deepEqual(index.resolve('6a0f2c1e-6c4c-4c1a-9f0e-2b8d3a1c7e55'),
		{ page: 'Notes', anchor: '6a0f2c' });
});

test('only a block something points at needs an anchor', () => {
	const index = new BlockIndex();
	index.define('pointed', 'Notes');
	index.define('alone', 'Notes');
	index.mention('pointed');

	assert.equal(index.isReferenced('pointed'), true);
	assert.equal(index.isReferenced('alone'), false, 'nothing reaches for it');
});

test('and a mention of something that is not a block is not one', () => {
	// `((a passing thought))` reads as a reference in these formats and is
	// nobody's id, so it must not put an anchor anywhere.
	const index = new BlockIndex();
	index.mention('a passing thought');

	assert.equal(index.isReferenced('a passing thought'), false);
	assert.equal(index.has('a passing thought'), false);
});

test('a rewrite skips what stands inside backticks', () => {
	const shout = (segment: string) => segment.toUpperCase();

	assert.equal(outsideCodeSpans('rewrite me `but not me` and me', shout),
		'REWRITE ME `but not me` AND ME');
});

test('and leaves text with no code spans entirely to the rewrite', () => {
	assert.equal(outsideCodeSpans('all of it', segment => segment.toUpperCase()), 'ALL OF IT');
});
