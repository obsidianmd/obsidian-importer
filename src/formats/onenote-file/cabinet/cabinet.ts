/**
 * The Microsoft Cabinet archive a .onepkg is: CFHEADER, CFFOLDER, CFFILE, then
 * folders of CFDATA blocks holding the .onetoc2 and .one files.
 *
 * Ported from OfficeIMO's OneNoteCabinetArchiveReader (MIT).
 */

import { OneNoteFormatError } from '../errors';
import { lzxDecompress } from './lzx';

const COMPRESSION_NONE = 0x0000;
const COMPRESSION_MSZIP = 0x0001;
const COMPRESSION_LZX = 0x0003;
const COMPRESSION_MASK = 0x000f;
const FLAG_PREVIOUS_CABINET = 0x0001;
const FLAG_NEXT_CABINET = 0x0002;
const FLAG_RESERVE_PRESENT = 0x0004;
const UTF_NAME_ATTRIBUTE = 0x0080;

export interface CabinetEntry {
	name: string;
	data: Uint8Array;
}

/**
 * What the archive says it holds, read from the uncompressed header alone.
 *
 * Names and sizes cost nothing to reach, which is what lets a section picker
 * appear before any of a 19 MB package has been expanded.
 */
export interface CabinetIndex {
	entries: { name: string, length: number, folderIndex: number, folderOffset: number }[];
}

export interface CabinetLimits {
	/** Ceiling on everything the archive expands to, together. */
	maxExpandedBytes: number;
	/** Ceiling on any one entry. */
	maxEntryBytes: number;
	maxEntries: number;
}

export const DEFAULT_CABINET_LIMITS: CabinetLimits = {
	maxExpandedBytes: 2 * 1024 * 1024 * 1024,
	maxEntryBytes: 512 * 1024 * 1024,
	maxEntries: 4096,
};

interface FolderHeader {
	dataOffset: number;
	blockCount: number;
	compression: number;
}

interface FileHeader {
	length: number;
	folderOffset: number;
	folderIndex: number;
	name: string;
}

/** The four-byte longitudinal parity checksum defined by MS-CAB. */
function cabinetChecksum(data: Uint8Array, offset: number, count: number): number {
	let checksum = 0;
	const end = offset + count;

	while (offset <= end - 4) {
		checksum ^= data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
		offset += 4;
	}

	let remainder = 0;
	while (offset < end) remainder = (remainder << 8) | data[offset++];
	return (checksum ^ remainder) >>> 0;
}

function ensure(data: Uint8Array, offset: number, length: number, structure: string): void {
	if (offset < 0 || length < 0 || offset > data.length - length) {
		throw new OneNoteFormatError('ONENOTE_CAB_TRUNCATED', `The .onepkg archive ended inside ${structure}.`, offset);
	}
}

function readUInt16(data: Uint8Array, offset: number): number {
	ensure(data, offset, 2, 'integer');
	return data[offset] | (data[offset + 1] << 8);
}

