/**
 * The transaction log, which is what says how much of each file-node list is
 * committed.
 *
 * A revision store is append-only: a list on disk can carry nodes from a write
 * that never completed, and only the log knows where the last good transaction
 * ended. Reading it first is what keeps a half-written notebook from being
 * read as a corrupt one. Ported from OfficeIMO's OneNoteTransactionLogReader
 * (MIT).
 */

import { OneNoteFormatError } from '../errors';
import { FileChunkReference, readFileChunkReference64x32, readUInt32 } from './binary';
import { FileHeader } from './file-header';
import { FileKind } from './constants';
import { ReaderOptions } from './options';

const TRANSACTION_ENTRY_LENGTH = 8;
const NEXT_FRAGMENT_LENGTH = 12;

const ONE_POLYNOMIAL = 0xedb88320;
const MSO_POLYNOMIAL = 0x000000af;

/** A section and a table of contents checksum their transactions differently. */
function continueCrc(crc: number, data: Uint8Array, offset: number, count: number, fileKind: FileKind): number {
	const end = offset + count;

	if (fileKind === 'section') {
		let state = ~crc >>> 0;
		for (let index = offset; index < end; index++) {
			state = (state ^ data[index]) >>> 0;
			for (let bit = 0; bit < 8; bit++) state = ((state >>> 1) ^ ((state & 1) !== 0 ? ONE_POLYNOMIAL : 0)) >>> 0;
		}
		return ~state >>> 0;
	}

	let state = crc >>> 0;
	for (let index = offset; index < end; index++) {
		state = (state ^ (data[index] << 24)) >>> 0;
		for (let bit = 0; bit < 8; bit++) state = (((state << 1) >>> 0) ^ ((state & 0x80000000) !== 0 ? MSO_POLYNOMIAL : 0)) >>> 0;
	}
	return state;
}

/** How many nodes of each file-node list the last complete transaction committed. */
export function readTransactionLog(file: Uint8Array, header: FileHeader, options: ReaderOptions): Map<number, number> {
	if (!header.transactionLog || header.transactionCount === undefined || header.expectedFileLength === undefined) {
		throw new OneNoteFormatError('ONENOTE_TRANSACTION_LOG_HEADER', 'The revision-store header does not expose a complete transaction log reference.');
	}

	let current: FileChunkReference = header.transactionLog;
	let completedTransactions = 0;
	let fragmentCount = 0;
	let entryCount = 0;
	let runningCrc = 0;
	const visitedOffsets = new Set<number>();
	const nodeCounts = new Map<number, number>();

	while (completedTransactions < header.transactionCount) {
		if (current.isNil || (current.offset === 0 && current.length === 0) || current.length < TRANSACTION_ENTRY_LENGTH + NEXT_FRAGMENT_LENGTH) {
			throw new OneNoteFormatError('ONENOTE_TRANSACTION_LOG_TRUNCATED', 'The transaction log ended before all committed transactions were found.', current.offset);
		}
		if (++fragmentCount > options.maxTransactionLogFragments) {
			throw new OneNoteFormatError('ONENOTE_TRANSACTION_FRAGMENT_LIMIT', 'The transaction-log fragment limit was exceeded.', current.offset);
		}
		if (visitedOffsets.has(current.offset)) {
			throw new OneNoteFormatError('ONENOTE_TRANSACTION_FRAGMENT_CYCLE', 'The transaction-log fragment chain contains a cycle.', current.offset);
		}
		visitedOffsets.add(current.offset);

		if (current.offset > header.expectedFileLength || current.length > header.expectedFileLength - current.offset) {
			throw new OneNoteFormatError('ONENOTE_TRANSACTION_FRAGMENT_BOUNDS', 'A transaction-log fragment lies outside the declared file length.', current.offset);
		}
		if (current.offset + current.length > file.length) {
			throw new OneNoteFormatError('ONENOTE_TRANSACTION_FRAGMENT_TRUNCATED', 'The file ended while reading a transaction-log fragment.', current.offset);
		}

		const data = file.subarray(current.offset, current.offset + current.length);
		const entryBytes = Math.floor((data.length - NEXT_FRAGMENT_LENGTH) / TRANSACTION_ENTRY_LENGTH) * TRANSACTION_ENTRY_LENGTH;
		let offset = 0;

		while (offset < entryBytes && completedTransactions < header.transactionCount) {
			if (++entryCount > options.maxTransactionEntries) {
				throw new OneNoteFormatError('ONENOTE_TRANSACTION_ENTRY_LIMIT', 'The transaction-entry limit was exceeded.', current.offset + offset);
			}

			const sourceId = readUInt32(data, offset);
			const value = readUInt32(data, offset + 4);

			if (sourceId === 1) {
				if (options.validateTransactionChecksums && value !== runningCrc) {
					throw new OneNoteFormatError('ONENOTE_TRANSACTION_CHECKSUM', 'A committed transaction has an invalid sentinel checksum.', current.offset + offset + 4);
				}
				completedTransactions++;
				runningCrc = continueCrc(runningCrc, data, offset, TRANSACTION_ENTRY_LENGTH, header.fileKind);
				offset += TRANSACTION_ENTRY_LENGTH;
				continue;
			}

			if (sourceId < 0x10) {
				throw new OneNoteFormatError('ONENOTE_TRANSACTION_SOURCE_ID', 'A transaction entry contains an invalid file-node-list identity.', current.offset + offset);
			}
			if (value > options.maxFileNodes) {
				throw new OneNoteFormatError('ONENOTE_TRANSACTION_FILE_NODE_COUNT', 'A transaction entry contains an invalid file-node count.', current.offset + offset + 4);
			}

			const previousCount = nodeCounts.get(sourceId);
			if (previousCount !== undefined && value <= previousCount) {
				throw new OneNoteFormatError('ONENOTE_TRANSACTION_FILE_NODE_SEQUENCE', 'A transaction entry does not increase its file-node-list count.', current.offset + offset + 4);
			}

			nodeCounts.set(sourceId, value);
			runningCrc = continueCrc(runningCrc, data, offset, TRANSACTION_ENTRY_LENGTH, header.fileKind);
			offset += TRANSACTION_ENTRY_LENGTH;
		}

		if (completedTransactions >= header.transactionCount) break;
		current = readFileChunkReference64x32(data, entryBytes);
	}

	if (nodeCounts.size === 0) {
		throw new OneNoteFormatError('ONENOTE_TRANSACTION_LOG_EMPTY', 'The committed transaction log declares no file-node lists.');
	}

	return nodeCounts;
}
