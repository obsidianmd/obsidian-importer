/**
 * The MD5 an ENEX references its attachments by.
 *
 * node:crypto is the reference, and it is here rather than in the plugin
 * because it is not there off the desktop. Checked over every padding boundary
 * - a block ends at 64 bytes, and the length that goes in the last eight of
 * them leaves only 55 for the message - since that is where a hand-written
 * implementation goes wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { md5 } from '../../src/formats/evernote/utils/md5';

function reference(bytes: Uint8Array): string {
	return createHash('md5').update(bytes).digest('hex');
}

test('the digests RFC 1321 prints', () => {
	const of = (text: string) => md5(new TextEncoder().encode(text));

	assert.equal(of(''), 'd41d8cd98f00b204e9800998ecf8427e');
	assert.equal(of('a'), '0cc175b9c0f1b6a831c399e269772661');
	assert.equal(of('abc'), '900150983cd24fb0d6963f7d28e17f72');
	assert.equal(of('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
	assert.equal(of('abcdefghijklmnopqrstuvwxyz'), 'c3fcd3d76192e4007dfb496cca67e13b');
	assert.equal(
		of('12345678901234567890123456789012345678901234567890123456789012345678901234567890'),
		'57edf4a22be3c955ac49da2e2107b67a');
});

test('every length across the padding boundaries agrees with node', () => {
	// 0..130 covers a message that just fits beside its length, one that does
	// not and needs a block of its own, and two whole blocks.
	for (let length = 0; length <= 130; length++) {
		const bytes = new Uint8Array(length);
		for (let i = 0; i < length; i++) bytes[i] = (i * 37 + length) & 0xff;

		assert.equal(md5(bytes), reference(bytes), `at ${length} bytes`);
	}
});

test('a byte value of every kind hashes the same as node', () => {
	const bytes = new Uint8Array(256);
	for (let i = 0; i < 256; i++) bytes[i] = i;

	assert.equal(md5(bytes), reference(bytes));
});

test('a message long enough to carry its length in the high word', () => {
	// The bit length is written as two 32-bit words; anything under 512MB only
	// ever fills the low one, so the high word is checked for being zero.
	const bytes = new Uint8Array(70_000);
	for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 11) & 0xff;

	assert.equal(md5(bytes), reference(bytes));
});
