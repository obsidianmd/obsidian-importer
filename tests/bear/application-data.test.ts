/**
 * Bear's iPhone/iPad Application Data export is a zip containing a Core Data
 * SQLite database and an attachment tree. These tests exercise the database
 * boundary separately from the Obsidian writer, then inspect any local export
 * dropped beside the committed Bear fixtures.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import initSqlJs from 'sql.js';

import { provideNodeModules } from '../../src/filesystem';
import { prepareBearApplicationMarkdown, readBearApplicationDatabase } from '../../src/formats/bear/application-data';
import { convertBearNote } from '../../src/formats/bear/convert';
import { fixtures } from '../helpers';

provideNodeModules({ path: nodePath });

async function databaseFixture(): Promise<ArrayBuffer> {
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
		`);
		database.run(`
			INSERT INTO ZSFNOTE VALUES
				(1, 0, 1, 0, 0, 1, 2, 3, NULL, 'A note', '# A note\n![](photo%201.png)\n![](FILE-3/orphan.png)', 'NOTE-1'),
				(2, 0, 0, 1, 1, 4, 5, NULL, 6, 'Secret', NULL, 'NOTE-2'),
				(3, 1, 0, 0, 0, 7, 8, NULL, NULL, 'Deleted', 'gone', 'NOTE-3');
			INSERT INTO ZSFNOTEFILE VALUES
				(0, NULL, 0, 0, 'orphan.png', 'FILE-3'),
				(1, 1, 0, 0, 'photo 1.png', 'FILE-1'),
				(2, 1, 0, 1, 'unused.png', 'FILE-2');
		`);

		const bytes = database.export();
		return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	}
	finally {
		database.close();
	}
}

test('reads notes, metadata, and live attachments from Application Data', async () => {
	const notes = await readBearApplicationDatabase(await databaseFixture());

	assert.equal(notes.length, 2);
	assert.deepEqual(notes[0], {
		key: 1,
		id: 'NOTE-1',
		title: 'A note',
		text: '# A note\n![](photo%201.png)\n![](FILE-3/orphan.png)',
		ctime: 978307201000,
		mtime: 978307202000,
		archivedtime: 978307203000,
		trashedtime: undefined,
		encrypted: false,
		attachments: [
			{ id: 'FILE-3', filename: 'orphan.png' },
			{ id: 'FILE-1', filename: 'photo 1.png' },
		],
	});
	assert.equal(notes[1].encrypted, true);
	assert.equal(notes[1].trashedtime, 978307206000);
});

test('rewrites only known local attachment targets for the Bear converter', async () => {
	const [note] = await readBearApplicationDatabase(await databaseFixture());
	note.attachments.push({ id: 'FILE-4', filename: 'diagram (final).png' });
	note.text += '\n![](diagram%20(final).png)\n[site](https://bear.app/)\n![](missing.png)';

	const prepared = prepareBearApplicationMarkdown(note);

	assert.equal(prepared.content,
		'# A note\n![](assets/FILE-1/photo%201.png)\n![](assets/FILE-3/orphan.png)\n![](assets/FILE-4/diagram%20%28final%29.png)\n[site](https://bear.app/)\n![](missing.png)');
	assert.deepEqual([...prepared.assets.keys()], [
		'NOTE-1.textbundle/assets/FILE-3/orphan.png',
		'NOTE-1.textbundle/assets/FILE-1/photo 1.png',
		'NOTE-1.textbundle/assets/FILE-4/diagram (final).png',
	]);
});

test('does not rewrite attachment examples inside inline or fenced code', () => {
	const prepared = prepareBearApplicationMarkdown({
		key: 1,
		id: 'NOTE-1',
		title: 'Examples',
		text: '![](photo.png)\n`![](photo.png)`\n```md\n![](photo.png)\n```',
		encrypted: false,
		attachments: [{ id: 'FILE-1', filename: 'photo.png' }],
	});

	assert.equal(prepared.content,
		'![](assets/FILE-1/photo.png)\n`![](photo.png)`\n```md\n![](photo.png)\n```');
});

test('same-named attachment links resolve in attachment-list order', () => {
	const prepared = prepareBearApplicationMarkdown({
		key: 1,
		id: 'NOTE-1',
		title: 'Duplicates',
		text: '![](photo.png)\n![](photo.png)',
		encrypted: false,
		attachments: [
			{ id: 'FILE-1', filename: 'photo.png' },
			{ id: 'FILE-2', filename: 'photo.png' },
		],
	});

	assert.equal(prepared.content,
		'![](assets/FILE-1/photo.png)\n![](assets/FILE-2/photo.png)');
});

for (const fixture of fixtures(__dirname, '.zip').filter(candidate => candidate.local)) {
	test(`reads local iOS export ${fixture.name}`, async () => {
		const reader = new ZipReader(new BlobReader(new Blob([nodeFs.readFileSync(fixture.path)])));
		try {
			const entries = await reader.getEntries();
			const database = entries.find(entry => /(?:^|\/)Application Data\/database\.sqlite$/i.test(entry.filename));
			assert.ok(database?.getData, 'expected Application Data/database.sqlite');

			const notes = await readBearApplicationDatabase(
				(await database.getData(new Uint8ArrayWriter())).buffer as ArrayBuffer
			);
			assert.ok(notes.length > 0, 'expected at least one Bear note');
			assert.ok(notes.some(note => note.attachments.length > 0), 'expected at least one note with an attachment');
			const sketch = notes.find(note => note.id === '5FCB5C31-AD3B-4219-90D1-65CF0CEA273D-7849-000007C0613F99DF');
			assert.ok(sketch?.attachments.some(attachment =>
				attachment.id === 'A34137F8-0D13-4C8B-B3D1-BBC86A14E509-7849-000007C081E622AD'
			), 'expected the note to adopt its unjoined, explicitly referenced sketch');

			const attachmentEntries = new Set(entries.map(entry =>
				entry.filename.split('/').slice(-2).join('/').normalize('NFC').toLocaleLowerCase('en')
			));
			let resolved = 0;
			for (const note of notes) {
				if (note.encrypted) continue;
				const prepared = prepareBearApplicationMarkdown(note);
				await convertBearNote(prepared.content, {
					basename: note.title,
					parent: `${note.id}.textbundle`,
					flattenTags: false,
					tagPlacement: 'inline',
					resolveAsset: async assetPath => {
						const attachment = prepared.assets.get(assetPath);
						assert.ok(attachment, `expected database attachment for ${assetPath}`);
						const key = `${attachment.id}/${attachment.filename}`
							.normalize('NFC').toLocaleLowerCase('en');
						assert.ok(attachmentEntries.has(key), `expected ${key} in the zip`);
						resolved++;
						return `Bear/${attachment.filename}`;
					},
				});
			}
			assert.ok(resolved > 0, 'expected at least one attachment link to resolve');
		}
		finally {
			await reader.close();
		}
	});
}
