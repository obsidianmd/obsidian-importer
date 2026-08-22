/**
 * What the page picker offers, given what the API says the integration can see.
 *
 * The importer asks /v1/search for everything and turns the flat answer into
 * the tree the user ticks through. Which items reach that tree is where the
 * reports of missing pages land - a database that is itself a top-level page
 * (#590), a database nested in a page, an inline one that should not appear at
 * all - and none of it could be checked while it lived on the importer.
 *
 * Recorded here is the tree, drawn as an outline. A page that stops appearing,
 * or starts, is a line moving in that outline.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { buildTree, collectItems, type NotionTreeNode } from '../../src/formats/notion-api/discovery';
import { expectFile, expectedFor, type Fixture } from '../helpers';

const FIXTURE: Fixture = { name: 'example-search.json', path: nodePath.join(__dirname, 'example-search.json'), local: false };

const search = JSON.parse(nodeFs.readFileSync(FIXTURE.path, 'utf8')) as { results: any[] };

/** The tree as an outline, which is what makes a change to it readable. */
function outline(nodes: NotionTreeNode[], depth = 0): string[] {
	return nodes.flatMap(node => [
		`${'  '.repeat(depth)}${node.type === 'database' ? 'database' : 'page    '} ${node.title}`,
		...outline(node.children, depth + 1),
	]);
}

test('the fixture carries every parent the search returns', () => {
	const seen = new Set(search.results.map(item =>
		`${item.object}/${(item.object === 'data_source' ? item.database_parent : item.parent)?.type}`));

	for (const shape of [
		'page/workspace', 'page/page_id', 'page/data_source_id', 'page/block_id',
		'data_source/workspace', 'data_source/page_id', 'data_source/block_id',
	]) {
		assert.ok(seen.has(shape), `expected the fixture to include a ${shape}`);
	}
});

test('the tree the picker is given', () => {
	const tree = buildTree(collectItems(search.results));

	expectFile(`${outline(tree).join('\n')}\n`, expectedFor(FIXTURE, 'example-search.txt'), FIXTURE.name);
});

test('a top-level database is offered, as one inside a page is', () => {
	const tree = buildTree(collectItems(search.results));
	const titles = tree.filter(node => node.type === 'database').map(node => node.title);

	// #590: a database that is itself a page in the sidebar reaches the picker
	// as a root, since a workspace parent is no parent at all.
	assert.ok(titles.includes('Reading list'), `a top-level database should be a root, got roots: ${titles.join(', ')}`);
});

test('an inline database and its rows are left out', () => {
	const items = collectItems(search.results);
	const titles = items.map(item => item.title);

	assert.ok(!titles.includes('An inline database'), 'a database in a block should be dropped');
	assert.ok(!titles.includes('A row of the inline database'), "a dropped database's rows should go with it");
	assert.ok(!titles.includes('A page inside a block'), 'a page in a block should be dropped');
});

test('a progressively rebuilt tree preserves selection and collapsed state', () => {
	const parent = { id: 'parent', title: 'Parent', type: 'page', parentId: null } as const;
	const child = { id: 'child', title: 'Child', type: 'page', parentId: 'parent' } as const;
	const first = buildTree([parent]);
	first[0].selected = true;
	first[0].collapsed = false;

	const next = buildTree([child, parent], first);

	assert.equal(next[0].selected, true);
	assert.equal(next[0].collapsed, false);
	assert.equal(next[0].children[0].selected, true, 'new descendants inherit a selected parent');
	assert.equal(next[0].children[0].disabled, true);
});

test('a selected child stays selected when its parent arrives later', () => {
	const child = { id: 'child', title: 'Child', type: 'page', parentId: 'parent' } as const;
	const parent = { id: 'parent', title: 'Parent', type: 'page', parentId: null } as const;
	const first = buildTree([child]);
	first[0].selected = true;

	const next = buildTree([parent, child], first);

	assert.equal(next[0].selected, false);
	assert.equal(next[0].children[0].selected, true);
	assert.equal(next[0].children[0].disabled, false);
});
