/**
 * A drawing, from a note that carries one, into the vault.
 *
 * Apple has used three UTIs for a drawing: com.apple.drawing, its .2 successor,
 * and com.apple.paper. The converter has known all three since #183, and it
 * hands each of them to resolveAttachment - which knew only the newest, so an
 * older one fell through to the branch for a file attachment, found no media
 * row at that key, and threw reading a column of the row that was not there.
 * The note it was in failed with it.
 *
 * The drawings here are made up, and so is the account directory they are read
 * from: what is being checked is that all three UTIs take the same path out.
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
import { AppleNotesImporter } from '../../src/formats/apple-notes';
import { descriptor } from '../../src/formats/apple-notes/descriptor';
import { ANAttachment } from '../../src/formats/apple-notes/models';
import { MemoryVault, memoryApp } from '../shims/vault';
import { buildStore, StoreSpec } from './store';

provideNodeModules({ fs: nodeFs as never, os: nodeOs, path: nodePath, zlib: nodeZlib });

/** One drawing per UTI Apple has used for one, all in a single note. */
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

/**
 * An importer pointed at a built database and an account directory holding the
 * drawings, ready for resolveNote. See duplicates.test.ts: import() would ask
 * for a folder through a dialog, so what it sets up is set up here.
 */
async function importing(spec: StoreSpec) {
	const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'importer-apple-notes-'));
	const store = buildStore(nodePath.join(dir, 'NoteStore.sqlite'), spec);

	// Where Apple keeps the rendered copy of a drawing, which is what the
	// importer reads: no generation directory, since none of these have one
	const account = nodePath.join(dir, 'Accounts', 'ACCOUNT-1');
	nodeFs.mkdirSync(nodePath.join(account, 'FallbackImages'), { recursive: true });
	for (const attachment of spec.attachments ?? []) {
		nodeFs.writeFileSync(nodePath.join(account, 'FallbackImages', `${attachment.identifier}.jpg`), attachment.identifier);
	}

	const vault = new MemoryVault();
	const failed: string[] = [];
	const subject = new AppleNotesImporter(memoryApp(vault), { contentEl: null } as never);

	subject.ctx = {
		isCancelled: () => false,
		shouldStop: async () => false,
		status: () => {},
		reportProgress: () => {},
		reportNoteSuccess: () => {},
		reportAttachmentSuccess: () => {},
		reportSkipped: (name: string) => failed.push(name),
		reportFailed: (name: string) => failed.push(name),
	} as never;
	subject.vault = vault as never;
	subject.rootFolder = vault.root;
	subject.protobufRoot = Root.fromJSON(descriptor);
	subject.keys = Object.fromEntries(
		(await store.database.all`SELECT z_ent, z_name FROM z_primarykey`).map(k => [k.Z_NAME, k.Z_ENT])
	);
	subject.database = store.database;
	subject.resolvedAccounts = { 1: { name: 'Test account', uuid: 'ACCOUNT-1', path: account } };
	subject.owners = { [store.folderPk]: 1 };

	return {
		vault, failed, notePks: store.notePks,
		resolve: (pk: number) => subject.resolveNote(pk),
		close: () => {
			store.close();
			nodeFs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

test('a drawing is imported whichever UTI it carries', async () => {
	const run = await importing(DRAWINGS);
	try {
		const note = await run.resolve(run.notePks[0]);
		assert.ok(note, 'the note should be imported');
		assert.deepEqual(run.failed, [], 'nothing should have failed');

		// One file per drawing, each linked from the note it came out of
		const drawings = run.vault.paths().filter(path => path.endsWith('.png'));
		assert.deepEqual(drawings, ['Drawing.png', 'Drawing 1.png', 'Drawing 2.png']);

		const body = String(run.vault.contents.get(note.path));
		for (const drawing of drawings) assert.ok(body.includes(`![[${drawing}]]`), `${drawing} is not linked`);

		// Read from the account directory rather than made up: each file holds
		// what was written under the identifier the row carries
		const held = (path: string) => Buffer.from(run.vault.contents.get(path) as ArrayBuffer).toString();
		assert.equal(held('Drawing.png'), 'DRAWING-PAPER');
		assert.equal(held('Drawing 1.png'), 'DRAWING-LEGACY');
		assert.equal(held('Drawing 2.png'), 'DRAWING-LEGACY-2');
	}
	finally {
		run.close();
	}
});
