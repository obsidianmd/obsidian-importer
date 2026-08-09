import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as nodeZlib from 'node:zlib';

import { Root } from 'protobufjs';

import { provideNodeModules } from '../../src/filesystem';
import { DuplicateHandling } from '../../src/format-importer';
import { AppleNotesImporter } from '../../src/formats/apple-notes';
import { descriptor } from '../../src/formats/apple-notes/descriptor';
import { ANAttachment } from '../../src/formats/apple-notes/models';
import { TFile } from '../shims/obsidian';
import { MemoryVault, memoryApp } from '../shims/vault';
import { buildStore, StoreSpec } from './store';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath, zlib: nodeZlib });

/** Minimal PNG used to test file-signature detection. */
const PNG_BYTES = Buffer.from(
	'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478' +
	'9c6300010000050001' + '0d0a2db4' + '0000000049454e44ae426082',
	'hex'
);

const DRAWINGS: StoreSpec = {
	notes: [{
		title: 'Sketches',
		runs: [
			{ text: 'Sketches\n' },
			{ text: '', attachment: { identifier: 'DRAWING-PAPER', uti: ANAttachment.Drawing } },
			{ text: '\n' },
			{ text: '', attachment: { identifier: 'DRAWING-LEGACY', uti: ANAttachment.DrawingLegacy } },
			{ text: '\n' },
			{ text: '', attachment: { identifier: 'DRAWING-LEGACY-2', uti: ANAttachment.DrawingLegacy2 } },
		],
	}],
	attachments: [
		{ identifier: 'DRAWING-PAPER', uti: ANAttachment.Drawing, note: 0 },
		{ identifier: 'DRAWING-LEGACY', uti: ANAttachment.DrawingLegacy, note: 0 },
		{ identifier: 'DRAWING-LEGACY-2', uti: ANAttachment.DrawingLegacy2, note: 0 },
	],
};

