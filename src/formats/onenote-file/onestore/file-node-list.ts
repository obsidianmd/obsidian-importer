/**
 * File-node lists: the chain of fragments a revision store is navigated by.
 *
 * Each fragment holds nodes back to back, then points at the next; the count
 * the transaction log committed decides where reading stops, because a
 * fragment can carry more nodes on disk than the last good write covered.
 * Ported from OfficeIMO's OneNoteFileNodeListReader (MIT).
 */

import { OneNoteFormatError } from '../errors';
import {
	FileChunkReference,
	bytesEqual,
	isAllOnes,
	readUInt32,
	readUnsigned,
} from './binary';
import {
	FILE_NODE_LIST_FOOTER_MAGIC,
	FILE_NODE_LIST_HEADER_MAGIC,
	FileNodeBaseType,
	FileNodeId,
} from './constants';
import { ReaderOptions } from './options';

const FRAGMENT_HEADER_LENGTH = 16;
const FRAGMENT_TRAILER_LENGTH = 20;

export interface FileNodeChunkReference {
	offset: number;
	length: number;
	isNil: boolean;
	encodedLength: number;
}

export interface FileNode {
	id: number;
	size: number;
	stpFormat: number;
	cbFormat: number;
	baseType: FileNodeBaseType;
	fileOffset: number;
	chunkReference?: FileNodeChunkReference;
	/** The fnd payload, including any leading chunk reference. A view, not a copy. */
	data: Uint8Array;
	referencedList?: FileNodeList;
}

export interface FileNodeList {
	id: number;
	nodes: FileNode[];
}

const BASE_TYPES: FileNodeBaseType[] = ['inline', 'data-reference', 'file-node-list-reference'];

export function readFileNodeList(
	file: Uint8Array,
	firstFragment: FileChunkReference,
	declaredFileLength: number,
	committedNodeCounts: Map<number, number>,
	options: ReaderOptions,
): FileNodeList {
	const nodes: FileNode[] = [];
	const visitedOffsets = new Set<number>();
	let current = firstFragment;
	let listId: number | undefined;
	let committedNodeCount = 0;
	let expectedSequence = 0;
	let fragmentCount = 0;

	while (!current.isNil) {
		if ((current.offset === 0 && current.length === 0) || current.length < FRAGMENT_HEADER_LENGTH + FRAGMENT_TRAILER_LENGTH) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_FRAGMENT_REFERENCE', 'A file-node-list fragment reference is empty or too short.', current.offset);
		}
		if (fragmentCount >= options.maxFileNodeListFragments) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_FRAGMENT_LIMIT', 'The file-node-list fragment limit was exceeded.', current.offset);
		}
		if (visitedOffsets.has(current.offset)) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_FRAGMENT_CYCLE', 'The file-node-list fragment chain contains a cycle.', current.offset);
		}
		visitedOffsets.add(current.offset);
		validateBounds(current.offset, current.length, declaredFileLength, 'file-node-list fragment');

		if (current.offset + current.length > file.length) {
			throw new OneNoteFormatError('ONENOTE_TRUNCATED_STRUCTURE', 'The OneNote file ended while reading a referenced structure.', current.offset);
		}

		const data = file.subarray(current.offset, current.offset + current.length);
		if (!bytesEqual(data, 0, FILE_NODE_LIST_HEADER_MAGIC)) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_HEADER_MAGIC', 'The file-node-list fragment header magic is invalid.', current.offset);
		}

		const currentListId = readUInt32(data, 8);
		const sequence = readUInt32(data, 12);

		if (currentListId < 0x10) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_LIST_ID', 'The file-node-list identity is below the minimum valid value.', current.offset + 8);
		}
		if (listId !== undefined && listId !== currentListId) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_LIST_MISMATCH', 'A fragment belongs to a different file-node list.', current.offset + 8);
		}
		if (listId === undefined) {
			const count = committedNodeCounts.get(currentListId);
			if (count === undefined) {
				throw new OneNoteFormatError('ONENOTE_TRANSACTION_FILE_NODE_LIST', 'The transaction log does not declare the referenced file-node list.', current.offset + 8);
			}
			if (count < 1 || count > options.maxFileNodes) {
				throw new OneNoteFormatError('ONENOTE_TRANSACTION_FILE_NODE_COUNT', 'The transaction log declares an invalid file-node count.', current.offset + 8);
			}
			committedNodeCount = count;
		}
		if (sequence !== expectedSequence) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_SEQUENCE', 'The file-node-list fragment sequence is not contiguous.', current.offset + 12);
		}
		if (!bytesEqual(data, data.length - 8, FILE_NODE_LIST_FOOTER_MAGIC)) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_FOOTER_MAGIC', 'The file-node-list fragment footer magic is invalid.', current.offset + data.length - 8);
		}

		listId = currentListId;
		fragmentCount++;

		const remainingNodes = committedNodeCount - nodes.length;
		if (remainingNodes <= 0) break;

		const fragmentNodes = readNodes(
			data,
			FRAGMENT_HEADER_LENGTH,
			data.length - FRAGMENT_TRAILER_LENGTH,
			current.offset,
			declaredFileLength,
			options,
			nodes.length,
			remainingNodes);

		if (nodes.length > options.maxFileNodes - fragmentNodes.length) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_LIMIT', 'The file-node limit was exceeded.', current.offset);
		}
		for (const node of fragmentNodes) nodes.push(node);

		current = readFragmentReference(data, data.length - FRAGMENT_TRAILER_LENGTH);
		expectedSequence++;
		if (nodes.length === committedNodeCount) break;
	}

	if (listId === undefined) {
		throw new OneNoteFormatError('ONENOTE_FILE_NODE_LIST_EMPTY', 'The file-node list contains no fragments.');
	}
	if (nodes.length !== committedNodeCount) {
		throw new OneNoteFormatError('ONENOTE_FILE_NODE_COUNT', 'The file-node list ended before its committed transaction-log count was reached.', firstFragment.offset);
	}

	return { id: listId, nodes };
}

