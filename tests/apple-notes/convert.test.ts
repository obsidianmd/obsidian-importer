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
import { buildStore, encodeNote, NoteSpec, StoreSpec } from './store';

provideNodeModules({ zlib: nodeZlib });

const FIXTURES = __dirname;

const protobufRoot = Root.fromJSON(descriptor);

/** What Shift-Return puts in the text: a line separator, not a paragraph end. */
const SOFT_RETURN = '\u2028';

/**
 * What the converter needs from outside the note: the database it came from,
 * and a vault. The vault here writes nothing - an attachment resolves to where
 * the importer would have put it, and that is what gets linked.
 */
function context(database: SQLiteTagSpawned, options: Partial<ANContext> = {}): ANContext {
	const ctx: ANContext = {
		omitFirstLine: true,
		includeHandwriting: false,
		strictLineBreaks: false,
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
				// Obsidian has no coloured text, so a colour is dropped rather than
				// carried over as a style Obsidian would not render
				{ text: 'coloured text', color: { red: 1, green: 0.9, blue: 0.2, alpha: 1 } },
				{ text: ' and ' },
				{ text: 'the default black', color: { red: 0, green: 0, blue: 0, alpha: 1 } },
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
		{
			title: 'Highlights',
			runs: [
				{ text: 'Highlights\n', style: ANStyleType.Title },
				{ text: 'purple', emphasis: 1 },
				{ text: ' and ' },
				{ text: 'pink', emphasis: 2 },
				{ text: ' and ' },
				{ text: 'orange', emphasis: 3 },
				{ text: ' and ' },
				{ text: 'mint', emphasis: 4 },
				{ text: ' and ' },
				{ text: 'blue', emphasis: 5 },
				{ text: '\n' },
				// A highlight is markdown, so it wraps whichever way the run is written
				{ text: 'bold', bold: true, emphasis: 1 },
				{ text: ' and ' },
				{ text: 'underlined', underlined: true, emphasis: 5 },
				{ text: ' and ' },
				{ text: 'linked', link: 'https://example.com', emphasis: 3 },
			],
		},
		// Last, so adding it leaves the primary keys the notes above were given:
		// an internal link is recorded as the key it points at
		{
			// A soft return breaks the line without starting a new bullet, so it
			// has to survive as a break rather than as the literal character
			title: 'Soft returns',
			runs: [
				{ text: 'Soft returns\n', style: ANStyleType.Title },
				{ text: `A paragraph${SOFT_RETURN}broken by a soft return.\n` },
				{ text: `First bullet${SOFT_RETURN}still the first bullet\n`, style: ANStyleType.DottedList },
				{ text: 'Second bullet', style: ANStyleType.DottedList },
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
 * The title is the first line with anything on it, so a note starting with
 * blank lines has it further down. Omitting "the first line" omitted a blank
 * one and left the title in the body as well as in the file name.
 */
test('a note starting with blank lines does not repeat its title', async () => {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), { notes: [] });

	try {
		const converter = context(store.database).decodeData(
			encodeNote({
				title: 'Android reviews',
				runs: [{ text: '\n\nAndroid reviews\n\nObsidian is a small team.' }],
			}).toString('hex'),
			NoteConverter
		);

		const body = await converter.format(false, 'Android reviews.md');

		assert.doesNotMatch(body, /Android reviews/, 'the file name holds the title; the body repeated it');
		assert.equal(body, 'Obsidian is a small team.');
	}
	finally {
		store.close();
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * A newline is the break a soft return meant, until the vault turns strict
 * line breaks on and it stops being one. Then it is spelled out.
 */
test('a soft return is spelled out when the vault has strict line breaks on', async () => {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), { notes: [] });

	const note = encodeNote({
		title: 'Soft returns',
		runs: [
			{ text: `A paragraph${SOFT_RETURN}broken by a soft return.\n` },
			{ text: `First bullet${SOFT_RETURN}still the first bullet`, style: ANStyleType.DottedList },
		],
	}).toString('hex');

	try {
		const relaxed = context(store.database, { omitFirstLine: false });
		assert.equal(
			await relaxed.decodeData(note, NoteConverter).format(false, 'Soft returns.md'),
			'A paragraph\nbroken by a soft return.\n- First bullet\n\tstill the first bullet'
		);

		const strict = context(store.database, { omitFirstLine: false, strictLineBreaks: true });
		assert.equal(
			await strict.decodeData(note, NoteConverter).format(false, 'Soft returns.md'),
			'A paragraph  \nbroken by a soft return.\n- First bullet  \n\tstill the first bullet'
		);
	}
	finally {
		store.close();
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * A title that is the first item of a list is the parent of what follows it.
 * Dropping it leaves those items with nothing to hang off, and the list with
 * an empty item in its place.
 */
test('a first line with a list nested under it is kept', async () => {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), { notes: [] });

	try {
		const ctx = context(store.database);

		const nested = ctx.decodeData(
			encodeNote({
				title: 'Airtable is for',
				runs: [
					{ text: 'Airtable is for\n', style: ANStyleType.DashedList, indent: 0 },
					{ text: 'databases', style: ANStyleType.DashedList, indent: 1 },
				],
			}).toString('hex'),
			NoteConverter
		);

		assert.equal(await nested.format(false, 'Airtable is for.md'), '- Airtable is for\n\t- databases');

		// A first item the rest are siblings of loses nothing by going
		const flat = ctx.decodeData(
			encodeNote({
				title: 'Price',
				runs: [
					{ text: 'Price\n', style: ANStyleType.NumberedList, indent: 0 },
					{ text: 'Quality', style: ANStyleType.NumberedList, indent: 0 },
				],
			}).toString('hex'),
			NoteConverter
		);

		assert.equal(await flat.format(false, 'Price.md'), '1. Quality');
	}
	finally {
		store.close();
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * Apple marks a real tag as an attachment, so a # left in the text is not one:
 * a Slack channel, a hashtag in some copy, "#s" for numbers. Obsidian reads it
 * as a tag all the same, and as a heading at the start of a line (#471.5).
 */
test('a hash in the text is escaped, and a real tag is not', async () => {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), {
		notes: [{
			title: 'Tags',
			runs: [
				{ text: 'Tags\n' },
				{ text: 'Bugs go in Slack #web-issues, and #s means numbers.\n' },
				// Neither is a tag in Obsidian, so both are left as they are: a
				// hash mid-word, and one leading a heading the note typed out
				{ text: 'Written in C# and F#.\n' },
				{ text: '## Not a tag\n' },
				{ text: '', attachment: { identifier: 'HASHTAG-1', uti: ANAttachment.Hashtag } },
			],
		}],
		attachments: [{ identifier: 'HASHTAG-1', uti: ANAttachment.Hashtag, altText: '#a-real-tag' }],
	});

	try {
		const converted = await convertStore(store.database, context(store.database));

		assert.equal(
			converted.get('Tags'),
			'Bugs go in Slack \\#web-issues, and \\#s means numbers.\n'
			+ 'Written in C# and F#.\n'
			+ '## Not a tag\n'
			+ '#a-real-tag'
		);
	}
	finally {
		store.close();
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * A link is an attachment, and an attachment was written without the prefix
 * its line calls for, so an item starting with one lost its checkbox (#471.8).
 */
test('a list item starting with a link keeps its checkbox', async () => {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), {
		notes: [{
			title: 'Tasks',
			runs: [
				{ text: 'Tasks\n' },
				{ text: 'Write the notes\n', style: ANStyleType.Checkbox, checked: false },
				{ text: '', attachment: { identifier: 'LINK-1', uti: ANAttachment.InternalLink }, style: ANStyleType.Checkbox, checked: false },
				{ text: ', and the rest of the item', style: ANStyleType.Checkbox, checked: false },
			],
		}],
		attachments: [
			{ identifier: 'LINK-1', uti: ANAttachment.InternalLink, tokenContentIdentifier: 'applenotes:note/00000000-0000-0000-0000-000000000001' },
			{ identifier: '00000000-0000-0000-0000-000000000001', uti: 'note' },
		],
	});

	try {
		const converted = await convertStore(store.database, context(store.database));

		assert.equal(
			converted.get('Tasks'),
			'- [ ] Write the notes\n- [ ] [[Apple Notes/Note 5.md]], and the rest of the item'
		);
	}
	finally {
		store.close();
		nodeFs.rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * A cell's result has to survive inside a `|`-delimited row: a line break
 * becomes a `<br>` and a pipe an entity, or the row ends early and everything
 * after it lands outside the table.
 */
test('a table cell keeps its line breaks and pipes', async () => {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), { notes: [] });

	try {
		const cell = context(store.database).decodeData(
			encodeNote({ title: 'Cell', runs: [{ text: 'first\nsecond\nthird | fourth' }] }).toString('hex'),
			NoteConverter
		);

		const formatted = await cell.format(true);

		assert.doesNotMatch(formatted, /\n/, 'a newline would end the table row');
		assert.doesNotMatch(formatted, /(?<!&#124;)\|/, 'a bare pipe would split the cell');
		assert.equal(formatted, 'first<br>second<br>third &#124; fourth');
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
