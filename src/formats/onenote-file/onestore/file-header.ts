/**
 * The 1 KB header that opens a .one or .onetoc2, in either of the two
 * packagings OneNote writes: the desktop revision store, and the MS-FSSHTTPB
 * package the modern apps and OneDrive produce.
 *
 * Which one a file uses is decided by the format GUID at offset 48, and it is
 * the fork that determines everything downstream. Ported from OfficeIMO's
 * OneNoteFileHeaderReader (MIT).
 */

import { OneNoteFormatError } from '../errors';
import {
	EMPTY_GUID,
	FileChunkReference,
	ensureRange,
	isZeroReference,
	readFileChunkReference64x32,
	readGuid,
	readUInt16,
	readUInt32,
	readUInt64,
} from './binary';
import {
	FileKind,
	PACKAGE_STORE_FIXED_PREFIX_LENGTH,
	PACKAGE_STORE_FORMAT,
	REVISION_STORE_FORMAT,
	REVISION_STORE_HEADER_LENGTH,
	SECTION_CELL_SCHEMA,
	SECTION_FILE_TYPE,
	StorageFormat,
	TABLE_OF_CONTENTS_CELL_SCHEMA,
	TABLE_OF_CONTENTS_FILE_TYPE,
} from './constants';
import { Diagnostic, ReaderOptions } from './options';

export interface ExtendedGuid {
	identifier: string;
	value: number;
	encodedLength: number;
}

export interface FileHeader {
	fileKind: FileKind;
	storageFormat: StorageFormat;
	fileTypeId: string;
	fileId: string;
	legacyFileVersionId: string;
	fileFormatId: string;
	actualFileLength?: number;
	expectedFileLength?: number;
	transactionCount?: number;
	ancestorId?: string;
	fileVersionId?: string;
	fileVersionGeneration?: number;
	denyReadFileVersionId?: string;
	hashedChunkList?: FileChunkReference;
	transactionLog?: FileChunkReference;
	rootFileNodeList?: FileChunkReference;
	freeChunkList?: FileChunkReference;
	storageIndexId?: ExtendedGuid;
	cellSchemaId?: string;
	diagnostics: Diagnostic[];
}

/** An MS-FSSHTTPB extended GUID, whose width is announced by its first bits. */
export function readExtendedGuid(data: Uint8Array, offset: number): ExtendedGuid {
	ensureRange(data, offset, 1);
	const first = data[offset];

	if (first === 0) return { identifier: EMPTY_GUID, value: 0, encodedLength: 1 };

	if ((first & 0x07) === 0x04) {
		ensureRange(data, offset, 17);
		return { identifier: readGuid(data, offset + 1), value: first >> 3, encodedLength: 17 };
	}

	const firstTwo = readUInt16(data, offset);
	if ((firstTwo & 0x3f) === 0x20) {
		ensureRange(data, offset, 18);
		return { identifier: readGuid(data, offset + 2), value: firstTwo >> 6, encodedLength: 18 };
	}

	ensureRange(data, offset, 3);
	const firstThree = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
	if ((firstThree & 0x7f) === 0x40) {
		ensureRange(data, offset, 19);
		return { identifier: readGuid(data, offset + 3), value: firstThree >>> 7, encodedLength: 19 };
	}

	if (first === 0x80) {
		ensureRange(data, offset, 21);
		return { identifier: readGuid(data, offset + 5), value: readUInt32(data, offset + 1), encodedLength: 21 };
	}

	throw new OneNoteFormatError(
		'ONENOTE_FSSHTTP_EXTENDED_GUID',
		'The package contains an invalid MS-FSSHTTPB extended GUID encoding.',
		offset);
}

export function readFileHeader(data: Uint8Array, actualFileLength: number | undefined, options: ReaderOptions): FileHeader {
	if (data.length >= 4 && data[0] === 0x4d && data[1] === 0x53 && data[2] === 0x43 && data[3] === 0x46) {
		return {
			fileKind: 'notebook-package',
			storageFormat: 'notebook-package',
			fileTypeId: EMPTY_GUID,
			fileId: EMPTY_GUID,
			legacyFileVersionId: EMPTY_GUID,
			fileFormatId: EMPTY_GUID,
			actualFileLength,
			diagnostics: [],
		};
	}

	ensureRange(data, 0, 64);
	const fileFormat = readGuid(data, 48);

	if (fileFormat === REVISION_STORE_FORMAT) return readRevisionStoreHeader(data, actualFileLength, options);
	if (fileFormat === PACKAGE_STORE_FORMAT) return readPackageStoreHeader(data, actualFileLength, options);

	throw new OneNoteFormatError(
		'ONENOTE_UNKNOWN_FILE_FORMAT',
		'The file does not contain a recognized MS-ONESTORE or package-store format identifier.',
		48);
}

