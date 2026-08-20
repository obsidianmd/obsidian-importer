import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';

import { AttachmentVerdict, DuplicateHandling, FormatImporter } from '../../src/format-importer';
import { ImportContext } from '../../src/import-context';
import { MemoryVault, memoryApp } from '../shims/vault';

/** An importer that keeps its attachments in one folder, as the vault default does. */
class PlacingImporter extends FormatImporter {
	init(): void {}
	async import(_ctx: ImportContext): Promise<void> {}

	place(filename: string, recognise: (existing: TFile) => AttachmentVerdict | Promise<AttachmentVerdict>) {
		return this.placeAttachment(filename, undefined, recognise);
	}
}

function importer(duplicateHandling = DuplicateHandling.Update) {
	const vault = new MemoryVault();
	const subject = new PlacingImporter(memoryApp(vault), { sourceEl: null, optionsEl: null } as never);
	subject.duplicateHandling = duplicateHandling;
	subject.indexImportedNotes();

	return { vault, subject };
}

/** What OneNote does: a size it asked the service for, against the file on disk. */
const sized = (size: number) => (existing: TFile): AttachmentVerdict =>
	existing.stat.size === size ? 'same' : 'another';

test('an attachment another source left behind is not handed to this one', async () => {
	const { vault, subject } = importer();
	await vault.createBinary('Document.pdf', new ArrayBuffer(11));

	const { path, reuse } = await subject.place('Document.pdf', sized(22));

	assert.equal(reuse, null, 'a name is not an identity');
	assert.equal(path, 'Document 1.pdf', 'the other source keeps the file it wrote');
	assert.equal((vault.contents.get('Document.pdf') as ArrayBuffer).byteLength, 11);
});

test('an attachment differing only in case is still an occupied name', async () => {
	const { vault, subject } = importer();
	await vault.createBinary('Cover.png', new ArrayBuffer(11));

	const { path, reuse } = await subject.place('cover.png', sized(22));

	assert.equal(reuse, null);
	assert.equal(path, 'cover 1.png');
	assert.equal((vault.contents.get('Cover.png') as ArrayBuffer).byteLength, 11);
});

test('the attachment this source wrote before is the one taken back up', async () => {
	const { vault, subject } = importer();
	await vault.createBinary('Document.pdf', new ArrayBuffer(22));

	const { path, reuse } = await subject.place('Document.pdf', sized(22));

	assert.equal(path, 'Document.pdf');
	assert.equal(reuse?.path, 'Document.pdf', 'nothing to download');
});

test('a name is passed over until the copy behind it is this attachment', async () => {
	const { vault, subject } = importer();
	await vault.createBinary('Drawing.png', new ArrayBuffer(1));
	await vault.createBinary('Drawing 1.png', new ArrayBuffer(2));
	await vault.createBinary('Drawing 2.png', new ArrayBuffer(3));

	const { path, reuse } = await subject.place('Drawing.png', sized(3));

	assert.equal(path, 'Drawing 2.png');
	assert.equal(reuse?.path, 'Drawing 2.png');
});

test('re-importing a note of same-named attachments does not grow the vault', async () => {
	const { vault, subject } = importer();
	const sizes = [10, 20, 30];

	for (const round of [1, 2, 3]) {
		subject.indexImportedNotes();

		for (const size of sizes) {
			const { path, reuse } = await subject.place('Drawing.png', sized(size));
			if (!reuse) await vault.createBinary(path, new ArrayBuffer(size));
		}

		assert.equal(vault.paths().length, sizes.length, `round ${round} wrote another set`);
	}

	assert.deepEqual(vault.paths().sort(), ['Drawing 1.png', 'Drawing 2.png', 'Drawing.png']);
});

test('an attachment the source has changed is written over where it stands', async () => {
	const { vault, subject } = importer();
	await vault.createBinary('Photo.png', new ArrayBuffer(5));

	const { path, reuse } = await subject.place('Photo.png', () => 'stale');

	assert.equal(path, 'Photo.png', 'in place rather than beside it');
	assert.equal(reuse, null, 'and the new bytes are fetched');
});

test('a stale attachment keeps the casing of the file already in the vault', async () => {
	const { vault, subject } = importer();
	await vault.createBinary('Photo.png', new ArrayBuffer(5));

	const { path, reuse } = await subject.place('photo.png', () => 'stale');

	assert.equal(path, 'Photo.png');
	assert.equal(reuse, null);
});

test('"Skip" leaves an attachment the source has changed alone', async () => {
	const { vault, subject } = importer(DuplicateHandling.Skip);
	await vault.createBinary('Photo.png', new ArrayBuffer(5));

	const { reuse } = await subject.place('Photo.png', () => 'stale');

	assert.equal(reuse?.path, 'Photo.png');
});

test('"Create a copy" never asks, and never reuses', async () => {
	const { vault, subject } = importer(DuplicateHandling.CreateCopy);
	await vault.createBinary('Photo.png', new ArrayBuffer(5));

	let asked = 0;
	const { path, reuse } = await subject.place('Photo.png', () => (asked++, 'same'));

	assert.equal(asked, 0);
	assert.equal(reuse, null);
	assert.equal(path, 'Photo 1.png');
});

test('two attachments of one name in a single run get a path each', async () => {
	const { vault, subject } = importer();

	const first = await subject.place('Photo.png', sized(1));
	await vault.createBinary(first.path, new ArrayBuffer(1));
	const second = await subject.place('Photo.png', sized(2));

	assert.equal(first.path, 'Photo.png');
	assert.equal(second.path, 'Photo 1.png');
});

test('a folder with the requested attachment name is passed over', async () => {
	const { vault, subject } = importer();
	await vault.createFolder('Photo.png');

	const { path, reuse } = await subject.place('Photo.png', sized(1));

	assert.equal(path, 'Photo 1.png');
	assert.equal(reuse, null);
});