function readFragmentReference(data: Uint8Array, offset: number): FileChunkReference {
	const length = readUInt32(data, offset + 8);
	if (isAllOnes(data, offset, 8) && length === 0) return { offset: 0, length: 0, isNil: true };
	return { offset: readUnsigned(data, offset, 8), length, isNil: false };
}

function readNodes(
	data: Uint8Array,
	start: number,
	limit: number,
	fragmentOffset: number,
	declaredFileLength: number,
	options: ReaderOptions,
	priorNodeCount: number,
	maximumNodes: number,
): FileNode[] {
	const nodes: FileNode[] = [];
	let offset = start;

	while (limit - offset >= 4 && nodes.length < maximumNodes) {
		if (priorNodeCount + nodes.length >= options.maxFileNodes) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_LIMIT', 'The file-node limit was exceeded.', fragmentOffset + offset);
		}

		const header = readUInt32(data, offset);
		const id = header & 0x3ff;

		// A final fragment runs into zero padding; identifier zero is not assigned.
		if (id === 0) break;

		const size = (header >>> 10) & 0x1fff;
		const stpFormat = (header >>> 23) & 0x03;
		const cbFormat = (header >>> 25) & 0x03;
		const rawBaseType = (header >>> 27) & 0x0f;

		if ((header & 0x80000000) === 0) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_RESERVED_BIT', 'The required file-node reserved bit is not set.', fragmentOffset + offset);
		}
		if (size < 4 || size > limit - offset) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_SIZE', 'The file-node size is invalid or crosses the fragment trailer.', fragmentOffset + offset);
		}
		if (rawBaseType > 2) {
			throw new OneNoteFormatError('ONENOTE_FILE_NODE_BASE_TYPE', 'The file-node base type is invalid.', fragmentOffset + offset);
		}

		const baseType = BASE_TYPES[rawBaseType];
		const nodeData = data.subarray(offset + 4, offset + size);
		let chunkReference: FileNodeChunkReference | undefined;

		if (baseType !== 'inline') {
			chunkReference = readChunkReference(nodeData, stpFormat, cbFormat, fragmentOffset + offset + 4);
			if (!chunkReference.isNil && (chunkReference.offset !== 0 || chunkReference.length !== 0)) {
				validateBounds(chunkReference.offset, chunkReference.length, declaredFileLength, 'file-node chunk reference');
			}
		}
		else if (cbFormat !== 0) {
			throw new OneNoteFormatError('ONENOTE_INLINE_CB_FORMAT', 'An inline file node has a nonzero byte-count format.', fragmentOffset + offset);
		}

		nodes.push({
			id,
			size,
			stpFormat,
			cbFormat,
			baseType,
			fileOffset: fragmentOffset + offset,
			chunkReference,
			data: nodeData,
		});

		offset += size;
		if (id === FileNodeId.chunkTerminator) break;
	}

	return nodes;
}

/** The width of both fields is chosen by the node header, and small ones count in eights. */
function readChunkReference(data: Uint8Array, stpFormat: number, cbFormat: number, absoluteOffset: number): FileNodeChunkReference {
	const stpBytes = stpFormat === 0 ? 8 : stpFormat === 2 ? 2 : 4;
	const cbBytes = cbFormat === 0 ? 4 : cbFormat === 1 ? 8 : cbFormat === 2 ? 1 : 2;
	const encodedLength = stpBytes + cbBytes;

	const isNil = isAllOnes(data, 0, stpBytes) && readUnsigned(data, stpBytes, cbBytes) === 0;
	if (isNil) return { offset: 0, length: 0, isNil: true, encodedLength };

	const rawOffset = readUnsigned(data, 0, stpBytes);
	const rawLength = readUnsigned(data, stpBytes, cbBytes);

	return {
		offset: stpFormat >= 2 ? multiplyByEight(rawOffset, absoluteOffset) : rawOffset,
		length: cbFormat >= 2 ? multiplyByEight(rawLength, absoluteOffset + stpBytes) : rawLength,
		isNil: false,
		encodedLength,
	};
}

function multiplyByEight(value: number, offset: number): number {
	if (value > Number.MAX_SAFE_INTEGER / 8) {
		throw new OneNoteFormatError('ONENOTE_COMPRESSED_REFERENCE_OVERFLOW', 'A compressed chunk reference overflows its decoded range.', offset);
	}
	return value * 8;
}

function validateBounds(offset: number, length: number, fileLength: number, name: string): void {
	if (offset > fileLength || length > fileLength - offset) {
		throw new OneNoteFormatError('ONENOTE_CHUNK_REFERENCE_BOUNDS', `The ${name} lies outside the declared file length.`, offset);
	}
}