function readRevisionStoreHeader(data: Uint8Array, actualFileLength: number | undefined, options: ReaderOptions): FileHeader {
	ensureRange(data, 0, REVISION_STORE_HEADER_LENGTH);

	const fileType = readGuid(data, 0);
	const header: FileHeader = {
		fileKind: resolveDesktopFileKind(fileType),
		storageFormat: 'revision-store',
		fileTypeId: fileType,
		fileId: readGuid(data, 16),
		legacyFileVersionId: readGuid(data, 32),
		fileFormatId: readGuid(data, 48),
		actualFileLength,
		transactionCount: readUInt32(data, 96),
		ancestorId: readGuid(data, 128),
		hashedChunkList: readFileChunkReference64x32(data, 148),
		transactionLog: readFileChunkReference64x32(data, 160),
		rootFileNodeList: readFileChunkReference64x32(data, 172),
		freeChunkList: readFileChunkReference64x32(data, 184),
		expectedFileLength: readUInt64(data, 196),
		fileVersionId: readGuid(data, 212),
		fileVersionGeneration: readUInt64(data, 228),
		denyReadFileVersionId: readGuid(data, 236),
		diagnostics: [],
	};

	validateRevisionStoreHeader(data, header, options);
	return header;
}

function readPackageStoreHeader(data: Uint8Array, actualFileLength: number | undefined, options: ReaderOptions): FileHeader {
	ensureRange(data, 0, PACKAGE_STORE_FIXED_PREFIX_LENGTH + 1);

	const fileType = readGuid(data, 0);
	if (fileType !== SECTION_FILE_TYPE) {
		throw new OneNoteFormatError(
			'ONENOTE_PACKAGE_FILE_TYPE',
			'The package-store header does not contain the required OneNote file-type identifier.',
			0);
	}

	const streamHeader = readUInt32(data, 68);
	const headerType = streamHeader & 0x03;
	const compound = (streamHeader & 0x04) !== 0;
	const streamObjectType = (streamHeader >>> 3) & 0x3fff;
	const declaredLength = streamHeader >>> 17;

	if (headerType !== 0x02 || !compound || streamObjectType !== 0x7a) {
		throw new OneNoteFormatError(
			'ONENOTE_PACKAGE_START',
			'The package-store header does not begin with the required packaging stream object.',
			68);
	}
	if (declaredLength === 0x7fff) {
		throw new OneNoteFormatError(
			'ONENOTE_PACKAGE_LARGE_HEADER',
			'A package-store header with a large-length packaging prefix is not valid for the fixed OneNote envelope.',
			68);
	}

	const storageIndex = readExtendedGuid(data, 72);
	if (storageIndex.identifier === EMPTY_GUID) {
		throw new OneNoteFormatError(
			'ONENOTE_PACKAGE_STORAGE_INDEX',
			'The package-store storage index identifier cannot be empty.',
			72);
	}

	const cellSchema = readGuid(data, 72 + storageIndex.encodedLength);
	const header: FileHeader = {
		fileKind: resolveCellSchemaKind(cellSchema),
		storageFormat: 'file-synchronization-package',
		fileTypeId: fileType,
		fileId: readGuid(data, 16),
		legacyFileVersionId: readGuid(data, 32),
		fileFormatId: readGuid(data, 48),
		actualFileLength,
		storageIndexId: storageIndex,
		cellSchemaId: cellSchema,
		diagnostics: [],
	};

	if (declaredLength !== storageIndex.encodedLength + 16) {
		reportOrThrow(
			header,
			options,
			'ONENOTE_PACKAGE_PREFIX_LENGTH',
			'The packaging stream object length does not match the storage-index and cell-schema payload.',
			68);
	}

	return header;
}

