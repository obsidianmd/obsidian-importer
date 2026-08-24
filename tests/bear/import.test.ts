import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodePath from 'node:path';

import initSqlJs from 'sql.js';

import { provideNodeModules } from '../../src/filesystem';
import { Bear2bkImporter } from '../../src/formats/bear-bear2bk';
import { ImportContext } from '../../src/import-context';
import { parseFrontMatterBlock, serializeFrontMatter } from '../../src/util';
import { indexedApp, MemoryVault } from '../shims/vault';
import { zipOf } from '../shims/zip';

provideNodeModules({ path: nodePath });

async function applicationDatabase(): Promise<Uint8Array> {
	const SQL = await initSqlJs();
	const database = new SQL.Database();
	try {
		database.run(`
			CREATE TABLE ZSFNOTE (
				Z_PK INTEGER PRIMARY KEY,
				ZPERMANENTLYDELETED INTEGER,
				ZARCHIVED INTEGER,
				ZTRASHED INTEGER,
				ZENCRYPTED INTEGER,
				ZCREATIONDATE REAL,
				ZMODIFICATIONDATE REAL,
				ZARCHIVEDDATE REAL,
				ZTRASHEDDATE REAL,
				ZTITLE TEXT,
				ZTEXT TEXT,
				ZUNIQUEIDENTIFIER TEXT
			);
			CREATE TABLE ZSFNOTEFILE (
				Z_PK INTEGER PRIMARY KEY,
				ZNOTE INTEGER,
				ZPERMANENTLYDELETED INTEGER,
				ZUNUSED INTEGER,
				ZFILENAME TEXT,
				ZUNIQUEIDENTIFIER TEXT
			);
			INSERT INTO ZSFNOTE VALUES
				(1, 0, 1, 0, 0, 1, 2, 3, NULL, 'A note', '# A note\n![](photo%201.png)\n\n#bear', 'NOTE-1');
			INSERT INTO ZSFNOTEFILE VALUES
				(1, 1, 0, 0, 'photo 1.png', 'FILE-1');
		`);
		return database.export();
	}
	finally {
		database.close();
	}
}

test('imports an Application Data zip through the Bear importer', async () => {
	const vault = new MemoryVault();
	(vault as never as {
		append(file: { path: string }, text: string, options: Record<string, number | undefined>): Promise<void>;
		process(file: { path: string }, change: (content: string) => string, options: Record<string, number | undefined>): Promise<void>;
	}).append = async (file, text, options) => {
		await vault.modify(file, (vault.contents.get(file.path) as string) + text, options);
	};
	(vault as never as {
		process(file: { path: string }, change: (content: string) => string, options: Record<string, number | undefined>): Promise<void>;
	}).process = async (file, change, options) => {
		await vault.modify(file, change(vault.contents.get(file.path) as string), options);
	};
	const app = indexedApp(vault) as never as {
		fileManager: {
			processFrontMatter(file: { path: string }, change: (frontmatter: Record<string, unknown>) => void): Promise<void>;
		};
	};
	app.fileManager.processFrontMatter = async (file, change) => {
		const parsed = parseFrontMatterBlock(vault.contents.get(file.path) as string);
		const frontmatter = parsed?.frontMatter ?? {};
		change(frontmatter);
		await vault.modify(file, serializeFrontMatter(frontmatter) + (parsed?.body ?? vault.contents.get(file.path)));
	};
	const subject = new Bear2bkImporter(app as never, {
		sourceEl: null,
		outputEl: null,
		optionsEl: null,
		plugin: null,
		importerId: 'bear',
		abortController: new AbortController(),
	} as never);
	await subject.ready;
	subject.files = [await zipOf({
		'Application Data/database.sqlite': await applicationDatabase(),
		'Application Data/Local Files/Note Images/FILE-1/photo 1.png': new Uint8Array([1, 2, 3]),
	}, 'ApplicationData.zip')];
	subject.outputLocation = 'Import';
	subject.indexImportedNotes();

	const ctx = new ImportContext();
	await subject.import(ctx);
	await subject.finalizeMarkdownOutput(ctx);

	assert.deepEqual(vault.paths(), [
		'Import/archive/A note.md',
		'photo 1.png',
	]);
	assert.match(vault.contents.get('Import/archive/A note.md') as string, /bear-id: NOTE-1/);
	assert.match(vault.contents.get('Import/archive/A note.md') as string, /!\[\]\(photo%201\.png\)/);
	assert.doesNotMatch(vault.contents.get('Import/archive/A note.md') as string, /assets\/FILE-1/);
	assert.deepEqual(new Uint8Array(vault.contents.get('photo 1.png') as ArrayBuffer), new Uint8Array([1, 2, 3]));
});
