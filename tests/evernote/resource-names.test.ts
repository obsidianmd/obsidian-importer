import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getResourceFileName } from '../../src/formats/evernote/utils/filename-utils';

const named = (fileName: string | undefined, mime = 'image/png') =>
	getResourceFileName({ mime, 'resource-attributes': fileName === undefined ? undefined : { 'file-name': fileName } } as never);

test('a Web Clipper query after the extension is dropped', () => {
	assert.equal(named('/23e4a5a4.png?width=120&height=80&fit=crop&trim=2,2,2,2'), '23e4a5a4.png');
	assert.equal(named('photo.JPG#top', 'image/jpeg'), 'photo.JPG');
});

test('an extension that is not a plain word stays in the name', () => {
	assert.equal(named('scan.final:v2'), 'scan.final-v2.png');
});

test('a dot in a folder name is not an extension', () => {
	assert.equal(named('v1.2/notes'), 'notes.png');
});

test('a plain extension is kept even when the MIME type differs', () => {
	assert.equal(named('test.file.with.many.dots.txt', 'text/plain'), 'test.file.with.many.dots.txt');
	assert.equal(named('What now?.pdf', 'application/pdf'), 'What now-.pdf');
	assert.equal(named('report.v2#final.pdf', 'application/pdf'), 'report.v2#final.pdf');
});

test('a resource without a name is named after its MIME type', () => {
	assert.equal(named(undefined), 'unknown_filename.png');
	assert.equal(named(undefined, 'application/x-unknown'), 'unknown_filename.dat');
});
