import { OneNoteFormatError } from './errors';
import { readUInt16, readUInt32 } from './onestore/binary';

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const DIRECTORY_ENTRY_LENGTH = 128;
const MAX_DIRECTORY_SECTORS = 4096;

export type OnexKind =
	| 'rights-protected'
	| 'unrecognised';

export function isCompoundFile(data: Uint8Array): boolean {
	if (data.length < SIGNATURE.length) return false;
	return SIGNATURE.every((byte, index) => data[index] === byte);
}

export function inspectOnex(data: Uint8Array): OnexKind {
	if (!isCompoundFile(data)) {
		throw new OneNoteFormatError('ONENOTE_ONEX_SIGNATURE', 'The .onex file is not an OLE compound file.');
	}

	const sectorSize = 1 << readUInt16(data, 30);
	const fatSectorCount = readUInt32(data, 44);
	const firstDirectorySector = readUInt32(data, 48);

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
	return streams.some(name => protectedBy.includes(name)) ? 'rights-protected' : 'unrecognised';
}
