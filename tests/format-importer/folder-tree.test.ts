import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickedFolderNodes, pickedFolderSelection, PickedFolderNode } from '../../src/picked-folder-tree';
import { SourceFile, SourceFolder } from '../shims/picked';

test('builds a selectable folder tree with importer-defined file counts', async () => {
	const nodes = await pickedFolderNodes([
		new SourceFolder('.chosen', [
			new SourceFile('Index.md'),
			new SourceFolder('.hidden', [new SourceFile('Secret.md')]),
		]),
		new SourceFolder('Docs', [
			new SourceFile('Page.md'),
			new SourceFile('image.png'),
			new SourceFolder('More', [new SourceFile('Other.md')]),
		]),
	], {
		includeFolder: (folder, parent) => !parent || !folder.name.startsWith('.'),
		countFile: file => file.extension === 'md',
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
