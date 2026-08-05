/**
 * The Apple Notes conversion, outside Obsidian.
 *
 * A note is a gzipped protobuf in a Core Data database, so the fixture is a
 * database built for the purpose rather than a captured one - see store.ts for
 * what that does and does not check.
 *
 * The vault is stood in for: an attachment resolves to a fixed path rather than
 * being copied anywhere, and a link is written in the plain wiki form. What is
 * recorded is the markdown the converter produces for each note.
 *
 * A real database can be dropped into local/, which is gitignored, and it is
 * converted the same way - its recordings stay in local/expected/.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as nodeZlib from 'node:zlib';

import { Root } from 'protobufjs';

import { provideNodeModules } from '../../src/filesystem';
import { NoteConverter } from '../../src/formats/apple-notes/convert-note';
import { descriptor } from '../../src/formats/apple-notes/descriptor';
import {
	ANAttachment,
	ANContext,
	ANConverter,
	ANConverterType,
	ANFile,
	ANStyleType,
	SQLiteTagSpawned,
} from '../../src/formats/apple-notes/models';
import { expectedFor, expectTree, fixtures } from '../helpers';
import { buildStore, NoteSpec, StoreSpec } from './store';

provideNodeModules({ zlib: nodeZlib });

const FIXTURES = __dirname;

const protobufRoot = Root.fromJSON(descriptor);

/**
 * What the converter needs from outside the note: the database it came from,
 * and a vault. The vault here writes nothing - an attachment resolves to where
 * the importer would have put it, and that is what gets linked.
 */
function context(database: SQLiteTagSpawned, options: Partial<ANContext> = {}): ANContext {
	const ctx: ANContext = {
		omitFirstLine: true,
		includeHandwriting: false,
		database,

		decodeData<T extends ANConverter>(hexdata: string, converterType: ANConverterType<T>): T {
			const unzipped = nodeZlib.unzipSync(Buffer.from(hexdata, 'hex'));
			const decoded = protobufRoot.lookupType(converterType.protobufType).decode(unzipped);
			return new converterType(ctx, decoded);
		},

		resolveAttachment: async (id: number) => ({ path: `Apple Notes/Attachments/${id}.png` }),
		resolveNote: async (id: number) => ({ path: `Apple Notes/Note ${id}.md` }),

		linkTo: (file: ANFile, _sourcePath: string, _subpath?: string, display?: string) =>
			display ? `[[${file.path}|${display}]]` : `[[${file.path}]]`,

		...options,
	};

	return ctx;
}

/** Convert every note in a database, as the importer walks them. */
async function convertStore(database: SQLiteTagSpawned, ctx: ANContext): Promise<Map<string, string>> {
	const keys = Object.fromEntries(
		(await database.all`SELECT z_ent, z_name FROM z_primarykey`).map(k => [k.Z_NAME, k.Z_ENT])
	);

	const notes = await database.all`
		SELECT
			nd.z_pk, hex(nd.zdata) AS zhexdata, zcso.ztitle1
		FROM
			zicnotedata AS nd,
			ziccloudsyncingobject AS zcso
		WHERE
			zcso.z_ent = ${keys.ICNote}
			AND zcso.ztitle1 IS NOT NULL
			AND nd.znote = zcso.z_pk
	`;

	const converted = new Map<string, string>();
	for (const note of notes) {
		const converter = ctx.decodeData(note.zhexdata as string, NoteConverter);
		converted.set(note.ZTITLE1 as string, await converter.format(false, `${note.ZTITLE1}.md`));
	}

	return converted;
}

/**
 * Notes covering what the converter knows how to do. One per feature, so a
 * recording that changes says which feature changed.
 */
