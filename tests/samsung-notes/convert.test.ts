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
import * as nodePath from 'node:path';

import { convertSamsungNote } from '../../src/formats/samsung-notes/convert';
import { drawingToSvg } from '../../src/formats/samsung-notes/drawing';
import { mediaDisplayName, parseSamsungNote, SamsungNote, UnreadableNoteError } from '../../src/formats/samsung-notes/parse';
import { expectedFor, expectFile, fixtures } from '../helpers';
import { noteWithBrokenBody, readFiles } from './sdocx';

const notes = fixtures(__dirname, '.sdocx');

async function readNote(path: string): Promise<SamsungNote> {
	const files = await readFiles(path);
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

test('reads drawn shapes and a line beside the pen strokes', async () => {
	const note = await readNote(nodePath.join(__dirname, '02-shapes-and-dot-calibration.sdocx'));

	assert.equal(note.unsupportedPages, 0);
	assert.equal(note.drawings.length, 1);
	const shapes = note.drawings[0].filter(stroke => stroke.kind === 'shape');
	assert.equal(note.drawings[0].length - shapes.length, 77);
	assert.deepEqual(shapes.map(shape => shape.points.length), [5, 98, 4, 6, 7, 2]);
});

test('counts a page with a PDF behind it as unsupported', async () => {
	const files = await readFiles(nodePath.join(__dirname, '01-basic-formatting.sdocx'));
	const page = new DataView(new ArrayBuffer(22));
	page.setUint32(0, 18, true);
	page.setUint32(14, 0x100, true);
	const note = parseSamsungNote({ note: files.get('note.note')!, pages: new Map([['page', page.buffer]]) });

	assert.equal(note.unsupportedPages, 1);
	assert.deepEqual(note.drawings, []);
});

test('refuses a note whose body it cannot read', async () => {
	const note = await noteWithBrokenBody();
	assert.throws(() => parseSamsungNote({ note, pages: new Map() }), UnreadableNoteError);
});

test('counts a page that has drawings but no layers it can read as unsupported', async () => {
	const files = await readFiles(nodePath.join(__dirname, '01-basic-formatting.sdocx'));
	const empty = new DataView(new ArrayBuffer(22));
	empty.setUint32(0, 18, true);
	empty.setUint32(14, 0x1, true);
	const truncated = (await readFiles(nodePath.join(__dirname, '04-marker4-highlighter.sdocx'))).get('e2c01be0-b6cf-11f1-91c8-b3fbd8ca0b23.page')!.slice(0, 17);

	const note = parseSamsungNote({ note: files.get('note.note')!, pages: new Map([['empty', empty.buffer], ['truncated', truncated]]) });
	assert.equal(note.unsupportedPages, 2);
});

test('a note without images leaves an unresolved one out', async () => {
	const note = await readNote(nodePath.join(__dirname, '03-image-placement.sdocx'));
	const content = convertSamsungNote(note, { embedImage: () => null, embedDrawing: () => null });
	assert.equal(content, '\n');
});
