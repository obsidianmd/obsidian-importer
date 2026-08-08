/**
 * The extension a file's own first bytes call for, which is what names an
 * attachment whose source carries no extension of its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extensionFromBytes } from '../../src/util';

const bytes = (...values: number[]) => new Uint8Array(values);

/** An ISO base media header, which is a length, "ftyp", and a brand. */
function isoBrand(brand: string): Uint8Array {
	const out = new Uint8Array(16);
	for (let i = 0; i < 4; i++) out[4 + i] = 'ftyp'.charCodeAt(i);
	for (let i = 0; i < 4; i++) out[8 + i] = brand.charCodeAt(i);

	return out;
}

test('the formats an import is likely to meet', () => {
	assert.equal(extensionFromBytes(bytes(0x89, 0x50, 0x4e, 0x47)), 'png');
	assert.equal(extensionFromBytes(bytes(0xff, 0xd8, 0xff)), 'jpg');
	assert.equal(extensionFromBytes(bytes(0x25, 0x50, 0x44, 0x46)), 'pdf');
	assert.equal(extensionFromBytes(bytes(0x47, 0x49, 0x46, 0x38)), 'gif');
	assert.equal(extensionFromBytes(bytes(0x00, 0x01, 0x02)), null);
});

/**
 * An ISO base media file names its flavour in the brand after "ftyp", and most
 * of them are not video. Calling an image mp4 leaves Obsidian treating it as
 * one, which does not embed.
 */
test('an ISO base media file is named after its brand', () => {
	assert.equal(extensionFromBytes(isoBrand('avif')), 'avif');
	assert.equal(extensionFromBytes(isoBrand('avis')), 'avif');
	assert.equal(extensionFromBytes(isoBrand('heic')), 'heic');
	assert.equal(extensionFromBytes(isoBrand('heix')), 'heic');
	assert.equal(extensionFromBytes(isoBrand('mif1')), 'heic');
	assert.equal(extensionFromBytes(isoBrand('msf1')), 'heic');
	assert.equal(extensionFromBytes(isoBrand('qt  ')), 'mov');
	assert.equal(extensionFromBytes(isoBrand('mp42')), 'mp4');
	assert.equal(extensionFromBytes(isoBrand('isom')), 'mp4');
});