const STORE: StoreSpec = {
	notes: [
		{
			title: 'Headings',
			runs: [
				{ text: 'Headings\n', style: ANStyleType.Title },
				{ text: 'A heading\n', style: ANStyleType.Heading },
				{ text: 'A subheading\n', style: ANStyleType.Subheading },
				{ text: 'Body text.\n' },
				{ text: 'const x = 1;\n', style: ANStyleType.Monospaced },
				{ text: 'const y = 2;\n', style: ANStyleType.Monospaced },
				{ text: 'After the code.', style: ANStyleType.Default },
			],
		},
		{
			title: 'Emphasis',
			runs: [
				{ text: 'Emphasis\n', style: ANStyleType.Title },
				{ text: 'bold', bold: true },
				{ text: ' and ' },
				{ text: 'italic', italic: true },
				{ text: ' and ' },
				{ text: 'both', bold: true, italic: true },
				{ text: '\n' },
				{ text: 'underlined', underlined: true },
				{ text: ' and ' },
				{ text: 'struck through', strikethrough: true },
				{ text: '\n' },
				{ text: 'x' },
				{ text: '2', baseline: 1 },
				{ text: ' and H' },
				{ text: '2', baseline: -1 },
				{ text: 'O\n' },
				{ text: 'highlighted', color: { red: 1, green: 0.9, blue: 0.2, alpha: 1 } },
			],
		},
		{
			title: 'Lists',
			runs: [
				{ text: 'Lists\n', style: ANStyleType.Title },
				{ text: 'First\n', style: ANStyleType.DottedList },
				{ text: 'Second\n', style: ANStyleType.DottedList },
				{ text: 'Nested\n', style: ANStyleType.DottedList, indent: 1 },
				{ text: 'Dashed\n', style: ANStyleType.DashedList },
				{ text: 'One\n', style: ANStyleType.NumberedList },
				{ text: 'Two\n', style: ANStyleType.NumberedList },
				{ text: 'Done\n', style: ANStyleType.Checkbox, checked: true },
				{ text: 'Not done', style: ANStyleType.Checkbox, checked: false },
			],
		},
		{
			title: 'Alignment and quotes',
			runs: [
				{ text: 'Alignment and quotes\n', style: ANStyleType.Title },
				{ text: 'Centred\n', alignment: 1 },
				{ text: 'Right\n', alignment: 2 },
				{ text: 'A quoted line.\n', blockquote: true },
				{ text: 'Back to normal.' },
			],
		},
		{
			title: 'Links and attachments',
			runs: [
				{ text: 'Links and attachments\n', style: ANStyleType.Title },
				{ text: 'A web link', link: 'https://example.com' },
				{ text: '\n' },
				{ text: '', attachment: { identifier: 'HASHTAG-1', uti: ANAttachment.Hashtag } },
				{ text: '\n' },
				{ text: '', attachment: { identifier: 'CARD-1', uti: ANAttachment.UrlCard } },
				{ text: '\n' },
				{ text: '', attachment: { identifier: 'LINK-1', uti: ANAttachment.InternalLink } },
				{ text: '\n' },
				{ text: '', attachment: { identifier: 'IMAGE-1', uti: 'public.png' } },
				{ text: '\n' },
				{ text: '', attachment: { identifier: 'NOTHING-1', uti: 'public.unrecognised' } },
			],
		},
	],
	attachments: [
		{ identifier: 'HASHTAG-1', uti: ANAttachment.Hashtag, altText: '#a-tag' },
		{ identifier: 'CARD-1', uti: ANAttachment.UrlCard, title: 'Example', url: 'https://example.com' },
		{ identifier: 'LINK-1', uti: ANAttachment.InternalLink, tokenContentIdentifier: 'applenotes:note/00000000-0000-0000-0000-000000000001' },
		{ identifier: 'IMAGE-1', uti: 'public.png', media: 42 },
		{ identifier: 'NOTHING-1', uti: 'public.unrecognised' },
		// What the internal link points at, found by its identifier
		{ identifier: '00000000-0000-0000-0000-000000000001', uti: 'note' },
	],
};

test('converts the notes in a built database', async () => {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), STORE);

	try {
		const converted = await convertStore(store.database, context(store.database));
		assert.equal(converted.size, STORE.notes.length);

		const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-md-'));
		try {
			for (const [title, markdown] of converted) {
				nodeFs.writeFileSync(nodePath.join(produced, `${title}.md`), markdown);
			}

			expectTree(produced, nodePath.join(FIXTURES, 'expected', 'built-store'), 'the built database');
		}
		finally {
			nodeFs.rmSync(produced, { recursive: true, force: true });
		}
	}
	finally {
		store.close();
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
});

test('keeps the first line when asked to', async () => {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const spec: StoreSpec = {
		notes: [{
			title: 'Headings',
			runs: [{ text: 'Headings\n', style: ANStyleType.Title }, { text: 'Body text.' }],
		}],
	};
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), spec);

	try {
		const kept = await convertStore(store.database, context(store.database, { omitFirstLine: false }));
		const dropped = await convertStore(store.database, context(store.database));

		assert.match(kept.get('Headings')!, /^# Headings/);
		assert.doesNotMatch(dropped.get('Headings')!, /^# Headings/);
	}
	finally {
		store.close();
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * A real database, if one has been dropped into local/. Nothing from it is
 * committed: local/ is gitignored, and so is the output recorded beside it.
 */
for (const database of fixtures(FIXTURES, '.sqlite')) {
	test(`converts ${database.name}`, async () => {
		assert.ok(database.local, 'a real notes database belongs in local/, which is not committed');

		// Opened through the same wrapper the built store uses, so the queries
		// the converter makes are the same ones
		const store = buildStore(':memory:', { notes: [] });
		store.close();

		const { DatabaseSync } = await import('node:sqlite');
		const db = new DatabaseSync(database.path, { readOnly: true });
		const wrapped = {
			get: async (strings: TemplateStringsArray, ...params: unknown[]) =>
				db.prepare(strings.join('?')).all(...params as never[])[0] as never,
			all: async (strings: TemplateStringsArray, ...params: unknown[]) =>
				db.prepare(strings.join('?')).all(...params as never[]) as never,
			close: () => db.close(),
		} as unknown as SQLiteTagSpawned;

		try {
			const converted = await convertStore(wrapped, context(wrapped));
			assert.ok(converted.size > 0, 'the database should hold notes');

			const produced = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-md-'));
			try {
				for (const [title, markdown] of converted) {
					nodeFs.writeFileSync(nodePath.join(produced, `${title.replace(/[/\\:]/g, '-')}.md`), markdown);
				}

				expectTree(produced, expectedFor(database, nodePath.basename(database.name, '.sqlite')), database.name);
			}
			finally {
				nodeFs.rmSync(produced, { recursive: true, force: true });
			}
		}
		finally {
			db.close();
		}
	});
}
