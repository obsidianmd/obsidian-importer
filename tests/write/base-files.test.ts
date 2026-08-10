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
import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { parseYaml, stringifyYaml } from 'obsidian';

import { createBaseFile } from '../../src/formats/notion-api/database-helpers';
import { mergedBaseViews } from '../../src/formats/airtable-api/base-file';
import { AirtableAPIImporter } from '../../src/formats/airtable-api';
import { DuplicateHandling } from '../../src/format-importer';
import { MemoryVault, memoryApp } from '../shims/vault';

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

/** The Airtable writer itself, rather than the merge it delegates to. */
class WritingBases extends AirtableAPIImporter {
	write(viewNames = ['All books']): Promise<Map<string, string>> {
		return this.createBaseFile({
			tableFolderPath: 'Airtable/Books',
			tableName: 'Books',
			views: viewNames.map((name, nth) => ({ id: `viw00000000000000${nth}`, name, type: 'grid' })) as never,
			fields: [{ id: 'fldName0000000001', name: 'Name', type: 'singleLineText' } as never],
			primaryFieldId: 'fldName0000000001',
			formulas: new Map(),
		});
	}
}

async function airtableBase(vault: MemoryVault, mode: DuplicateHandling): Promise<WritingBases> {
	const subject = new WritingBases(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = mode;
	subject.indexImportedNotes();

	return subject;
}

// Beside the table's folder, not inside it, which is where buildBaseFile puts it.
const BASE_PATH = 'Airtable/Books.base';

test('Airtable writes one .base for a table, in every mode', async () => {
	for (const mode of [DuplicateHandling.CreateCopy, DuplicateHandling.Skip, DuplicateHandling.Update]) {
		const vault = new MemoryVault();
		await vault.createFolder('Airtable');
		await vault.createFolder('Airtable/Books');

		const subject = await airtableBase(vault, mode);
		await subject.write();
		await subject.write();

		assert.deepEqual(vault.paths().filter(path => path.endsWith('.base')), [BASE_PATH], mode);
	}
});

// The setting is about notes. Whichever the user picked, the .base is brought
// up to date and the view they added themselves survives it.
test('and keeps the user\'s own view in every mode, including "Skip"', async () => {
	for (const mode of [DuplicateHandling.CreateCopy, DuplicateHandling.Skip, DuplicateHandling.Update]) {
		const vault = new MemoryVault();
		await vault.createFolder('Airtable');
		await vault.createFolder('Airtable/Books');

		const subject = await airtableBase(vault, mode);
		await subject.write();

		const mine = parseYaml(String(vault.contents.get(BASE_PATH)));
		mine.views.push({ type: 'table', name: 'My shortlist' });
		await vault.adapter.write(BASE_PATH, stringifyYaml(mine));

		// The table has gained a view since. The .base has to show it, which is
		// what says the file was regenerated rather than simply left alone.
		await subject.write(['All books', 'By author']);

		const after = parseYaml(String(vault.contents.get(BASE_PATH)));
		assert.deepEqual(
			(after.views as { name: string }[]).map(view => view.name).sort(),
			['All books', 'By author', 'My shortlist'],
			mode
		);
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
