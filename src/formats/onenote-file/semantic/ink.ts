/** Decodes dimension-major, delta-encoded OneNote ink packets.
 * Ported from OfficeIMO's OneNoteInkCodec and semantic mapper (MIT). */

import { OneNoteFormatError } from '../errors';
import { readGuid, readUInt32 } from '../onestore/binary';

export const NATIVE_UNITS_PER_HALF_INCH = 1270;

const X_DIMENSION = '598a6a8f-52c0-4ba0-93af-af357411a561';
const Y_DIMENSION = 'b53f9f75-04e0-4498-a7ee-c30dbb5a9011';
const PRESSURE_DIMENSION = '2d500773-f4f9-4e18-b3f2-2ce1b1a3610c';

export interface InkDimension {
	id: string;
	lower: number;
	upper: number;
}

export function decodeDimensions(data: Uint8Array | undefined): InkDimension[] {
	if (!data || data.length === 0) return [];

	const dimensions: InkDimension[] = [];
	for (let offset = 0; offset + 32 <= data.length; offset += 32) {
		dimensions.push({
			id: readGuid(data, offset),
			lower: readUInt32(data, offset + 16) | 0,
			upper: readUInt32(data, offset + 20) | 0,
		});
	}

	return dimensions;
}

function readVarUInt(data: Uint8Array, cursor: { offset: number }): number {
	let value = 0;
	let shift = 1;

	for (let index = 0; index < 10; index++) {
		if (cursor.offset >= data.length) {
			throw new OneNoteFormatError('ONENOTE_INK_VARINT', 'The ink path contains a truncated multi-byte integer.');
		}

		const current = data[cursor.offset++];
		value += (current & 0x7f) * shift;
		if ((current & 0x80) === 0) return value;

		shift *= 128;
		if (shift > Number.MAX_SAFE_INTEGER) {
			throw new OneNoteFormatError('ONENOTE_INK_VARINT', 'The ink path contains a multi-byte integer wider than supported.');
		}
	}

	throw new OneNoteFormatError('ONENOTE_INK_VARINT', 'The ink path contains an invalid multi-byte integer.');
}

export function decodeSignedVector(data: Uint8Array | undefined, maximumValues: number): number[] {
	if (!data || data.length === 0) return [];

	const cursor = { offset: 0 };
	const count = Math.floor(readVarUInt(data, cursor) / 2);

	if (count > maximumValues) {
		throw new OneNoteFormatError('ONENOTE_INK_PATH_LIMIT', 'The ink path exceeds the configured property value limit.');
	}

	const values = new Array<number>(count);
	for (let index = 0; index < count; index++) {
		if (cursor.offset >= data.length) {
			throw new OneNoteFormatError('ONENOTE_INK_PATH_TRUNCATED', 'The ink path ends before all declared coordinates were decoded.');
		}

		const encoded = readVarUInt(data, cursor);
		const magnitude = Math.floor(encoded / 2);
		values[index] = (encoded & 1) === 0 ? magnitude : -magnitude;
	}

	return values;
}

export function decodePacketValues(encoded: number[], start: number, count: number): number[] {
	const values = new Array<number>(count);
	if (count === 0) return values;

	let value = encoded[start];
	values[0] = value;

	for (let packet = 1; packet < count; packet++) {
		value += encoded[start + packet];
		values[packet] = value;
	}

	return values;
}

export function indexOfDimension(dimensions: InkDimension[], id: string): number {
	return dimensions.findIndex(dimension => dimension.id === id);
}

export const InkDimensionId = {
	x: X_DIMENSION,
	y: Y_DIMENSION,
	pressure: PRESSURE_DIMENSION,
} as const;

export function decodeInkColor(color: number | undefined): string {
	if (color === undefined) return '#000000';

	const red = color & 0xff;
	const green = (color >> 8) & 0xff;
	const blue = (color >> 16) & 0xff;
	const hex = (value: number) => value.toString(16).padStart(2, '0');

	return `#${hex(red)}${hex(green)}${hex(blue)}`;
}

export function decodeRecognitionAlternatives(data: Uint8Array | undefined): string[] {
	if (!data || data.length < 2) return [];

	const text = new TextDecoder('utf-16le').decode(data.subarray(0, data.length - (data.length % 2)));
	return text.split('\0').filter(part => part !== '');
}
