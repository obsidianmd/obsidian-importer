/**
 * The outline flattener, on its own.
 *
 * The Roam tests drive it through that importer's conversion, which is what
 * checks the two fit together. These build the nodes by hand instead: the
 * module is meant to serve any importer whose source is an outline, so what it
 * decides has to be legible without knowing which one asked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { anchorLines, deOutline, OutlineNode } from '../../src/outline';

/** A node, with the parts an importer usually leaves empty filled in. */
function node(text: string | null, children: OutlineNode[] = [], anchor: string | null = null): OutlineNode {
	return { text, anchor, verbatim: null, children };
}

test('a block on its own is a paragraph', () => {
	assert.equal(deOutline([node('One thought'), node('Another')]), 'One thought\n\nAnother');
});

test('siblings that could each be an item are a list, under their parent', () => {
	assert.equal(deOutline([node('The shopping', [node('apples'), node('pears')])]),
		'The shopping\n\n- apples\n- pears');
});

test('but a single child is the same thought carried on, not a list of one', () => {
	assert.equal(deOutline([node('A claim', [node('and what follows')])]),
		'A claim\n\nand what follows');
});

test('a heading takes what is under it as its body', () => {
	assert.equal(deOutline([node('## Notes', [node('the body')])]), '## Notes\n\nthe body');
});

test('a heading is never an item, whatever stands beside it', () => {
	assert.equal(deOutline([node('# One', [node('a'), node('b')]), node('# Two')]),
		'# One\n\n- a\n- b\n\n# Two');
});

test('a list keeps its nesting, four spaces a level', () => {
	assert.equal(deOutline([node('Kinds', [
		node('fruit', [node('apple'), node('pear')]),
		node('vegetable'),
	])]), 'Kinds\n\n- fruit\n    - apple\n    - pear\n- vegetable');
});

test('tasks stay items, and consecutive ones are one list', () => {
	assert.equal(deOutline([node('[ ] first'), node('[x] second'), node('prose')]),
		'- [ ] first\n- [x] second\n\nprose');
});

test('a block the source left empty gives its place to what was under it', () => {
	assert.equal(deOutline([node(null, [node('the child')])]), 'the child');
	assert.equal(deOutline([node(null)]), '');
});

test('something verbatim stands at the margin, whatever depth it was at', () => {
	const table = { text: null, anchor: null, verbatim: '\n| a | b |\n| --- | --- |\n', children: [] };

	assert.equal(deOutline([node('Before'), table, node('After')]),
		'Before\n\n| a | b |\n| --- | --- |\n\nAfter');
});

test('an anchor rides along with the block it belongs to', () => {
	assert.equal(deOutline([node('the block', [], 'abc123')]), 'the block ^abc123');
});

/**
 * Where an anchor goes. Shared because every importer of an outline format has
 * to answer it the same way, and appending to a closing fence is wrong in a way
 * that reads as working.
 */
test('an anchor goes on the end of a block of one line', () => {
	assert.deepEqual(anchorLines(['the block'], 'abc123', ''), ['the block ^abc123']);
});

test('and on a line of its own for a block of several, off the closing fence', () => {
	assert.deepEqual(anchorLines(['```js', 'one();```'], 'abc123', '  '),
		['```js', 'one();```', '  ^abc123']);
});

test('a block nothing points at is left as it was', () => {
	assert.deepEqual(anchorLines(['the block'], null, ''), ['the block']);
});

/**
 * The top of a note is read as prose where the same blocks one level down are
 * a list. That is a decision rather than an oversight, so it is pinned here:
 * a note is a body of writing, and a run nested under something is a list of
 * things about it.
 *
 * The alternative was measured on a 1,107-page graph and on the fixtures. A
 * third of the pages there became one long bulleted list - and so did the
 * flattened Sapiens fixture, which came out identical to the outline it was
 * meant to flatten. Telling a list from a run of paragraphs on the shape of
 * the blocks alone cannot be done: an outliner gives both the same shape.
 */
test('the top of a note is prose, where the same blocks below it are a list', () => {
	const run = [node('[[Sapiens]]'), node('[[Dune]]'), node('[[Ubik]]')];

	assert.equal(deOutline(run), '[[Sapiens]]\n\n[[Dune]]\n\n[[Ubik]]');
	assert.equal(deOutline([node('## Reading', run)]),
		'## Reading\n\n- [[Sapiens]]\n- [[Dune]]\n- [[Ubik]]');
	assert.equal(deOutline([node('Reading', run)]),
		'Reading\n\n- [[Sapiens]]\n- [[Dune]]\n- [[Ubik]]');
});
