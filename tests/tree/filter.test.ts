import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nodesMatching } from '../../src/tree';

interface Node {
	title: string;
	children?: Node[];
}

function tree(): Node[] {
	return [
		{ title: '2024 Taxes', children: [{ title: 'Receipts' }, { title: 'Mileage' }] },
		{ title: 'Recipes', children: [{ title: 'Dinners' }, { title: 'Tax-free lunches' }] },
		{ title: 'Reading list' },
	];
}

function kept(nodes: Node[], query: string): string[] {
	const matching = nodesMatching(nodes, query);
	const titles: string[] = [];

	const walk = (node: Node) => {
		if (matching.has(node)) titles.push(node.title);
		for (const child of node.children ?? []) walk(child);
	};

	for (const node of nodes) walk(node);
	return titles;
}

test('a match brings what is under it', () => {
	assert.deepEqual(kept(tree(), 'taxes'), ['2024 Taxes', 'Receipts', 'Mileage']);
});

test('a match brings the branch that leads down to it', () => {
	assert.deepEqual(kept(tree(), 'lunches'), ['Recipes', 'Tax-free lunches']);
});

test('a parent kept for one child does not bring the others', () => {
	assert.equal(kept(tree(), 'dinners').includes('Tax-free lunches'), false);
});

test('what is asked for is matched anywhere in the title, in any case', () => {
	assert.deepEqual(kept(tree(), '  TAX  '), [
		'2024 Taxes', 'Receipts', 'Mileage',
		'Recipes', 'Tax-free lunches',
	]);
});

test('nothing matching keeps nothing', () => {
	assert.deepEqual(kept(tree(), 'invoices'), []);
});

test('nobody asking is answered with nothing, not with everything', () => {
	assert.deepEqual(kept(tree(), ''), []);
	assert.deepEqual(kept(tree(), '   '), []);
});
