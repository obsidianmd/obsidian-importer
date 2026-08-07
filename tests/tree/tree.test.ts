/**
 * The tree selection the two API importers share.
 *
 * These pin what Airtable and the Notion API each did before they were pulled
 * together. The two were compared against each other first, by running the same
 * five steps through both in the app; they agreed on all of them, and what they
 * agreed on is what is asserted here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { areAllSelected, areAnySelected, setAllSelection, setNodeSelection, type SelectableNode } from '../../src/tree';

interface Node extends SelectableNode {
	id: string;
	children: Node[];
}

function node(id: string, children: Node[] = []): Node {
	return { id, children, selected: false, disabled: false };
}

/** The tree both importers were run against. */
function tree(): Node[] {
	return [
		node('a', [node('a1', [node('a1x')]), node('a2')]),
		node('b', [node('b1')]),
	];
}

/** Every node as "id:selected/disabled", which is how the two were compared. */
function state(nodes: Node[]): string {
	return nodes.map(n =>
		`${n.id}:${n.selected ? 'S' : '-'}${n.disabled ? 'D' : '-'}` +
		(n.children.length ? `(${state(n.children)})` : '')).join(',');
}

test('selecting everything disables what a selection carries with it', () => {
	const nodes = tree();
	setAllSelection(nodes, true);

	// A root keeps its own disabled state; everything under a selected node is
	// both selected and disabled
	assert.equal(state(nodes), 'a:S-(a1:SD(a1x:SD),a2:SD),b:S-(b1:SD)');
	assert.equal(areAllSelected(nodes), true);
});

test('deselecting everything frees it again', () => {
	const nodes = tree();
	setAllSelection(nodes, true);
	setAllSelection(nodes, false);

	assert.equal(state(nodes), 'a:--(a1:--(a1x:--),a2:--),b:--(b1:--)');
	assert.equal(areAllSelected(nodes), false);
});

test('ticking one node takes its subtree and nothing else', () => {
	const nodes = tree();
	setNodeSelection(nodes[0], true);

	assert.equal(state(nodes), 'a:S-(a1:SD(a1x:SD),a2:SD),b:--(b1:--)');
	assert.equal(areAllSelected(nodes), false);
});

test('unticking it hands the subtree back', () => {
	const nodes = tree();
	setNodeSelection(nodes[0], true);
	setNodeSelection(nodes[0], false);

	assert.equal(state(nodes), 'a:--(a1:--(a1x:--),a2:--),b:--(b1:--)');
});

test('deselect all reaches a subtree an ancestor had disabled', () => {
	// The one that needs the walk to continue past a disabled node: a1 and a1x
	// are disabled by a, and only unticking a can free them
	const nodes = tree();
	setNodeSelection(nodes[0], true);
	setAllSelection(nodes, false);

	assert.equal(state(nodes), 'a:--(a1:--(a1x:--),a2:--),b:--(b1:--)');
});

test('a node with no children is handled like any other', () => {
	const leaf = node('only');
	setNodeSelection(leaf, true);

	assert.equal(state([leaf]), 'only:S-');
	assert.equal(areAllSelected([leaf]), true);
});

test('children are optional, as one importer leaves them', () => {
	// Airtable's node type has children optional - a base that has not had its
	// tables fetched has none at all
	const nodes: SelectableNode[] = [{ selected: false, disabled: false }];

	setAllSelection(nodes, true);
	assert.equal(areAllSelected(nodes), true);
});

test('an empty tree counts as all selected, which names the button', () => {
	// What updateToggleButtonText asks before anything is loaded
	assert.equal(areAllSelected([]), true);
});

test('nothing is selected until something is, which is what Continue waits for', () => {
	const nodes = tree();

	assert.equal(areAnySelected(nodes), false);
	assert.equal(areAnySelected([]), false);

	// A leaf deep in the tree counts, not just a top-level one
	setNodeSelection(nodes[0].children[0].children[0], true);
	assert.equal(areAnySelected(nodes), true);
});

test('unticking the last thing leaves nothing selected again', () => {
	const nodes = tree();

	// Ticking a parent selects everything under it; unticking it frees them all
	setNodeSelection(nodes[0], true);
	assert.equal(areAnySelected(nodes), true);

	setNodeSelection(nodes[0], false);
	assert.equal(areAnySelected(nodes), false);
});
