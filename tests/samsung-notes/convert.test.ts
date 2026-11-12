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
import { drawingToSvg } from '../../src/formats/samsung-notes/drawing';
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
		pageOrder: files.get('pageIdInfo.dat'),
		pages: new Map([...files]
			.filter(([name]) => name.endsWith('.page'))
			.map(([name, bytes]) => [name.slice(0, -'.page'.length), bytes])),
	});
}

/** Named as the importer names them when the note's title is `name`. */
function drawingName(name: string, index: number): string {
	return `${name} - Ink${index > 0 ? ` ${index}` : ''}.svg`;
}

function convert(note: SamsungNote, name: string): { content: string, drawings: (string | null)[] } {
	const drawings = note.drawings.map(drawingToSvg);
	const content = convertSamsungNote(note, {
		embedImage: bindId => {
			const file = note.media.get(bindId);
			return file === undefined ? null : `![[${mediaDisplayName(file)}]]`;
		},
		embedDrawing: index => drawings[index] ? `![[${drawingName(name, index)}]]` : null,
	});
	return { content, drawings };
}

test('there are fixtures to convert', () => {
	assert.ok(notes.length > 0, 'expected at least one .sdocx in tests/samsung-notes');
});

for (const fixture of notes) {
	test(`converts ${fixture.name}`, async () => {
		const note = await readNote(fixture.path);
		const name = nodePath.basename(fixture.name, '.sdocx');
		const { content, drawings } = convert(note, name);
		expectFile(content, expectedFor(fixture, `${name}.md`), fixture.name);
		drawings.forEach((svg, index) => {
			if (svg) expectFile(svg, expectedFor(fixture, drawingName(name, index)), fixture.name);
		});
	});
}

test('reads the title and the times in milliseconds', async () => {
	const note = await readNote(nodePath.join(__dirname, '01-basic-formatting.sdocx'));

	assert.equal(note.title, '01-basic-test');
	assert.equal(note.ctime, 1787680973768);
	assert.equal(note.mtime, 1787681127064);
	assert.equal(note.unsupportedPages, 0);
});

test('reads the strokes on a page and counts none of it as unsupported', async () => {
	const note = await readNote(nodePath.join(__dirname, '04-marker4-highlighter.sdocx'));

	assert.equal(note.unsupportedPages, 0);
	assert.equal(note.drawings.length, 1);
	assert.equal(note.drawings[0].length, 41);
	assert.deepEqual(note.drawings[0].map(stroke => stroke.color.toString(16)).filter((color, i, all) => all.indexOf(color) === i),
		['ff030303', '80ffcb30', '802febd2', '803396ff']);
});

test('counts a page with shapes as unsupported but keeps its strokes', async () => {
	const note = await readNote(nodePath.join(__dirname, '02-shapes-and-dot-calibration.sdocx'));

	assert.equal(note.unsupportedPages, 1);
	assert.equal(note.drawings.length, 1);
	assert.equal(note.drawings[0].length, 77);
});

test('a note without images leaves an unresolved one out', async () => {
	const note = await readNote(nodePath.join(__dirname, '03-image-placement.sdocx'));
	const content = convertSamsungNote(note, { embedImage: () => null, embedDrawing: () => null });
	assert.equal(content, '\n');
});
