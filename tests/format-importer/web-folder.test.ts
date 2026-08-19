/**
 * A directory input's flat list, put back into the folders it came from.
 *
 * The browser gives up the shape of what was chosen; every file carries the
 * path it had, and that is all there is to rebuild from.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PickedFile, PickedFolder, webPickedTree } from '../../src/filesystem';

function picked(path: string): File {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const file = new File(['x'], name);

	Object.defineProperty(file, 'webkitRelativePath', { value: path });
	return file;
}

async function shape(items: (PickedFile | PickedFolder)[]): Promise<unknown> {
	const drawn = [];

	for (const item of items) {
		drawn.push(item.type === 'file' ? item.name : { [item.name]: await shape(await item.list()) });
	}

	return drawn;
}

test('a chosen folder comes back as one item, with everything inside it', async () => {
	const tree = webPickedTree([
		picked('Notes/Index.md'),
		picked('Notes/cover.png'),
		picked('Notes/Journal/Day.md'),
		picked('Notes/Journal/Art/Sketch.png'),
	]);

	assert.equal(tree.length, 1);
	assert.deepEqual(await shape(tree), [{
		Notes: ['Index.md', 'cover.png', {
			Journal: ['Day.md', { Art: ['Sketch.png'] }],
		}],
	}]);
});

test('two notes of the same name in different folders both survive', async () => {
	const tree = webPickedTree([picked('Notes/A/Index.md'), picked('Notes/B/Index.md')]);
	const inside = await (tree[0] as PickedFolder).list();

	assert.deepEqual(inside.map(item => item.toString()), ['Notes/A', 'Notes/B']);
});

test('a file picked on its own stays at the top', async () => {
	const loose = new File(['x'], 'Loose.md');

	assert.deepEqual(await shape(webPickedTree([loose, picked('Notes/Index.md')])),
		['Loose.md', { Notes: ['Index.md'] }]);
});

test('a file keeps the path it was found at, for reporting', () => {
	const [folder] = webPickedTree([picked('Notes/Index.md')]);

	assert.equal(folder.toString(), 'Notes');
});
