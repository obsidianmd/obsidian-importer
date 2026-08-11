/** Reads revision-store views without copying. Ported from OfficeIMO (MIT). */

import { OneNoteFormatError } from '../errors';
import { FileChunkReference } from './binary';
import { FileKind, FileNodeId } from './constants';
import { FileHeader, readFileHeader } from './file-header';
import { FileNodeList, readFileNodeList } from './file-node-list';
import { ObjectGraph, readObjectGraph } from './objects';
import { DEFAULT_READER_OPTIONS, ReaderOptions } from './options';
import { readTransactionLog } from './transaction-log';

export interface RevisionStore {
	header: FileHeader;
	root: FileNodeList;
	lists: FileNodeList[];
	graph: ObjectGraph;
}

export function readRevisionStore(file: Uint8Array, options: ReaderOptions = DEFAULT_READER_OPTIONS): RevisionStore {
	const header = readFileHeader(file, file.length, options);

	if (header.storageFormat !== 'revision-store') {
		throw new OneNoteFormatError('ONENOTE_NOT_REVISION_STORE', 'The OneNote artifact does not use the desktop MS-ONESTORE encoding.');
	}
	if (header.expectedFileLength === undefined || !header.rootFileNodeList) {
		throw new OneNoteFormatError('ONENOTE_REVISION_STORE_HEADER', 'The revision-store header does not expose its required root structures.');
	}

	const committedNodeCounts = readTransactionLog(file, header, options);
	const root = readFileNodeList(file, header.rootFileNodeList, header.expectedFileLength, committedNodeCounts, options);

	validateRootList(root, header.fileKind);

	const lists = linkReachableLists(file, root, header.rootFileNodeList.offset, header.expectedFileLength, committedNodeCounts, options);
	const graph = readObjectGraph(file, root, header.expectedFileLength, options);

	return { header, root, lists, graph };
}

function linkReachableLists(
	file: Uint8Array,
	root: FileNodeList,
	rootOffset: number,
	declaredFileLength: number,
	committedNodeCounts: Map<number, number>,
	options: ReaderOptions,
): FileNodeList[] {
	const lists = [root];
	const byOffset = new Map<number, FileNodeList>([[rootOffset, root]]);
	const queue: FileNodeList[] = [root];
	let totalNodes = root.nodes.length;

	while (queue.length > 0) {
		const parent = queue.shift()!;

		for (const node of parent.nodes) {
			if (node.baseType !== 'file-node-list-reference' ||
				!node.chunkReference ||
				node.chunkReference.isNil ||
				(node.chunkReference.offset === 0 && node.chunkReference.length === 0)) {
				continue;
			}

			const childOffset = node.chunkReference.offset;
			const existing = byOffset.get(childOffset);
			if (existing) {
				node.referencedList = existing;
				continue;
			}

			const firstFragment: FileChunkReference = { offset: childOffset, length: node.chunkReference.length, isNil: false };
			const child = readFileNodeList(file, firstFragment, declaredFileLength, committedNodeCounts, options);

			if (totalNodes > options.maxFileNodes - child.nodes.length) {
				throw new OneNoteFormatError('ONENOTE_FILE_NODE_LIMIT', 'The file-node limit was exceeded while traversing referenced lists.', node.fileOffset);
			}
			totalNodes += child.nodes.length;

			node.referencedList = child;
			byOffset.set(childOffset, child);
			lists.push(child);
			queue.push(child);
		}
	}

	return lists;
}

function validateRootList(root: FileNodeList, fileKind: FileKind): void {
	let manifestReferences = 0;
	let rootDeclarations = 0;

	for (const node of root.nodes) {
		if (node.id === FileNodeId.objectSpaceManifestListReference) manifestReferences++;
		if (node.id === FileNodeId.objectSpaceManifestRoot) rootDeclarations++;
	}

	if (manifestReferences < 1 || rootDeclarations !== 1) {
		throw new OneNoteFormatError(
			'ONENOTE_ROOT_FILE_NODE_LIST',
			'The root file-node list does not contain the required object-space references and single root declaration.');
	}

	for (const node of root.nodes) {
		const allowed = node.id === FileNodeId.objectSpaceManifestListReference ||
			node.id === FileNodeId.objectSpaceManifestRoot ||
			node.id === FileNodeId.chunkTerminator ||
			(fileKind === 'section' && node.id === FileNodeId.fileDataStoreListReference);

		if (!allowed) {
			throw new OneNoteFormatError('ONENOTE_ROOT_FILE_NODE_TYPE', 'The root file-node list contains a file-node type that is not valid at the root.', node.fileOffset);
		}
	}
}
