/**
 * The Roam importer against a vault.
 *
 * The conversion tests drive the converter alone, so what they cannot see is
 * the half that decides where a graph lands and what a link to another page
 * inside it looks like. That is where the paths went wrong (#276, #246, #247):
 * the graph folder was built by joining the output folder's path to the graph
 * name, and the top of a vault has the path `/`, so every generated link began
 * with a slash that belonged to nothing.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RoamJSONImporter } from '../../src/formats/roam-json';
import { ImportContext } from '../../src/import-context';
import { PickedFile } from '../../src/filesystem';
import { MemoryVault, memoryApp } from '../shims/vault';

/** A graph in memory, named the way a picked file would be. */
function graphFile(basename: string, pages: unknown[]): PickedFile {
	return {
		type: 'file',
		fullpath: `${basename}.json`,
		name: `${basename}.json`,
		basename,
		extension: 'json',
		readText: async () => JSON.stringify(pages),
	} as PickedFile;
}

/**
 * The importer, ready to run. `outputLocation` is left to the caller: an empty
 * one is the top of the vault, which is the case that produced the `//`.
 */
async function importer(outputLocation: string) {
	const vault = new MemoryVault();
	const subject = new RoamJSONImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	await subject.ready;
	subject.outputLocation = outputLocation;
	subject.indexImportedNotes();

	return { vault, subject };
}

/** Two pages, the second referring to a block on the first. */
const referringGraph = [
	{
		title: 'Source', uid: 'source-page', children: [
			{ string: 'the block being referred to', uid: 'sourceblk' },
		],
	},
	{
		title: 'Referring', uid: 'referring-page', children: [
			{ string: 'see ((sourceblk)) for the details', uid: 'referblk' },
		],
	},
];

test('a graph imported to the top of the vault writes its links without a leading slash', async () => {
	const { vault, subject } = await importer('');
	subject.files = [graphFile('MyGraph', referringGraph)];

	await subject.import(new ImportContext());

	const referring = vault.contents.get('MyGraph/Referring.md');
	assert.ok(typeof referring === 'string', 'the referring page should have been written');
	assert.ok(!referring.includes('//'), `the link should not begin with a slash: ${referring}`);
});

test('and the same graph under an output folder is written under it', async () => {
	const { vault, subject } = await importer('Roam');
	subject.files = [graphFile('MyGraph', referringGraph)];

	await subject.import(new ImportContext());

	assert.ok(vault.contents.has('Roam/MyGraph/Referring.md'), `written: ${vault.paths().join(', ')}`);
});
