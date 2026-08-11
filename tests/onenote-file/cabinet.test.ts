/**
 * The Cabinet/LZX port, checked against archives Windows makecab produced.
 *
 * These are the only tests here that do not compare against a recording: a
 * makecab archive expanding to the exact bytes it was built from is agreement
 * with Microsoft's compressor, which is what makes them worth having.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeFs from 'node:fs';
import nodePath from 'node:path';

import { readCabinet, readCabinetIndex } from '../../src/formats/onenote-file/cabinet/cabinet';
import { OneNoteFormatError } from '../../src/formats/onenote-file/errors';

const FIXTURES = nodePath.join(__dirname, 'fixtures');

function fixture(name: string): Uint8Array {
	return new Uint8Array(nodeFs.readFileSync(nodePath.join(FIXTURES, name)));
}

const LIMITS = { maxExpandedBytes: 1024 * 1024, maxEntryBytes: 1024 * 1024, maxEntries: 10 };

/** The payload OfficeIMO built the e8 archives from, rebuilt rather than stored. */
function e8OraclePayload(): Uint8Array {
	const pattern = new TextEncoder().encode('OfficeIMO-LZX-E8-independent-oracle-');
	const payload = new Uint8Array(4096);
	for (let index = 0; index < payload.length; index++) payload[index] = pattern[index % pattern.length];

	for (const [offset, displacement] of [[64, 500], [1024, -50], [2048, 1_000_000]] as [number, number][]) {
		payload[offset] = 0xe8;
		new DataView(payload.buffer).setInt32(offset + 1, displacement, true);
	}

	return payload;
}

for (const name of [
	'makecab-lzx15-e8.cab',
	'makecab-lzx16-e8.cab',
	'makecab-lzx17-e8.cab',
	'makecab-lzx18-e8.cab',
	'makecab-lzx19-e8.cab',
	'makecab-lzx20-e8.cab',
	'makecab-lzx-e8.cab',
]) {
	test(`${name} reverses E8 translation the way makecab applied it`, () => {
		const entries = readCabinet(fixture(name), LIMITS);

		assert.equal(entries.length, 1);
		assert.equal(entries[0].name, 'officeimo-lzx-e8.bin');
		assert.deepEqual(entries[0].data, e8OraclePayload());
	});
}

for (const [archive, expanded] of [
	['makecab-lzx-testOneNote2016.cab', 'testOneNote2016.one'],
	['makecab-lzx-testOneNoteFromOffice365-2.cab', 'testOneNoteFromOffice365-2.one'],
] as [string, string][]) {
	test(`${archive} expands to ${expanded} byte for byte`, () => {
		const entries = readCabinet(fixture(archive), { ...LIMITS, maxExpandedBytes: 1024 * 1024, maxEntryBytes: 1024 * 1024 });

		assert.equal(entries.length, 1);
		assert.deepEqual(entries[0].data, fixture(expanded));
	});
}

test('a flipped bit in a CFDATA block is caught by its checksum', () => {
	const cabinet = fixture('makecab-lzx-testOneNote2016.cab');
	const dataOffset = new DataView(cabinet.buffer, cabinet.byteOffset).getUint32(36, true);
	cabinet[dataOffset + 8] ^= 0x01;

	assert.throws(
		() => readCabinet(cabinet, LIMITS),
		(error: unknown) => error instanceof OneNoteFormatError && error.code === 'ONENOTE_CAB_CHECKSUM');
});

test('a file that is not a cabinet is refused by signature', () => {
	assert.throws(
		() => readCabinet(new Uint8Array(64), LIMITS),
		(error: unknown) => error instanceof OneNoteFormatError && error.code === 'ONENOTE_CAB_SIGNATURE');
});

test('the index names every entry without expanding any of them', () => {
	const index = readCabinetIndex(fixture('makecab-lzx-notebook.onepkg'), LIMITS);
	const entries = readCabinet(fixture('makecab-lzx-notebook.onepkg'), LIMITS);

	assert.deepEqual(index.entries.map(entry => entry.name), entries.map(entry => entry.name));
	assert.deepEqual(index.entries.map(entry => entry.length), entries.map(entry => entry.data.length));
});

test('stopping the decode early does not change the bytes it did produce', () => {
	const archive = fixture('makecab-lzx-notebook.onepkg');
	const everything = readCabinet(archive, LIMITS);

	for (const entry of everything) {
		const [alone] = readCabinet(archive, LIMITS, name => name === entry.name);

		assert.equal(alone.name, entry.name);
		assert.deepEqual(alone.data, entry.data, `${entry.name} differs when expanded on its own`);
	}
});

test('an entry nobody asked for is not returned', () => {
	const archive = fixture('makecab-lzx-notebook.onepkg');

	assert.deepEqual(readCabinet(archive, LIMITS, () => false), []);
});