/** Build an importer with a fixture database and attachment directory. */
async function importing(spec: StoreSpec, writeFiles = true) {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), spec);

	// Mirror Apple's attachment directory under the owning account.
	const account = nodePath.join(dir, 'Accounts', 'ACCOUNT-1');
	nodeFs.mkdirSync(nodePath.join(account, 'FallbackImages'), { recursive: true });
	if (writeFiles) {
		for (const attachment of spec.attachments ?? []) {
			nodeFs.writeFileSync(nodePath.join(account, 'FallbackImages', `${attachment.identifier}.jpg`), attachment.identifier);
		}

		for (const [identifier, name] of store.mediaFiles) {
			const into = nodePath.join(account, 'Media', identifier, '');
			nodeFs.mkdirSync(into, { recursive: true });
			nodeFs.writeFileSync(nodePath.join(into, name), PNG_BYTES);
		}
	}

	const vault = new MemoryVault();
	const failed: string[] = [];
	const skipped: string[] = [];
	const reasons: (string | undefined)[] = [];
	const keys = Object.fromEntries(
		(await store.database.all`SELECT z_ent, z_name FROM z_primarykey`).map(k => [k.Z_NAME, k.Z_ENT])
	);

	// One importer per run over the same vault, so a second run sees what the
	// first one wrote - which is what duplicate handling reads
	const run = (mode = DuplicateHandling.CreateCopy) => {
		const subject = new AppleNotesImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);

		subject.ctx = {
			isCancelled: () => false,
			shouldStop: async () => false,
			status: () => {},
			reportProgress: () => {},
			reportNoteSuccess: () => {},
			reportAttachmentSuccess: () => {},
			reportSkipped: (name: string, reason?: string) => { skipped.push(name); reasons.push(reason); },
			reportFailed: (name: string, reason?: string) => { failed.push(name); reasons.push(reason); },
		} as never;
		subject.vault = vault as never;
		subject.rootFolder = vault.root;
		subject.protobufRoot = Root.fromJSON(descriptor);
		subject.keys = keys;
		subject.duplicateHandling = mode;
		subject.database = store.database;
		subject.resolvedAccounts = { 1: { name: 'Test account', uuid: 'ACCOUNT-1', path: account } };
		subject.owners = { [store.folderPk]: 1 };

		return (pk: number) => subject.resolveNote(pk);
	};

	const first = run();

	return {
		vault, failed, skipped, reasons, notePks: store.notePks,
		/** Where the source files are, so a test can take one away. */
		account,
		resolve: (pk: number) => first(pk),
		/** A later import into the same vault, as a second run of the importer. */
		reimport: (mode: DuplicateHandling) => run(mode),
		close: () => {
			store.close();
			nodeFs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

const MISSING_MEDIA: StoreSpec = {
	notes: [{
		title: 'Holiday',
		runs: [
			{ text: 'Holiday\n' },
			{ text: 'Text that should survive.\n' },
			{ text: '', attachment: { identifier: 'PHOTO-1', uti: 'public.jpeg' } },
		],
	}],
	// Reproduce #218 with a ZMEDIA key that has no ICMedia row. The note body
	// must still survive (#391).
	attachments: [{ identifier: 'PHOTO-1', uti: 'public.jpeg', media: 9999, note: 0 }],
};

test('a note keeps its text when an attachment it points at is gone', async () => {
	const run = await importing(MISSING_MEDIA);

	try {
		const note = await run.resolve(run.notePks[0]);

		assert.ok(note, 'the note should be imported');

		const body = String(run.vault.contents.get(note.path));
		assert.ok(body.contains('Text that should survive.'), `the note is empty: ${JSON.stringify(body)}`);
		assert.equal(run.failed.length, 1, 'the attachment is what failed, and it is reported');
	}
	finally {
		run.close();
	}
});

/** Evernote clips can leave media named with a bare UUID (#471.1). */
const NO_EXTENSION: StoreSpec = {
	notes: [{
		title: 'Clipped',
		runs: [
			{ text: 'Clipped\n' },
			{ text: '', attachment: { identifier: 'CLIP-1', uti: 'public.png' } },
		],
	}],
	attachments: [{
		identifier: 'CLIP-1', uti: 'public.png', note: 0,
		mediaFilename: '0A32B83C-3BCC-4F65-B77D-B2EA8D76B37B',
	}],
};

test('a media file with no extension is named for what it holds', async () => {
	const run = await importing(NO_EXTENSION);

	try {
		const note = await run.resolve(run.notePks[0]);

		assert.ok(note, 'the note should be imported');
		assert.deepEqual(run.failed, [], 'nothing should have failed');
		assert.deepEqual(run.vault.paths(), [
			'Clipped.md', '0A32B83C-3BCC-4F65-B77D-B2EA8D76B37B.png',
		]);
	}
	finally {
		run.close();
	}
});

/** A media row that is there but carries no name for the file. */
const NULL_FILENAME: StoreSpec = {
	notes: [{
		title: 'Holiday',
		runs: [
			{ text: 'Holiday\n' },
			{ text: 'Text that should survive.\n' },
			{ text: '', attachment: { identifier: 'PHOTO-2', uti: 'public.jpeg' } },
		],
	}],
	attachments: [{ identifier: 'PHOTO-2', uti: 'public.jpeg', note: 0, mediaFilename: null }],
};

test('a note keeps its text when a media row carries no file name', async () => {
	const run = await importing(NULL_FILENAME);

	try {
		const note = await run.resolve(run.notePks[0]);

		assert.ok(note, 'the note should be imported');

		const body = String(run.vault.contents.get(note.path));
		assert.ok(body.contains('Text that should survive.'), `the note is empty: ${JSON.stringify(body)}`);
		assert.equal(run.failed.length, 1);
	}
	finally {
		run.close();
	}
});

test('an extensionless attachment is recognised again on a later import', async () => {
	const run = await importing(NO_EXTENSION);

	try {
		await run.resolve(run.notePks[0]);
		assert.deepEqual(run.vault.paths(), [
			'Clipped.md', '0A32B83C-3BCC-4F65-B77D-B2EA8D76B37B.png',
		]);

		// Age the note so the second run reimports it rather than skipping it,
		// which is what brings the attachment back through resolveAttachment
		const note = run.vault.getAbstractFileByPath('Clipped.md');
		assert.ok(note instanceof TFile);
		note.stat.mtime = 0;

		// The attachment is already there under the name its bytes gave it, so
		// no second copy is written
		await run.reimport(DuplicateHandling.Update)(run.notePks[0]);

		assert.deepEqual(run.vault.paths(), [
			'Clipped.md', '0A32B83C-3BCC-4F65-B77D-B2EA8D76B37B.png',
		]);
	}
	finally {
		run.close();
	}
});

/** An attachment whose name already says what it is. */
const NAMED_MEDIA: StoreSpec = {
	notes: [{
		title: 'Trip',
		runs: [
			{ text: 'Trip\n' },
			{ text: '', attachment: { identifier: 'PHOTO-3', uti: 'public.png' } },
		],
	}],
	attachments: [{ identifier: 'PHOTO-3', uti: 'public.png', note: 0, mediaFilename: 'photo.png' }],
};

/**
 * Apple can take the source file back - offloaded, or the note edited on
 * another device - while the copy this vault already holds is still good. The
 * attachment is already known by name, so it is reused rather than re-read.
 */
test('an attachment already in the vault survives its source going away', async () => {
	const run = await importing(NAMED_MEDIA);

	try {
		await run.resolve(run.notePks[0]);
		assert.deepEqual(run.vault.paths(), ['Trip.md', 'photo.png']);

		nodeFs.rmSync(nodePath.join(run.account, 'Media'), { recursive: true, force: true });

		const note = run.vault.getAbstractFileByPath('Trip.md');
		assert.ok(note instanceof TFile);
		note.stat.mtime = 0;

		await run.reimport(DuplicateHandling.Update)(run.notePks[0]);

		assert.deepEqual(run.failed, [], 'the vault still has the attachment');
		assert.ok(
			String(run.vault.contents.get('Trip.md')).contains('photo.png'),
			`the link was replaced: ${JSON.stringify(run.vault.contents.get('Trip.md'))}`
		);
	}
	finally {
		run.close();
	}
});

const RENDERED: StoreSpec = {
	notes: [{
		title: 'Sketch',
		runs: [
			{ text: 'Sketch\n' },
			{ text: '', attachment: { identifier: 'DRAWING-1', uti: ANAttachment.DrawingLegacy2 } },
		],
	}],
	attachments: [{
		identifier: 'DRAWING-1', uti: ANAttachment.DrawingLegacy2, note: 0,
		fallbackImageGeneration: '1_FF5E5DAE', size: { width: 1536, height: 836 },
	}],
};

test('an attachment that is at neither path says where it looked', async () => {
	const run = await importing(RENDERED, false);

	try {
		const note = await run.resolve(run.notePks[0]);

		assert.ok(note, 'the note should be imported');

		const body = String(run.vault.contents.get(note.path));
		assert.equal(body.match(/\*\*\(error reading attachment\)\*\*/g)?.length, 1);

		assert.deepEqual(run.skipped, [], 'the drawing was rendered, so this is a failure');
		assert.deepEqual(run.failed, ['Drawing in Sketch']);
		assert.match(String(run.reasons[0]), /^there is no file at .*Accounts.*FallbackImages/);
		assert.match(String(run.reasons[0]), / or .*group\.com\.apple\.notes\/FallbackImages/);
	}
	finally {
		run.close();
	}
});

test('a drawing that was never downloaded is skipped, not failed', async () => {
	const run = await importing(DRAWINGS, false);

	try {
		const note = await run.resolve(run.notePks[0]);

		assert.ok(note, 'the note should be imported');
		assert.deepEqual(run.failed, [], 'there is no file to have failed to read');
		assert.deepEqual(run.skipped, ['Drawing in Sketches', 'Drawing in Sketches', 'Drawing in Sketches']);

		assert.deepEqual([...new Set(run.reasons)], [
			'it has not been downloaded from iCloud - open the note in Apple Notes to fetch it',
		]);
	}
	finally {
		run.close();
	}
});

test('drawings that share a name stay separate files when updating', async () => {
	// Three different drawings all want to be called Drawing.png. The check for
	// one already in the folder is meant to recognise a previous import, but
	// within a single run it also matches a different attachment that merely
	// got there first.
	const run = await importing(DRAWINGS);
	try {
		await run.reimport(DuplicateHandling.Update)(run.notePks[0]);

		const drawings = run.vault.paths().filter(path => path.endsWith('.png'));
		assert.deepEqual(drawings, ['Drawing.png', 'Drawing 1.png', 'Drawing 2.png']);
	}
	finally {
		run.close();
	}
});

test('a drawing is imported whichever UTI it carries', async () => {
	const run = await importing(DRAWINGS);
	try {
		const note = await run.resolve(run.notePks[0]);
		assert.ok(note, 'the note should be imported');
		assert.deepEqual(run.failed, [], 'nothing should have failed');

		const drawings = run.vault.paths().filter(path => path.endsWith('.png'));
		assert.deepEqual(drawings, ['Drawing.png', 'Drawing 1.png', 'Drawing 2.png']);

		const body = String(run.vault.contents.get(note.path));
		for (const drawing of drawings) assert.ok(body.includes(`![[${drawing}]]`), `${drawing} is not linked`);

		const held = (path: string) => Buffer.from(run.vault.contents.get(path) as ArrayBuffer).toString();
		assert.equal(held('Drawing.png'), 'DRAWING-PAPER');
		assert.equal(held('Drawing 1.png'), 'DRAWING-LEGACY');
		assert.equal(held('Drawing 2.png'), 'DRAWING-LEGACY-2');
	}
	finally {
		run.close();
	}
});
