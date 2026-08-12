import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { expandDropped, NodePickedFile, NodePickedFolder, provideNodeModules } from '../../src/filesystem';

provideNodeModules({ fs: nodeFs as never, path: nodePath });

const TEXTBUNDLES = nodePath.join(__dirname, '..', 'textbundle');

test('a dropped file is offered as it arrived', async () => {
	const file = new NodePickedFile(nodePath.join(TEXTBUNDLES, 'example.textpack'));

	assert.deepEqual((await expandDropped([file])).map(f => f.name), ['example.textpack']);
});

test('a dropped folder with an extension stays whole, the way a picker hands over a package', async () => {
	const bundle = new NodePickedFolder(nodePath.join(TEXTBUNDLES, 'Textbundle Example v2.textbundle'));

	const files = await expandDropped([bundle]);
	assert.deepEqual(files.map(f => f.name), ['Textbundle Example v2.textbundle']);
	assert.equal(files[0].extension, 'textbundle');
});

test('a folder is walked however its name is spelled, dot and all', async () => {
	const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'dropped-'));

	try {
		const exported = nodePath.join(root, 'Evernote.2026');
		nodeFs.mkdirSync(exported);
		nodeFs.writeFileSync(nodePath.join(exported, 'Notebook.enex'), '<en-export/>');

		const files = await expandDropped([new NodePickedFolder(exported)]);
		assert.deepEqual(files.map(f => f.name), ['Notebook.enex']);
	}
	finally {
		nodeFs.rmSync(root, { recursive: true, force: true });
	}
});

test('a dropped folder is walked, and the packages inside it survive the walk', async () => {
	const files = await expandDropped([new NodePickedFolder(TEXTBUNDLES)]);
	const names = files.map(f => f.name);

	assert.ok(names.includes('Textbundle Example v1.textbundle'), names.join(', '));
	assert.ok(names.includes('example.textpack'), names.join(', '));
	// Walked rather than listed: the tests beside the fixtures are in there too.
	assert.ok(names.includes('convert.test.ts'), names.join(', '));
	// The markdown inside a bundle is the bundle's business, not the drop's.
	assert.ok(!names.includes('text.markdown'), names.join(', '));
});
