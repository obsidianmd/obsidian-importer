/**
 * The Samsung Notes conversion, outside Obsidian.
 *
 * Each .sdocx fixture is unzipped, parsed, and converted, and the Markdown is
 * recorded beside it. Images are embedded by their media file name, since
 * placing them in a vault is the importer's job.
 */
import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { convertSamsungNote } from '../../src/formats/samsung-notes/convert';
import { mediaDisplayName, parseSamsungNote, SamsungNote } from '../../src/formats/samsung-notes/parse';
import { expectedFor, expectFile, fixtures } from '../helpers';

const notes = fixtures(__dirname, '.sdocx');

async function readNote(path: string): Promise<SamsungNote> {
	const zip = new ZipReader(new BlobReader(new Blob([nodeFs.readFileSync(path)])));
	const files = new Map<string, ArrayBuffer>();
	for (const entry of await zip.getEntries()) {
		if (entry.directory || !entry.getData) continue;
		const bytes = await entry.getData(new Uint8ArrayWriter());
		files.set(entry.filename, bytes.slice().buffer);
	}
	await zip.close();

	return parseSamsungNote({
		note: files.get('note.note')!,
		mediaInfo: files.get('media/mediaInfo.dat'),
		pages: [...files].filter(([name]) => name.endsWith('.page')).map(([, bytes]) => bytes),
	});
}

function convert(note: SamsungNote): string {
	return convertSamsungNote(note, {
		embedImage: bindId => {
			const name = note.media.get(bindId);
			return name === undefined ? null : `![[${mediaDisplayName(name)}]]`;
		},
	});
}

test('there are fixtures to convert', () => {
	assert.ok(notes.length > 0, 'expected at least one .sdocx in tests/samsung-notes');
});

for (const fixture of notes) {
	test(`converts ${fixture.name}`, async () => {
		const note = await readNote(fixture.path);
		const name = nodePath.basename(fixture.name, '.sdocx');
		expectFile(convert(note), expectedFor(fixture, `${name}.md`), fixture.name);
	});
}

test('reads the title and the times in milliseconds', async () => {
	const note = await readNote(nodePath.join(__dirname, '01-basic-formatting.sdocx'));

	assert.equal(note.title, '01-basic-test');
	assert.equal(note.ctime, 1787680973768);
	assert.equal(note.mtime, 1787681127064);
	assert.equal(note.unsupportedPages, 0);
});

test('counts pages with handwriting', async () => {
	const note = await readNote(nodePath.join(__dirname, '04-marker4-highlighter.sdocx'));
	assert.equal(note.unsupportedPages, 1);
});

test('a note without images leaves an unresolved one out', async () => {
	const note = await readNote(nodePath.join(__dirname, '03-image-placement.sdocx'));
	const content = convertSamsungNote(note, { embedImage: () => null });
	assert.equal(content, '\n');
});
