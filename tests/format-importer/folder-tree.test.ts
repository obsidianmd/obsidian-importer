import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PickedFile } from '../../src/filesystem';
import {
	pickedFolderNodes,
	pickedFolderFileCount,
	pickedFolderSelection,
	PickedFolderNode,
	plannedPickedItems,
	isHiddenPickedItem,
} from '../../src/picked-folder-tree';
import { SourceFile, SourceFolder } from '../shims/picked';

test('builds a selectable folder tree with importer-defined file counts', async () => {
	const items = [
		new SourceFile('Root.md'),
		new SourceFile('image.png'),
		new SourceFolder('.chosen', [
			new SourceFile('Index.md'),
			new SourceFolder('.hidden', [new SourceFile('Secret.md')]),
		]),
		new SourceFolder('Docs', [
			new SourceFile('Page.md'),
			new SourceFile('image.png'),
			new SourceFolder('More', [new SourceFile('Other.md')]),
		]),
	];
	const countFile = (file: PickedFile) => file.extension === 'md';
	const nodes = await pickedFolderNodes(items, {
		includeFolder: (folder, chosen) => chosen || !isHiddenPickedItem(folder),
		countFile,
	});

	assert.deepEqual(nodes.map(node => ({
		title: node.title,
		path: node.path,
		files: node.files,
		collapsed: node.collapsed,
		children: node.children?.map(child => child.path),
	})), [
		{ title: '.chosen', path: '.chosen', files: 1, collapsed: false, children: [] },
		{ title: 'Docs', path: 'Docs', files: 2, collapsed: false, children: ['Docs/More'] },
	]);
	assert.equal(nodes[1].children?.[0].collapsed, true);
	assert.equal(pickedFolderFileCount(items, nodes, countFile), 4);
});

function folder(path: string, selected: boolean, children: PickedFolderNode[] = []): PickedFolderNode {
	return {
		title: path.slice(path.lastIndexOf('/') + 1),
		path,
		files: 0,
		selected,
		disabled: false,
		children,
	};
}

test('selection keeps selected descendants while skipping unwanted branches', () => {
	const nodes = [
		folder('A', false, [folder('A/One', true), folder('A/Two', false)]),
		folder('B', false, [folder('B/One', false)]),
	];

	const { included, skipped } = pickedFolderSelection(nodes);

	assert.deepEqual([...included!], ['A/One']);
	assert.deepEqual([...skipped], ['A/Two', 'B/One', 'B']);
});

test('an absent folder tree leaves source filtering disabled', () => {
	const { included, skipped } = pickedFolderSelection([]);

	assert.equal(included, null);
	assert.deepEqual([...skipped], []);
});

test('planning preserves truly empty folders without reproducing filtered trees', async () => {
	const planned = await plannedPickedItems([
		new SourceFolder('Docs', [
			new SourceFolder('Assets', [new SourceFile('logo.png')]),
			new SourceFolder('Empty', []),
			new SourceFile('Index.md'),
		]),
	], 'Import', {
		selection: pickedFolderSelection([]),
		includeFile: file => file.extension === 'md',
		includeFolder: () => true,
		folderPath: (folder, parent) => `${parent}/${folder.name}`,
		onFolder: () => {},
		shouldStop: async () => false,
		onError: (_item, error) => assert.fail(String(error)),
	});

	assert.deepEqual(planned.map(item => ({
		parent: item.parent,
		source: item.source,
		file: item.file?.name ?? null,
	})), [
		{ parent: 'Import/Docs/Empty', source: 'Docs/Empty', file: null },
		{ parent: 'Import/Docs', source: 'Docs/Index.md', file: 'Index.md' },
	]);
});
