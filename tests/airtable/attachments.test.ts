/**
 * What a second Airtable import does to an attachment it already downloaded.
 *
 * Airtable hands out an id for every attachment, but nothing writes it into
 * the vault, so a later import has only the file itself to recognise it by.
 * A name and a size together are what it has: the same name holding the same
 * number of bytes is this attachment again.
 *
 * Getting that wrong is not just a wasted download: every import found its own
 * file already there, wrote "cover 1.png" beside it and pointed the note at
 * the new one, so under "Update" the record changed every time it was seen.
 */
import '../shims/dom';
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AirtableAPIImporter } from '../../src/formats/airtable-api';
import { downloadAttachmentList } from '../../src/formats/airtable-api/attachment-helpers';
import { ImportContext } from '../../src/import-context';
import type { AirtableAttachment, AttachmentPlacement } from '../../src/formats/airtable-api/types';
import { answerRequests } from '../shims/obsidian';
import { MemoryVault, memoryApp } from '../shims/vault';

const NOTE = 'Airtable/Books/Dune.md';
const COVER: AirtableAttachment = {
	id: 'attExample00000001',
	url: 'https://v5.airtableusercontent.com/example/cover.png',
	filename: 'cover.png',
	size: 4,
	type: 'image/png',
};

const BYTES = new Uint8Array([137, 80, 78, 71]);

const fetched: string[] = [];

answerRequests(request => {
	fetched.push(request.url);

	return { status: 200, arrayBuffer: BYTES.buffer, text: '', headers: {} } as never;
});

class PlacingImporter extends AirtableAPIImporter {
	placer(notePath: string): (filename: string, size: number | undefined) => Promise<AttachmentPlacement> {
		return this.attachmentPlacer(notePath);
	}

	release(path: string): void {
		this.releasePath(path);
	}
}

/** One import's worth of attachment handling, over a vault that may hold some. */
async function resolve(vault: MemoryVault, attachments: AirtableAttachment[]) {
	const subject = new PlacingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.indexImportedNotes();

	const ctx = new ImportContext();
	const results = await downloadAttachmentList(attachments, {
		ctx,
		vault: vault as never,
		downloadAttachments: true,
		placeAttachment: subject.placer(NOTE),
		releasePath: path => subject.release(path),
	});

	return { ctx, results };
}

const files = (vault: MemoryVault) => vault.paths().filter(path => !path.endsWith('.md')).sort();

test('the first import downloads the attachment and keeps its name', async () => {
	const vault = new MemoryVault();
	fetched.length = 0;

	const { results } = await resolve(vault, [COVER]);

	assert.deepEqual(fetched, [COVER.url]);
	assert.deepEqual(files(vault), ['cover.png']);
	assert.equal(results[0].path, 'cover.png');
	assert.equal(results[0].isLocal, true);
});

test('a second import recognises it, downloads nothing, and writes nothing', async () => {
	const vault = new MemoryVault();
	await resolve(vault, [COVER]);
	fetched.length = 0;

	const { results, ctx } = await resolve(vault, [COVER]);

	assert.deepEqual(fetched, [], 'the bytes are already in the vault');
	assert.deepEqual(files(vault), ['cover.png'], 'and there is still only one copy of them');
	assert.equal(results[0].path, 'cover.png', 'so the note says exactly what it said before');
	assert.deepEqual(ctx.skipped, ['cover.png']);
});

test('a file of the same name that is not this attachment is left where it is', async () => {
	const vault = new MemoryVault();
	await vault.createBinary('cover.png', new Uint8Array([1, 2, 3, 4, 5, 6]).buffer);
	fetched.length = 0;

	const { results } = await resolve(vault, [COVER]);

	assert.deepEqual(files(vault), ['cover 1.png', 'cover.png']);
	assert.equal(results[0].path, 'cover 1.png');
	assert.equal((vault.contents.get('cover.png') as ArrayBuffer).byteLength, 6, 'the other file is untouched');
});

// Once it has settled on "cover 1.png" it stays there, rather than adding a
// "cover 2.png" on the next import and a "cover 3.png" after that.
test('and the name it settles on is the one the next import finds', async () => {
	const vault = new MemoryVault();
	await vault.createBinary('cover.png', new Uint8Array([1, 2, 3, 4, 5, 6]).buffer);
	await resolve(vault, [COVER]);
	fetched.length = 0;

	const { results } = await resolve(vault, [COVER]);

	assert.deepEqual(files(vault), ['cover 1.png', 'cover.png']);
	assert.equal(results[0].path, 'cover 1.png');
	assert.deepEqual(fetched, []);
});

test('two attachments of one name in a single record stay two files', async () => {
	const vault = new MemoryVault();
	const other = { ...COVER, id: 'attExample00000002', url: 'https://example.invalid/other.png', size: 4 };
	fetched.length = 0;

	const { results } = await resolve(vault, [COVER, other]);

	assert.deepEqual(files(vault), ['cover 1.png', 'cover.png']);
	assert.deepEqual(results.map(result => result.path), ['cover.png', 'cover 1.png']);
});

test('an attachment whose size Airtable did not report is never mistaken for another', async () => {
	const vault = new MemoryVault();
	const unsized = { ...COVER, size: undefined };
	await resolve(vault, [unsized]);
	fetched.length = 0;

	await resolve(vault, [unsized]);

	assert.deepEqual(files(vault), ['cover 1.png', 'cover.png'], 'with nothing to compare, it takes a fresh name');
	assert.deepEqual(fetched, [unsized.url]);
});