function validateRevisionStoreHeader(data: Uint8Array, header: FileHeader, options: ReaderOptions): void {
	const expectedVersion = header.fileKind === 'section' ? 0x2a : 0x1b;
	for (let offset = 64; offset <= 76; offset += 4) {
		if (readUInt32(data, offset) !== expectedVersion) {
			reportOrThrow(
				header,
				options,
				'ONENOTE_FILE_VERSION',
				'The revision-store header contains a file-format version that does not match its file type.',
				offset);
		}
	}

	if (header.legacyFileVersionId !== EMPTY_GUID) {
		reportOrThrow(
			header,
			options,
			'ONENOTE_LEGACY_VERSION_GUID',
			'The desktop revision-store legacy file-version identifier is not empty.',
			32);
	}

	if (!header.transactionCount) {
		throw new OneNoteFormatError('ONENOTE_TRANSACTION_COUNT', 'The revision-store header declares no complete transactions.', 96);
	}

	if (header.expectedFileLength === undefined || header.expectedFileLength < REVISION_STORE_HEADER_LENGTH) {
		throw new OneNoteFormatError('ONENOTE_EXPECTED_FILE_LENGTH', 'The revision-store header declares an invalid expected file length.', 196);
	}

	if (header.actualFileLength !== undefined) {
		if (header.actualFileLength < header.expectedFileLength) {
			throw new OneNoteFormatError(
				'ONENOTE_TRUNCATED_FILE',
				'The source is shorter than the file length declared by its revision-store header.',
				header.actualFileLength);
		}
		if (header.actualFileLength > header.expectedFileLength) {
			header.diagnostics.push({
				code: 'ONENOTE_TRAILING_DATA',
				message: 'The source contains trailing bytes beyond the file length declared by its revision-store header.',
				offset: header.expectedFileLength,
			});
		}
	}

	validateRequiredReference(header.transactionLog, 'transaction log', 160, header.expectedFileLength);
	validateRequiredReference(header.rootFileNodeList, 'root file-node list', 172, header.expectedFileLength);
	validateOptionalReference(header.hashedChunkList, 'hashed chunk list', 148, header.expectedFileLength);
	validateOptionalReference(header.freeChunkList, 'free chunk list', 184, header.expectedFileLength);
}

function resolveDesktopFileKind(fileType: string): FileKind {
	if (fileType === SECTION_FILE_TYPE) return 'section';
	if (fileType === TABLE_OF_CONTENTS_FILE_TYPE) return 'table-of-contents';
	throw new OneNoteFormatError('ONENOTE_FILE_TYPE', 'The revision-store header contains an unsupported OneNote file-type identifier.', 0);
}

function resolveCellSchemaKind(schema: string): FileKind {
	if (schema === SECTION_CELL_SCHEMA) return 'section';
	if (schema === TABLE_OF_CONTENTS_CELL_SCHEMA) return 'table-of-contents';
	throw new OneNoteFormatError('ONENOTE_CELL_SCHEMA', 'The package-store header contains an unsupported OneNote cell-schema identifier.');
}

function validateRequiredReference(reference: FileChunkReference | undefined, name: string, offset: number, expectedFileLength: number): void {
	if (!reference || reference.isNil || isZeroReference(reference) || reference.length === 0) {
		throw new OneNoteFormatError('ONENOTE_REQUIRED_CHUNK_REFERENCE', `The revision-store ${name} reference is missing.`, offset);
	}
	validateReferenceBounds(reference, name, offset, expectedFileLength);
}

function validateOptionalReference(reference: FileChunkReference | undefined, name: string, offset: number, expectedFileLength: number): void {
	if (!reference || reference.isNil || isZeroReference(reference)) return;
	validateReferenceBounds(reference, name, offset, expectedFileLength);
}

function validateReferenceBounds(reference: FileChunkReference, name: string, offset: number, expectedFileLength: number): void {
	if (reference.offset > expectedFileLength || reference.length > expectedFileLength - reference.offset) {
		throw new OneNoteFormatError(
			'ONENOTE_CHUNK_REFERENCE_BOUNDS',
			`The revision-store ${name} reference lies outside the declared file length.`,
			offset);
	}
}

function reportOrThrow(header: FileHeader, options: ReaderOptions, code: string, message: string, offset: number): void {
	if (options.strictHeaderValidation) throw new OneNoteFormatError(code, message, offset);
	header.diagnostics.push({ code, message, offset });
}
