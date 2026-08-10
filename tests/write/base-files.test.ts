/**
 * What a second import does to a .base file.
 *
 * A .base is generated from a table or database schema rather than imported
 * from a note, so it is not something the "Existing notes" setting has an
 * opinion about: a stale view of a schema that has moved on is no use to
 * anyone, whatever the user chose for their notes. Both importers regenerate
 * it, and neither reads duplicateHandling to decide.
 *
 * Where they differ is what they keep. Notion replaces the file. Airtable
 * keeps any view the user added beside the imported ones, because a view is
 * something a person makes rather than something the schema says.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { parseYaml } from 'obsidian';

import { createBaseFile } from '../../src/formats/notion-api/database-helpers';
import { mergedBaseViews } from '../../src/formats/airtable-api/base-file';
import { MemoryVault } from '../shims/vault';

const SCHEMA = {
	Name: { id: 'title', name: 'Name', type: 'title' },
} as never;

async function writeBase(vault: MemoryVault, name: string): Promise<string> {
	return await createBaseFile({
		vault: vault as never,
		databaseName: name,
		databaseFolderPath: 'Notion/Roadmap',
		dataSourceProperties: SCHEMA,
	});
}

test('Notion writes one .base for a database, however many times it is imported', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');
	await vault.createFolder('Notion/Roadmap');

	const first = await writeBase(vault, 'Roadmap');
	const second = await writeBase(vault, 'Roadmap');

	assert.equal(first, 'Notion/Roadmap/Roadmap.base');
	assert.equal(second, first, 'the second import writes the same file, not "Roadmap 1.base"');
	assert.deepEqual(vault.paths().filter(path => path.endsWith('.base')), [first]);
});

test('and replaces what is in it with what the schema now says', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');
	await vault.createFolder('Notion/Roadmap');
	const path = await writeBase(vault, 'Roadmap');

	const generated = vault.contents.get(path);
	await vault.adapter.write(path, 'views: []\n# edited by hand\n');
	await writeBase(vault, 'Roadmap');

	assert.equal(vault.contents.get(path), generated);
});

test('a view the import brings replaces the one of that name', () => {
	const merged = mergedBaseViews(
		{ views: [{ type: 'table', name: 'All books' }] },
		[{ type: 'cards', name: 'All books' } as never],
	);

	assert.deepEqual(merged, [{ type: 'cards', name: 'All books' }]);
});

test('a view the user added is kept beside the imported ones', () => {
	const merged = mergedBaseViews(
		{ views: [{ type: 'table', name: 'My shortlist' }] },
		[{ type: 'table', name: 'All books' } as never],
	);

	assert.deepEqual(merged.map(view => view.name), ['My shortlist', 'All books']);
});

test('and a .base with no views yet is simply the imported ones', () => {
	const imported = [{ type: 'table', name: 'All books' } as never];

	assert.deepEqual(mergedBaseViews({ views: [] }, imported), imported);
});

// The file is the user's to edit, so it may be anything by the time an import
// meets it again. Nothing in it that is not a named view is carried over.
test('a .base edited into something unreadable is simply regenerated', () => {
	const imported = [{ type: 'table', name: 'All books' } as never];

	for (const existing of [null, undefined, 'not a config', 42, {}, { views: 'nope' }, { views: [null, { type: 'table' }] }]) {
		assert.deepEqual(mergedBaseViews(existing, imported), imported, JSON.stringify(existing));
	}
});

/** The code, without the prose around it. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// The policy in one assertion: no code path that writes a .base asks what the
// user chose for their notes. Said here rather than left to be noticed, so
// wiring the setting in has to be a decision rather than an accident.
test('neither importer decides a .base by the duplicate mode', () => {
	const sources = [
		'src/formats/notion-api/database-helpers.ts',
		'src/formats/airtable-api/base-file.ts',
	];

	for (const file of sources) {
		const code = withoutComments(nodeFs.readFileSync(nodePath.join(__dirname, '../..', file), 'utf8'));
		assert.doesNotMatch(code, /duplicateHandling|DuplicateHandling/, file);
	}
});

test('a generated .base is readable YAML', async () => {
	const vault = new MemoryVault();
	await vault.createFolder('Notion');
	await vault.createFolder('Notion/Roadmap');
	const path = await writeBase(vault, 'Roadmap');

	assert.ok(parseYaml(String(vault.contents.get(path))));
});
