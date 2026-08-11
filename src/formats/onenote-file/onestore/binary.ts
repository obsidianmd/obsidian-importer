/** Little-endian MS-ONESTORE reads; unsafe 64-bit integers are rejected. */

import { OneNoteFormatError } from '../errors';

export function ensureRange(data: Uint8Array, offset: number, length: number): void {
	if (offset < 0 || length < 0 || offset > data.length - length) {
		throw new OneNoteFormatError(
			'ONENOTE_TRUNCATED_STRUCTURE',
			'The OneNote file ended before a required structure could be read.',
			offset);
	}
}

export function readUInt16(data: Uint8Array, offset: number): number {
	ensureRange(data, offset, 2);
	return data[offset] | (data[offset + 1] << 8);
}

export function readUInt32(data: Uint8Array, offset: number): number {
	ensureRange(data, offset, 4);
	return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

export function readUInt64(data: Uint8Array, offset: number): number {
	const low = readUInt32(data, offset);
	const high = readUInt32(data, offset + 4);

	if (high > 0x1fffff) {
		throw new OneNoteFormatError('ONENOTE_OFFSET_RANGE', 'A OneNote file offset exceeds the supported range.', offset);
	}

	return high * 0x100000000 + low;
}

export function isAllOnes(data: Uint8Array, offset: number, length: number): boolean {
	ensureRange(data, offset, length);
	for (let index = 0; index < length; index++) {
		if (data[offset + index] !== 0xff) return false;
	}
	return true;
}

export function readUnsigned(data: Uint8Array, offset: number, length: number): number {
	ensureRange(data, offset, length);

	let value = 0;
	for (let index = length - 1; index >= 0; index--) {
		if (value > Number.MAX_SAFE_INTEGER / 256) {
			throw new OneNoteFormatError('ONENOTE_OFFSET_RANGE', 'A OneNote file offset exceeds the supported range.', offset);
		}
		value = value * 256 + data[offset + index];
	}

	return value;
}

export function bytesEqual(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
	ensureRange(data, offset, expected.length);
	for (let index = 0; index < expected.length; index++) {
		if (data[offset + index] !== expected[index]) return false;
	}
	return true;
}

/** Reads the mixed-endian GUID layout used by .NET. */
export function readGuid(data: Uint8Array, offset: number): string {
	ensureRange(data, offset, 16);

	const hex = (index: number) => data[offset + index].toString(16).padStart(2, '0');
	return [
		hex(3) + hex(2) + hex(1) + hex(0),
		hex(5) + hex(4),
		hex(7) + hex(6),
		hex(8) + hex(9),
		hex(10) + hex(11) + hex(12) + hex(13) + hex(14) + hex(15),
	].join('-');
}

export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

export interface FileChunkReference {
	offset: number;
	length: number;
	isNil: boolean;
}

export function readFileChunkReference64x32(data: Uint8Array, offset: number): FileChunkReference {
	const length = readUInt32(data, offset + 8);

	if (isAllOnes(data, offset, 8) && length === 0) {
		return { offset: 0, length: 0, isNil: true };
	}

	return { offset: readUInt64(data, offset), length, isNil: false };
}

export function isZeroReference(reference: FileChunkReference): boolean {
	return !reference.isNil && reference.offset === 0 && reference.length === 0;
}
