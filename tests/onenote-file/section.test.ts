/**
 * The values here are not recordings of this code. Each one is asserted by
 * OfficeIMO's own tests against the same bytes (see fixtures/SOURCE.md), so a
 * disagreement means the port is wrong rather than that the output moved.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeFs from 'node:fs';
import nodePath from 'node:path';

import { readRevisionStore } from '../../src/formats/onenote-file/onestore/revision-store';
import { mapSection, collectText } from '../../src/formats/onenote-file/semantic/map';
import type { Element, Section } from '../../src/formats/onenote-file/semantic/content';
import { OneNoteFormatError } from '../../src/formats/onenote-file/errors';

function section(name: string): Section {
	const data = new Uint8Array(nodeFs.readFileSync(nodePath.join(__dirname, 'fixtures', name)));
	return mapSection(readRevisionStore(data));
}

function textOf(page: Section['pages'][number]): string {
	const parts: string[] = [];
	for (const element of [...page.outlines, ...page.directContent]) collectText(element, parts);
	return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function everyElement(page: Section['pages'][number]): Element[] {
	const found: Element[] = [];

	const walk = (element: Element) => {
		found.push(element);
		if (element.kind === 'paragraph' || element.kind === 'outline') element.children.forEach(walk);
		if (element.kind === 'table') element.rows.forEach(row => row.cells.forEach(cell => cell.children.forEach(walk)));
	};

	[...page.outlines, ...page.directContent].forEach(walk);
	return found;
}

test('a 2016 desktop section reads its colour, title and paragraph text', () => {
	const parsed = section('testOneNote2016.one');
	const [page] = parsed.pages;

	assert.equal(parsed.pages.length, 1);
	assert.equal(parsed.colorArgb, 0x00e4a88a);
	assert.equal(page.title, 'So good');
	assert.ok(textOf(page).includes('This is one note 2016'), 'the paragraph text is missing');
});

test('nested outline text comes through without the font names beside it', () => {
	const parsed = section('testOneNote.one');
	const [page] = parsed.pages;
	const text = textOf(page);

	assert.equal(parsed.pages.length, 1);
	assert.equal(page.title, 'Note-ssn-test-mmmm');
	assert.ok(text.includes('Nicole Knox'), 'the outline text is missing');
	assert.ok(!text.includes('Calibri'), 'a font name leaked into the text');
});

test('an embedded file resolves to its name and its bytes', () => {
	const [page] = section('testOneNoteEmbeddedWordDoc.one').pages;
	const embedded = everyElement(page).filter(element => element.kind === 'embedded-file');

	assert.equal(embedded.length, 1);
	assert.equal(embedded[0].kind === 'embedded-file' && embedded[0].fileName, 'Dude this is a super cool embedded doc.docx');

	const data = embedded[0].kind === 'embedded-file' ? embedded[0].data : undefined;
	assert.ok(data && data.length > 4, 'the embedded payload is missing');
	assert.equal(data![0], 0x50, 'the payload does not start with PK');
	assert.equal(data![1], 0x4b, 'the payload does not start with PK');
});

test('images resolve to their file names and payloads', () => {
	const [page] = section('testOneNote.one').pages;
	const images = everyElement(page).filter(element => element.kind === 'image');

	assert.equal(images.length, 3);
	assert.deepEqual(
		images.map(image => image.kind === 'image' && image.fileName),
		['clip_image001.png', 'clip_image002.png', 'clip_image003.png']);
	assert.ok(images.every(image => image.kind === 'image' && image.data && image.data.length > 0), 'an image has no bytes');
});

test('the FSSHTTP packaging is refused by name rather than misread', () => {
	for (const name of ['testOneNoteFromOffice365.one', 'testOneNoteFromOffice365-2.one']) {
		assert.throws(
			() => section(name),
			(error: unknown) => error instanceof OneNoteFormatError && error.code === 'ONENOTE_NOT_REVISION_STORE',
			`${name} should be reported as a packaging this reader does not handle`);
	}
});
