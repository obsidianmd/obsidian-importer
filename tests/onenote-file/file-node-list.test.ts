/** A list that continues into another fragment lost its last node, which is how
 * a multi-page section lost the last image its file-data store held. See #657. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	FILE_NODE_LIST_FOOTER_MAGIC,
	FILE_NODE_LIST_HEADER_MAGIC,
	FileNodeId,
} from '../../src/formats/onenote-file/onestore/constants';
import { readFileNodeList } from '../../src/formats/onenote-file/onestore/file-node-list';
import { DEFAULT_READER_OPTIONS } from '../../src/formats/onenote-file/onestore/options';

const LIST_ID = 23;
const FRAGMENT_HEADER_LENGTH = 16;
const FRAGMENT_TRAILER_LENGTH = 20;
const CONTENT_NODE_SIZE = 8;
const TERMINATOR_SIZE = 4;

/** An inline node carrying nothing but the index the assertions know it by. */
function contentNode(index: number): Uint8Array {
	const node = new Uint8Array(CONTENT_NODE_SIZE);
	const view = new DataView(node.buffer);

	view.setUint32(0, 0x80000000 | (CONTENT_NODE_SIZE << 10) | FileNodeId.globalIdTableEntry, true);
	view.setUint32(4, index, true);
	return node;
}

function terminatorNode(): Uint8Array {
	const node = new Uint8Array(TERMINATOR_SIZE);

	new DataView(node.buffer).setUint32(0, 0x80000000 | (TERMINATOR_SIZE << 10) | FileNodeId.chunkTerminator, true);
	return node;
}

function fragmentLength(nodes: Uint8Array[]): number {
	return FRAGMENT_HEADER_LENGTH + nodes.reduce((total, node) => total + node.length, 0) + FRAGMENT_TRAILER_LENGTH;
}

function fragment(sequence: number, nodes: Uint8Array[], next?: { offset: number, length: number }): Uint8Array {
	const data = new Uint8Array(fragmentLength(nodes));
	const view = new DataView(data.buffer);

	data.set(FILE_NODE_LIST_HEADER_MAGIC, 0);
	view.setUint32(8, LIST_ID, true);
	view.setUint32(12, sequence, true);

	let offset = FRAGMENT_HEADER_LENGTH;
	for (const node of nodes) {
		data.set(node, offset);
		offset += node.length;
	}

	if (next) {
		view.setBigUint64(offset, BigInt(next.offset), true);
		view.setUint32(offset + 8, next.length, true);
	}
	else {
		data.fill(0xff, offset, offset + 8);
	}

	data.set(FILE_NODE_LIST_FOOTER_MAGIC, data.length - 8);
	return data;
}

/** Lays two fragments of one list end to end and reads the list they form. */
function readList(first: Uint8Array[], second: Uint8Array[], committedNodeCount: number) {
	const tail = fragment(1, second);
	const head = fragment(0, first, { offset: fragmentLength(first), length: tail.length });

	const file = new Uint8Array(head.length + tail.length);
	file.set(head, 0);
	file.set(tail, head.length);

	return readFileNodeList(
		file,
		{ offset: 0, length: head.length, isNil: false },
		file.length,
		new Map([[LIST_ID, committedNodeCount]]),
		DEFAULT_READER_OPTIONS);
}

function indicesOf(nodes: { id: number, data: Uint8Array }[]): number[] {
	return nodes
		.filter(node => node.id !== FileNodeId.chunkTerminator)
		.map(node => new DataView(node.data.buffer, node.data.byteOffset).getUint32(0, true));
}

test('a chunk terminator does not spend one of the list\'s committed nodes', () => {
	const list = readList([contentNode(0), contentNode(1), terminatorNode()], [contentNode(2), contentNode(3)], 4);

	assert.deepEqual(indicesOf(list.nodes), [0, 1, 2, 3], 'the node after the terminated fragment was dropped');
});

test('a list that ends before its committed count is still refused', () => {
	assert.throws(
		() => readList([contentNode(0), terminatorNode()], [contentNode(1)], 3),
		/committed transaction-log count/);
});
