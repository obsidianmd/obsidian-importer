/**
 * What a .onex actually is.
 *
 * Unlike .one and .onepkg it is an OLE compound file, and the one thing worth
 * knowing about it before trying to read further is whether its payload is
 * rights-protected. A Purview sensitivity label leaves the notebook inside an
 * `EncryptedPackage` stream that only Azure RMS can open, so the useful answer
 * there is to say so plainly rather than to fail somewhere deeper.
 *
 * Only the header and the directory are walked; nothing is decoded.
 */

import { OneNoteFormatError } from './errors';
import { readUInt16, readUInt32 } from './onestore/binary';

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const DIRECTORY_ENTRY_LENGTH = 128;
const MAX_DIRECTORY_SECTORS = 4096;

export type OnexKind =
	/** Rights-managed: the content is encrypted and cannot be read here. */
	| 'rights-protected'
	/** A compound file whose layout this importer does not recognise. */
	| 'unrecognised';

export interface OnexInspection {
	kind: OnexKind;
	streams: string[];
}

export function isCompoundFile(data: Uint8Array): boolean {
	if (data.length < SIGNATURE.length) return false;
	return SIGNATURE.every((byte, index) => data[index] === byte);
}

/** Names every directory entry, following the FAT chain that holds them. */
export function inspectOnex(data: Uint8Array): OnexInspection {
	if (!isCompoundFile(data)) {
		throw new OneNoteFormatError('ONENOTE_ONEX_SIGNATURE', 'The .onex file is not an OLE compound file.');
	}

	const sectorSize = 1 << readUInt16(data, 30);
	const fatSectorCount = readUInt32(data, 44);
	const firstDirectorySector = readUInt32(data, 48);

	// The header carries the first 109 FAT sector numbers, which is every one
	// a file this size can have; a longer chain would need the DIFAT sectors.
	const fat: number[] = [];
	for (let index = 0; index < Math.min(fatSectorCount, 109); index++) {
		const sector = readUInt32(data, 76 + index * 4);
		const base = (sector + 1) * sectorSize;
		if (base + sectorSize > data.length) break;
		for (let offset = 0; offset < sectorSize; offset += 4) fat.push(readUInt32(data, base + offset));
	}

	const streams: string[] = [];
	const seen = new Set<number>();
	let sector = firstDirectorySector;

	while (sector < 0xfffffffa && !seen.has(sector) && seen.size < MAX_DIRECTORY_SECTORS) {
		seen.add(sector);

		const base = (sector + 1) * sectorSize;
		if (base + sectorSize > data.length) break;

		for (let offset = 0; offset < sectorSize; offset += DIRECTORY_ENTRY_LENGTH) {
			const nameLength = readUInt16(data, base + offset + 64);
			if (nameLength < 2 || data[base + offset + 66] === 0) continue;

			streams.push(new TextDecoder('utf-16le').decode(data.subarray(base + offset, base + offset + nameLength - 2)));
		}

		sector = fat[sector] ?? 0xfffffffe;
	}

	const protectedBy = ['EncryptedPackage', 'DRMEncryptedTransform', 'DRMEncryptedDataSpace'];
	const kind: OnexKind = streams.some(name => protectedBy.includes(name)) ? 'rights-protected' : 'unrecognised';

	return { kind, streams };
}