function readUInt32(data: Uint8Array, offset: number): number {
	ensure(data, offset, 4, 'integer');
	return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function readCString(data: Uint8Array, offset: number, utf8: boolean): { value: string, nextOffset: number } {
	let end = offset;
	while (end < data.length && data[end] !== 0) end++;
	if (end >= data.length) throw new OneNoteFormatError('ONENOTE_CAB_STRING', 'A CAB string is not null-terminated.', offset);

	const bytes = data.subarray(offset, end);
	const value = utf8
		? new TextDecoder().decode(bytes)
		: String.fromCharCode(...bytes);

	return { value, nextOffset: end + 1 };
}

function decompressFolder(
	cabinet: Uint8Array,
	folder: FolderHeader,
	dataReserve: number,
	maxExpandedBytes: number,
	requiredBytes: number,
): Uint8Array {
	let offset = folder.dataOffset;
	const blocks: Uint8Array[] = [];
	const sizes: number[] = [];
	let total = 0;

	for (let index = 0; index < folder.blockCount; index++) {
		ensure(cabinet, offset, 8, 'CFDATA');
		const declaredChecksum = readUInt32(cabinet, offset);
		const compressedLength = readUInt16(cabinet, offset + 4);
		const expandedLength = readUInt16(cabinet, offset + 6);
		const dataOffset = offset + 8 + dataReserve;
		ensure(cabinet, dataOffset, compressedLength, 'CFDATA payload');

		// Blocks past the stop are never decoded, so they are not checked either.
		if (declaredChecksum !== 0 && total < requiredBytes) {
			const actual = cabinetChecksum(cabinet, offset + 4, 4 + dataReserve + compressedLength);
			if (actual !== declaredChecksum) {
				throw new OneNoteFormatError('ONENOTE_CAB_CHECKSUM', 'A CAB data block has an invalid checksum.', offset);
			}
		}

		blocks.push(cabinet.subarray(dataOffset, dataOffset + compressedLength));
		sizes.push(expandedLength);
		total += expandedLength;
		if (total > maxExpandedBytes) {
			throw new OneNoteFormatError('ONENOTE_CAB_EXPANDED_LIMIT', 'The expanded CAB folder exceeds the configured size limit.');
		}
		offset = dataOffset + compressedLength;
	}

	switch (folder.compression & COMPRESSION_MASK) {
		case COMPRESSION_NONE: {
			const output = new Uint8Array(total);
			let outputOffset = 0;
			for (let index = 0; index < blocks.length; index++) {
				if (blocks[index].length !== sizes[index]) {
					throw new OneNoteFormatError('ONENOTE_CAB_UNCOMPRESSED', 'An uncompressed CAB block has inconsistent sizes.');
				}
				output.set(blocks[index], outputOffset);
				outputOffset += blocks[index].length;
			}
			return output;
		}
		case COMPRESSION_LZX:
			return lzxDecompress(blocks, sizes, (folder.compression >> 8) & 0x1f, maxExpandedBytes, requiredBytes);
		case COMPRESSION_MSZIP:
			throw new OneNoteFormatError('ONENOTE_CAB_MSZIP', 'MSZIP-compressed .onepkg archives are not supported yet.');
		default:
			throw new OneNoteFormatError('ONENOTE_CAB_COMPRESSION', 'The .onepkg CAB uses an unsupported compression method.');
	}
}

interface CabinetLayout {
	folders: FolderHeader[];
	files: FileHeader[];
	dataReserve: number;
}

function readLayout(data: Uint8Array, limits: CabinetLimits): CabinetLayout {
	if (data.length < 36 || data[0] !== 0x4d || data[1] !== 0x53 || data[2] !== 0x43 || data[3] !== 0x46) {
		throw new OneNoteFormatError('ONENOTE_CAB_SIGNATURE', 'The .onepkg file is not a Microsoft Cabinet archive.');
	}

	const declaredSize = readUInt32(data, 8);
	const filesOffset = readUInt32(data, 16);
	const folderCount = readUInt16(data, 26);
	const fileCount = readUInt16(data, 28);
	const flags = readUInt16(data, 30);

	if (declaredSize > data.length || folderCount < 1 || fileCount > limits.maxEntries) {
		throw new OneNoteFormatError('ONENOTE_CAB_HEADER', 'The CAB header contains invalid sizes or entry counts.');
	}

	let offset = 36;
	let folderReserve = 0;
	let dataReserve = 0;

	if ((flags & FLAG_RESERVE_PRESENT) !== 0) {
		ensure(data, offset, 4, 'CAB reserve header');
		const headerReserve = readUInt16(data, offset);
		folderReserve = data[offset + 2];
		dataReserve = data[offset + 3];
		offset += 4 + headerReserve;
		ensure(data, offset, 0, 'CAB reserve header');
	}
	if ((flags & FLAG_PREVIOUS_CABINET) !== 0) {
		offset = readCString(data, offset, false).nextOffset;
		offset = readCString(data, offset, false).nextOffset;
	}
	if ((flags & FLAG_NEXT_CABINET) !== 0) {
		offset = readCString(data, offset, false).nextOffset;
		offset = readCString(data, offset, false).nextOffset;
	}

	const folders: FolderHeader[] = [];
	for (let index = 0; index < folderCount; index++) {
		ensure(data, offset, 8, 'CFFOLDER');
		folders.push({
			dataOffset: readUInt32(data, offset),
			blockCount: readUInt16(data, offset + 4),
			compression: readUInt16(data, offset + 6),
		});
		offset += 8 + folderReserve;
	}

	offset = filesOffset;
	const files: FileHeader[] = [];
	for (let index = 0; index < fileCount; index++) {
		ensure(data, offset, 16, 'CFFILE');
		const length = readUInt32(data, offset);
		const folderOffset = readUInt32(data, offset + 4);
		const folderIndex = readUInt16(data, offset + 8);
		const attributes = readUInt16(data, offset + 14);
		const { value: name, nextOffset } = readCString(data, offset + 16, (attributes & UTF_NAME_ATTRIBUTE) !== 0);

		if (length > limits.maxEntryBytes) {
			throw new OneNoteFormatError('ONENOTE_CAB_ENTRY_LIMIT', 'A .onepkg entry exceeds the configured size limit.');
		}

		files.push({ length, folderOffset, folderIndex, name });
		offset = nextOffset;
	}

	return { folders, files, dataReserve };
}

/** What the archive holds, without expanding any of it. */
export function readCabinetIndex(data: Uint8Array, limits: CabinetLimits = DEFAULT_CABINET_LIMITS): CabinetIndex {
	const { files } = readLayout(data, limits);

	return {
		entries: files.map(file => ({
			name: file.name,
			length: file.length,
			folderIndex: file.folderIndex,
			folderOffset: file.folderOffset,
		})),
	};
}

/**
 * Expands the archive, optionally only the entries `wanted` accepts.
 *
 * Filtering cannot skip a folder's earlier bytes — LZX is one stream — but it
 * does stop the decode at the last entry asked for, and the entries nobody
 * asked for are never copied out.
 */
export function readCabinet(
	data: Uint8Array,
	limits: CabinetLimits = DEFAULT_CABINET_LIMITS,
	wanted?: (name: string) => boolean,
): CabinetEntry[] {
	const { folders, files, dataReserve } = readLayout(data, limits);
	const selected = wanted ? files.filter(file => wanted(file.name)) : files;

	const requiredBytes = new Array<number>(folders.length).fill(0);
	for (const file of selected) {
		if (file.folderIndex >= folders.length) {
			throw new OneNoteFormatError('ONENOTE_CAB_FOLDER', 'A .onepkg entry references a missing or continued CAB folder.');
		}
		requiredBytes[file.folderIndex] = Math.max(requiredBytes[file.folderIndex], file.folderOffset + file.length);
	}

	const folderData: (Uint8Array | undefined)[] = [];
	let totalExpanded = 0;
	for (let index = 0; index < folders.length; index++) {
		if (requiredBytes[index] === 0) {
			folderData.push(undefined);
			continue;
		}

		const expanded = decompressFolder(data, folders[index], dataReserve, limits.maxExpandedBytes - totalExpanded, requiredBytes[index]);
		totalExpanded += expanded.length;
		if (totalExpanded > limits.maxExpandedBytes) {
			throw new OneNoteFormatError('ONENOTE_CAB_EXPANDED_LIMIT', 'The expanded .onepkg archive exceeds the configured size limit.');
		}
		folderData.push(expanded);
	}

	const entries: CabinetEntry[] = [];
	let totalExtractedBytes = 0;
	for (const file of selected) {
		const source = folderData[file.folderIndex];
		if (!source || file.folderOffset > source.length || file.folderOffset + file.length > source.length) {
			throw new OneNoteFormatError('ONENOTE_CAB_ENTRY_RANGE', 'A .onepkg entry extends past its CAB folder.');
		}
		if (file.length > limits.maxExpandedBytes - totalExtractedBytes) {
			throw new OneNoteFormatError('ONENOTE_CAB_EXPANDED_LIMIT', 'The extracted .onepkg entries exceed the configured size limit.');
		}

		totalExtractedBytes += file.length;
		entries.push({ name: file.name, data: source.subarray(file.folderOffset, file.folderOffset + file.length) });
	}

	return entries;
}
