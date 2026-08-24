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
import { SourceZip, zipOf } from '../shims/zip';

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
				(1, 0, 1, 0, 0, 1, 2, 3, NULL, 'A note', '# A note\n![](photo%201.png)\n![](FILE-2/sketch.png)\n![](missing.png)\n![](assets/custom.png)\n\n#bear', 'NOTE-1');
			INSERT INTO ZSFNOTEFILE VALUES
				(1, 1, 0, 0, 'photo 1.png', 'FILE-1'),
				(2, NULL, 0, 0, 'sketch.png', 'FILE-2'),
				(3, 1, 0, 0, 'missing.png', 'FILE-3');
		`);
		return database.export();
	}
	finally {
		database.close();
	}
}

async function sharedUnownedAttachmentDatabase(): Promise<Uint8Array> {
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
				(1, 0, 0, 0, 0, 1, 2, NULL, NULL, 'First', '# First\n![](FILE-X/shared.png)', 'NOTE-1'),
				(2, 0, 0, 0, 0, 1, 2, NULL, NULL, 'Second', '# Second\n![](FILE-X/shared.png)', 'NOTE-2');
			INSERT INTO ZSFNOTEFILE VALUES
				(1, NULL, 0, 0, 'shared.png', 'FILE-X');
		`);
		return database.export();
	}
	finally {
		database.close();
	}
}

async function importFiles(files: SourceZip[]): Promise<{ vault: MemoryVault, ctx: ImportContext }> {
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
	subject.files = files;
	subject.outputLocation = 'Import';
	subject.indexImportedNotes();

	const ctx = new ImportContext();
	await subject.import(ctx);
	await subject.finalizeMarkdownOutput(ctx);
	return { vault, ctx };
}

test('imports an Application Data zip through the Bear importer', async () => {
	const { vault, ctx } = await importFiles([await zipOf({
		'Application Data/database.sqlite': await applicationDatabase(),
		'Application Data/Local Files/Note Images/FILE-1/photo 1.png': new Uint8Array([1, 2, 3]),
		'Application Data/Local Files/Note Images/FILE-2/sketch.png': new Uint8Array([4, 5, 6]),
	}, 'ApplicationData.zip')]);

	assert.deepEqual(vault.paths(), [
		'Import/archive/A note.md',
		'photo 1.png',
		'sketch.png',
	]);
	const note = vault.contents.get('Import/archive/A note.md') as string;
	assert.match(note, /bear-id: NOTE-1/);
	assert.match(note, /!\[\]\(photo%201\.png\)/);
	assert.match(note, /!\[\]\(sketch\.png\)/);
	assert.match(note, /!\[\]\(missing\.png\)/);
	assert.match(note, /!\[\]\(assets\/custom\.png\)/);
	assert.doesNotMatch(note, /NOTE-1\.textbundle|assets\/FILE-/);
	assert.deepEqual(new Uint8Array(vault.contents.get('photo 1.png') as ArrayBuffer), new Uint8Array([1, 2, 3]));
	assert.deepEqual(new Uint8Array(vault.contents.get('sketch.png') as ArrayBuffer), new Uint8Array([4, 5, 6]));
	assert.deepEqual(ctx.skipped, ['FILE-3/missing.png']);
	assert.equal(ctx.log.find(entry => entry.name === 'FILE-3/missing.png')?.reason,
		'the attachment is missing from the export');
});

test('a broken Application Data database does not prevent later backups from importing', async () => {
	const broken = await zipOf({
		'Application Data/database.sqlite': new Uint8Array([1, 2, 3]),
	}, 'Broken.zip');
	const valid = await zipOf({
		'Application Data/database.sqlite': await applicationDatabase(),
		'Application Data/Local Files/Note Images/FILE-1/photo 1.png': new Uint8Array([1, 2, 3]),
		'Application Data/Local Files/Note Images/FILE-2/sketch.png': new Uint8Array([4, 5, 6]),
	}, 'Valid.zip');

	const { vault, ctx } = await importFiles([broken, valid]);

	assert.deepEqual(ctx.failed, ['Broken.zip']);
	assert.ok(vault.paths().includes('Import/archive/A note.md'));
});

test('writes an unowned attachment only once when two notes reference it', async () => {
	const { vault, ctx } = await importFiles([await zipOf({
		'Application Data/database.sqlite': await sharedUnownedAttachmentDatabase(),
		'Application Data/Local Files/Note Images/FILE-X/shared.png': new Uint8Array([1, 2, 3]),
	}, 'ApplicationData.zip')]);

	assert.deepEqual(vault.paths(), [
		'Import/First.md',
		'shared.png',
		'Import/Second.md',
	]);
	assert.match(vault.contents.get('Import/First.md') as string, /!\[\]\(shared\.png\)/);
	assert.match(vault.contents.get('Import/Second.md') as string, /!\[\]\(shared\.png\)/);
	assert.deepEqual(ctx.failed, []);
	assert.equal(ctx.attachments, 1);
});

test('writes a repeated Application Data attachment only once across selected exports', async () => {
	const first = await zipOf({
		'Application Data/database.sqlite': await sharedUnownedAttachmentDatabase(),
		'Application Data/Local Files/Note Images/FILE-X/shared.png': new Uint8Array([1, 2, 3]),
	}, 'First.zip');
	const second = await zipOf({
		'Application Data/database.sqlite': await sharedUnownedAttachmentDatabase(),
		'Application Data/Local Files/Note Images/FILE-X/shared.png': new Uint8Array([1, 2, 3]),
	}, 'Second.zip');

	const { vault, ctx } = await importFiles([first, second]);

	assert.ok(vault.paths().includes('shared.png'));
	assert.deepEqual(ctx.failed, []);
	assert.equal(ctx.attachments, 1);
});

test('writes a repeated bear2bk attachment only once across selected exports', async () => {
	const first = await zipOf({
		'NOTE.textbundle/text.md': '# First\n![](assets/shared.png)',
		'NOTE.textbundle/assets/shared.png': new Uint8Array([1, 2, 3]),
	}, 'First.bear2bk');
	const second = await zipOf({
		'NOTE.textbundle/text.md': '# First\n![](assets/shared.png)',
		'NOTE.textbundle/assets/shared.png': new Uint8Array([1, 2, 3]),
	}, 'Second.bear2bk');

	const { vault, ctx } = await importFiles([first, second]);

	assert.ok(vault.paths().includes('shared.png'));
	assert.deepEqual(ctx.failed, []);
	assert.equal(ctx.attachments, 1);
});
