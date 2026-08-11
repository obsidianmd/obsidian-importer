/**
 * LZX decompression for the Cabinet folders a .onepkg is made of.
 *
 * The block, tree, match and E8-translation structures are the ones published
 * in MS-PATCH and MS-CAB. Ported from OfficeIMO's OneNoteLzxDecoder (MIT);
 * tests/onenote-file/cabinet.test.ts checks it against archives produced by
 * Windows makecab rather than against a recording of this code.
 */

import { OneNoteFormatError } from '../errors';

const LITERAL_SYMBOLS = 256;
const PRIMARY_LENGTH_SYMBOLS = 8;
const LENGTH_TREE_SYMBOLS = 249;
const ALIGNED_TREE_SYMBOLS = 8;
const PRETREE_SYMBOLS = 20;
const MAXIMUM_PATH_LENGTH = 16;
const VERBATIM_BLOCK = 1;
const ALIGNED_OFFSET_BLOCK = 2;
const UNCOMPRESSED_BLOCK = 3;
const MAXIMUM_TRANSLATED_FRAMES = 32768;

function corrupt(message: string): OneNoteFormatError {
	return new OneNoteFormatError('ONENOTE_CAB_LZX_CORRUPT', message);
}

/** Reads LZX fields from little-endian 16-bit words, with a byte-aligned mode for uncompressed blocks. */
class BitReader {
	private nextWordOffset = 0;
	private word = 0;
	private bitsRemaining = 0;

	constructor(private readonly data: Uint8Array) {
	}

	get remainingByteCount(): number {
		this.ensureByteAligned();
		return this.data.length - this.nextWordOffset;
	}

	readBits(count: number): number {
		let value = 0;
		let remaining = count;

		while (remaining > 0) {
			if (this.bitsRemaining === 0) this.loadWord();
			const take = Math.min(remaining, this.bitsRemaining);
			const shift = this.bitsRemaining - take;
			const mask = (1 << take) - 1;
			value = ((value << take) | ((this.word >> shift) & mask)) >>> 0;
			this.bitsRemaining -= take;
			remaining -= take;
		}

		return value;
	}

	alignToWord(): void {
		this.bitsRemaining = 0;
	}

	readRawByte(): number {
		this.ensureByteAligned();
		this.ensureRawBytes(1);
		return this.data[this.nextWordOffset++];
	}

	readRawUInt32(): number {
		this.ensureByteAligned();
		this.ensureRawBytes(4);
		const value = (this.data[this.nextWordOffset] |
			(this.data[this.nextWordOffset + 1] << 8) |
			(this.data[this.nextWordOffset + 2] << 16) |
			(this.data[this.nextWordOffset + 3] << 24)) >>> 0;
		this.nextWordOffset += 4;
		return value;
	}

	copyRawBytes(destination: Uint8Array, destinationOffset: number, count: number): void {
		this.ensureByteAligned();
		this.ensureRawBytes(count);
		destination.set(this.data.subarray(this.nextWordOffset, this.nextWordOffset + count), destinationOffset);
		this.nextWordOffset += count;
	}

	private loadWord(): void {
		if (this.nextWordOffset > this.data.length - 2) {
			throw new OneNoteFormatError('ONENOTE_CAB_LZX_TRUNCATED', 'The CAB LZX bitstream ended inside a 16-bit word.');
		}
		this.word = this.data[this.nextWordOffset] | (this.data[this.nextWordOffset + 1] << 8);
		this.nextWordOffset += 2;
		this.bitsRemaining = 16;
	}

	private ensureByteAligned(): void {
		if (this.bitsRemaining !== 0) {
			throw corrupt('The CAB LZX stream entered byte mode without word alignment.');
		}
	}

	private ensureRawBytes(count: number): void {
		if (count < 0 || this.nextWordOffset > this.data.length - count) {
			throw new OneNoteFormatError('ONENOTE_CAB_LZX_TRUNCATED', 'The CAB LZX byte stream ended unexpectedly.');
		}
	}
}

/** Canonical Huffman decoder rebuilt from the path lengths carried in the stream. */
class HuffmanTree {
	private constructor(
		private readonly counts: Int32Array,
		private readonly firstCodes: Int32Array,
		private readonly firstSymbolIndexes: Int32Array,
		private readonly symbols: Int32Array,
	) {
	}

	static readonly empty = new HuffmanTree(
		new Int32Array(MAXIMUM_PATH_LENGTH + 1),
		new Int32Array(MAXIMUM_PATH_LENGTH + 1),
		new Int32Array(MAXIMUM_PATH_LENGTH + 1),
		new Int32Array(0),
	);

	static create(pathLengths: Uint8Array, allowEmpty: boolean, treeName: string): HuffmanTree {
		const counts = new Int32Array(MAXIMUM_PATH_LENGTH + 1);

		for (const length of pathLengths) {
			if (length > MAXIMUM_PATH_LENGTH) throw corrupt(`${treeName} tree contains an invalid path length.`);
			if (length !== 0) counts[length]++;
		}

		let symbolCount = 0;
		for (const count of counts) symbolCount += count;
		if (symbolCount === 0) {
			if (allowEmpty) return HuffmanTree.empty;
			throw corrupt(`${treeName} tree is empty.`);
		}
		if (symbolCount === 1) throw corrupt(`${treeName} tree contains only one symbol.`);

		const firstCodes = new Int32Array(MAXIMUM_PATH_LENGTH + 1);
		const firstSymbolIndexes = new Int32Array(MAXIMUM_PATH_LENGTH + 1);
		let code = 0;
		let symbolIndex = 0;

		for (let length = 1; length <= MAXIMUM_PATH_LENGTH; length++) {
			code = (code + counts[length - 1]) << 1;
			firstCodes[length] = code;
			firstSymbolIndexes[length] = symbolIndex;
			if (code + counts[length] > 1 << length) throw corrupt(`${treeName} tree is oversubscribed.`);
			symbolIndex += counts[length];
		}

		const symbols = new Int32Array(symbolCount);
		const nextIndexes = firstSymbolIndexes.slice();
		for (let symbol = 0; symbol < pathLengths.length; symbol++) {
			const length = pathLengths[symbol];
			if (length !== 0) symbols[nextIndexes[length]++] = symbol;
		}

		return new HuffmanTree(counts, firstCodes, firstSymbolIndexes, symbols);
	}

	decode(reader: BitReader): number {
		if (this.symbols.length === 0) throw corrupt('The LZX stream uses an empty Huffman tree.');

		let code = 0;
		for (let length = 1; length <= MAXIMUM_PATH_LENGTH; length++) {
			code = (code << 1) | reader.readBits(1);
			const offset = code - this.firstCodes[length];
			if (offset >= 0 && offset < this.counts[length]) {
				return this.symbols[this.firstSymbolIndexes[length] + offset];
			}
		}

		throw corrupt('The LZX stream contains a Huffman code that is absent from its tree.');
	}
}

class LzxDecoder {
	private readonly windowSize: number;
	private readonly positionBase: Int32Array;
	private readonly positionFooterBits: Int32Array;
	private readonly mainPathLengths: Uint8Array;
	private readonly lengthPathLengths = new Uint8Array(LENGTH_TREE_SYMBOLS);
	private readonly decoded: Uint8Array;
	private mainTree = HuffmanTree.empty;
	private lengthTree = HuffmanTree.empty;
	private alignedTree = HuffmanTree.empty;
	private recentOffset0 = 1;
	private recentOffset1 = 1;
	private recentOffset2 = 1;
	private outputOffset = 0;
	private blockType = 0;
	private blockBytesRemaining = 0;
	private streamHeaderRead = false;
	private translationFileSize = 0;
	private uncompressedBlockNeedsPadding = false;
	private uncompressedPaddingPending = false;

	constructor(outputLength: number, windowBits: number) {
		if (windowBits < 15 || windowBits > 21) {
			throw new OneNoteFormatError('ONENOTE_CAB_LZX_WINDOW', 'The CAB uses an unsupported LZX window size.');
		}

		this.windowSize = 1 << windowBits;

		const bases: number[] = [];
		const bits: number[] = [];
		for (let slot = 0, nextBase = 0; nextBase < this.windowSize; slot++) {
			const footerBits = slot < 4 ? 0 : slot < 36 ? (slot >> 1) - 1 : 17;
			bases.push(nextBase);
			bits.push(footerBits);
			nextBase += 1 << footerBits;
		}
		this.positionBase = Int32Array.from(bases);
		this.positionFooterBits = Int32Array.from(bits);

		this.mainPathLengths = new Uint8Array(LITERAL_SYMBOLS + PRIMARY_LENGTH_SYMBOLS * this.positionBase.length);
		this.decoded = new Uint8Array(outputLength);
	}

	decode(chunks: Uint8Array[], sizes: number[], requiredBytes: number): Uint8Array {
		const frameStarts = new Int32Array(sizes.length);
		let frames = 0;

		while (frames < chunks.length && this.outputOffset < requiredBytes) {
			frameStarts[frames] = this.outputOffset;
			this.decodeFrame(chunks[frames], sizes[frames]);
			frames++;
		}

		const complete = frames === chunks.length;
		if (complete && (this.outputOffset !== this.decoded.length || this.blockBytesRemaining !== 0)) {
			throw corrupt('The LZX stream does not describe the expected expanded size.');
		}

		if (this.translationFileSize > 0) {
			for (let frame = 0; frame < frames && frame < MAXIMUM_TRANSLATED_FRAMES; frame++) {
				reverseE8Translation(this.decoded, frameStarts[frame], sizes[frame], this.translationFileSize);
			}
		}

		return this.decoded;
	}

	private decodeFrame(chunk: Uint8Array, expandedSize: number): void {
		const frameEnd = this.outputOffset + expandedSize;
		const reader = new BitReader(chunk);

		if (this.uncompressedPaddingPending) {
			if (reader.remainingByteCount < 1) {
				throw new OneNoteFormatError('ONENOTE_CAB_LZX_TRUNCATED', 'The LZX uncompressed-block padding byte is missing.');
			}
			reader.readRawByte();
			this.uncompressedPaddingPending = false;
		}

		while (this.outputOffset < frameEnd) {
			if (this.blockBytesRemaining === 0) this.readBlockHeader(reader);

			if (this.blockType === UNCOMPRESSED_BLOCK) this.decodeUncompressedSlice(reader, frameEnd);
			else this.decodeCompressedSlice(reader, frameEnd);

			if (this.blockBytesRemaining === 0 && this.blockType === UNCOMPRESSED_BLOCK) {
				this.consumeUncompressedPadding(reader);
			}
		}

		if (this.outputOffset !== frameEnd) {
			throw corrupt('An LZX token crosses a 32-KB CFDATA output boundary.');
		}
	}

	private readBlockHeader(reader: BitReader): void {
		if (!this.streamHeaderRead) {
			this.streamHeaderRead = true;
			if (reader.readBits(1) !== 0) {
				const high = reader.readBits(16);
				const low = reader.readBits(16);
				this.translationFileSize = ((high << 16) | low) >>> 0;
				if (this.translationFileSize > 0x7fffffff) {
					throw corrupt('The LZX E8 translation size is outside the supported range.');
				}
			}
		}

		this.blockType = reader.readBits(3);
		this.blockBytesRemaining = (reader.readBits(16) << 8) | reader.readBits(8);

		if (this.blockBytesRemaining === 0 ||
			(this.blockType !== VERBATIM_BLOCK && this.blockType !== ALIGNED_OFFSET_BLOCK && this.blockType !== UNCOMPRESSED_BLOCK)) {
			throw corrupt('The LZX block header contains an invalid type or size.');
		}

		if (this.blockType === UNCOMPRESSED_BLOCK) {
			this.uncompressedBlockNeedsPadding = (this.blockBytesRemaining & 1) !== 0;
			reader.alignToWord();
			this.recentOffset0 = reader.readRawUInt32();
			this.recentOffset1 = reader.readRawUInt32();
			this.recentOffset2 = reader.readRawUInt32();
			this.validateRepeatedOffset(this.recentOffset0);
			this.validateRepeatedOffset(this.recentOffset1);
			this.validateRepeatedOffset(this.recentOffset2);
			return;
		}

		if (this.blockType === ALIGNED_OFFSET_BLOCK) {
			const alignedLengths = new Uint8Array(ALIGNED_TREE_SYMBOLS);
			for (let index = 0; index < alignedLengths.length; index++) alignedLengths[index] = reader.readBits(3);
			this.alignedTree = HuffmanTree.create(alignedLengths, false, 'aligned-offset');
		}

		readPathLengths(reader, this.mainPathLengths, 0, LITERAL_SYMBOLS);
		readPathLengths(reader, this.mainPathLengths, LITERAL_SYMBOLS, this.mainPathLengths.length);
		this.mainTree = HuffmanTree.create(this.mainPathLengths, false, 'main');

		readPathLengths(reader, this.lengthPathLengths, 0, this.lengthPathLengths.length);
		this.lengthTree = HuffmanTree.create(this.lengthPathLengths, true, 'length');
	}

	private decodeUncompressedSlice(reader: BitReader, frameEnd: number): void {
		const copyLength = Math.min(this.blockBytesRemaining, frameEnd - this.outputOffset);
		reader.copyRawBytes(this.decoded, this.outputOffset, copyLength);
		this.outputOffset += copyLength;
		this.blockBytesRemaining -= copyLength;
	}

	private decodeCompressedSlice(reader: BitReader, frameEnd: number): void {
		while (this.blockBytesRemaining > 0 && this.outputOffset < frameEnd) {
			const symbol = this.mainTree.decode(reader);
			if (symbol < LITERAL_SYMBOLS) {
				this.decoded[this.outputOffset++] = symbol;
				this.blockBytesRemaining--;
				continue;
			}

			const matchHeader = symbol - LITERAL_SYMBOLS;
			const positionSlot = matchHeader >> 3;
			const lengthHeader = matchHeader & 7;
			if (positionSlot >= this.positionBase.length) {
				throw corrupt('The LZX match references an invalid position slot.');
			}

			let matchLength = lengthHeader + 2;
			if (lengthHeader === 7) matchLength += this.lengthTree.decode(reader);
			const matchOffset = this.decodeMatchOffset(reader, positionSlot);

			if (matchLength > this.blockBytesRemaining || matchLength > frameEnd - this.outputOffset) {
				throw corrupt('An LZX match crosses a block or CFDATA output boundary.');
			}
			if (matchOffset === 0 || matchOffset > this.windowSize || matchOffset > this.outputOffset) {
				throw corrupt('An LZX match references bytes outside the available window.');
			}

			const source = this.outputOffset - matchOffset;
			for (let index = 0; index < matchLength; index++) {
				this.decoded[this.outputOffset++] = this.decoded[source + index];
			}
			this.blockBytesRemaining -= matchLength;
		}
	}

	private decodeMatchOffset(reader: BitReader, positionSlot: number): number {
		if (positionSlot === 0) return this.recentOffset0;
		if (positionSlot === 1) {
			const offset = this.recentOffset1;
			this.recentOffset1 = this.recentOffset0;
			this.recentOffset0 = offset;
			return offset;
		}
		if (positionSlot === 2) {
			const offset = this.recentOffset2;
			this.recentOffset2 = this.recentOffset0;
			this.recentOffset0 = offset;
			return offset;
		}

		const footerBits = this.positionFooterBits[positionSlot];
		let footer: number;
		if (this.blockType === ALIGNED_OFFSET_BLOCK && footerBits >= 3) {
			const high = footerBits === 3 ? 0 : reader.readBits(footerBits - 3) << 3;
			footer = high | this.alignedTree.decode(reader);
		}
		else {
			footer = reader.readBits(footerBits);
		}

		const formattedOffset = this.positionBase[positionSlot] + footer;
		if (formattedOffset < 3) throw corrupt('The LZX match contains an invalid formatted offset.');

		const matchOffset = formattedOffset - 2;
		this.validateRepeatedOffset(matchOffset);
		this.recentOffset2 = this.recentOffset1;
		this.recentOffset1 = this.recentOffset0;
		this.recentOffset0 = matchOffset;
		return matchOffset;
	}

	private consumeUncompressedPadding(reader: BitReader): void {
		if (!this.uncompressedBlockNeedsPadding) return;
		this.uncompressedBlockNeedsPadding = false;
		if (reader.remainingByteCount > 0) reader.readRawByte();
		else this.uncompressedPaddingPending = true;
	}

	private validateRepeatedOffset(offset: number): void {
		if (offset === 0 || offset > this.windowSize) {
			throw corrupt('The LZX repeated-offset state is outside the configured window.');
		}
	}
}

function readPathLengths(reader: BitReader, lengths: Uint8Array, start: number, end: number): void {
	const pretreeLengths = new Uint8Array(PRETREE_SYMBOLS);
	for (let index = 0; index < pretreeLengths.length; index++) pretreeLengths[index] = reader.readBits(4);
	const pretree = HuffmanTree.create(pretreeLengths, false, 'pretree');

	let cursor = start;
	while (cursor < end) {
		const code = pretree.decode(reader);
		if (code <= MAXIMUM_PATH_LENGTH) {
			lengths[cursor] = (lengths[cursor] - code + 17) % 17;
			cursor++;
			continue;
		}

		let repeat: number;
		let value: number;
		if (code === 17) {
			repeat = reader.readBits(4) + 4;
			value = 0;
		}
		else if (code === 18) {
			repeat = reader.readBits(5) + 20;
			value = 0;
		}
		else if (code === 19) {
			repeat = reader.readBits(1) + 4;
			const delta = pretree.decode(reader);
			if (delta > MAXIMUM_PATH_LENGTH) throw corrupt('The LZX path-length repeat contains an invalid delta.');
			value = (lengths[cursor] - delta + 17) % 17;
		}
		else {
			throw corrupt('The LZX pretree contains an invalid symbol.');
		}

		if (repeat > end - cursor) throw corrupt('The LZX path-length repeat exceeds its target tree.');
		for (let index = 0; index < repeat; index++) lengths[cursor++] = value;
	}
}

/**
 * Undo the x86 call-target rewriting LZX applies before compressing.
 *
 * The encoder turns each 0xE8 relative call into an absolute offset because
 * that compresses better; every frame it touched has to be put back.
 */
function reverseE8Translation(data: Uint8Array, frameOffset: number, frameLength: number, fileSize: number): void {
	if (frameOffset >= 0x40000000 || frameLength <= 10) return;

	const scanEnd = frameOffset + frameLength - 10;
	for (let cursor = frameOffset; cursor < scanEnd; cursor++) {
		if (data[cursor] !== 0xe8) continue;

		const value = data[cursor + 1] | (data[cursor + 2] << 8) | (data[cursor + 3] << 16) | (data[cursor + 4] << 24);
		if (value >= -cursor && value < fileSize) {
			const displacement = value >= 0 ? value - cursor : value + fileSize;
			data[cursor + 1] = displacement;
			data[cursor + 2] = displacement >> 8;
			data[cursor + 3] = displacement >> 16;
			data[cursor + 4] = displacement >> 24;
		}
		cursor += 4;
	}
}

/**
 * `requiredBytes` stops the decode once that much output exists. LZX is one
 * stream across a whole Cabinet folder, so a later entry still costs every
 * frame before it — but an earlier one need not pay for the rest of a package.
 * The returned buffer is full length; bytes past the stop are zero.
 */
export function lzxDecompress(
	chunks: Uint8Array[],
	sizes: number[],
	windowBits: number,
	maxOutputBytes: number,
	requiredBytes?: number,
): Uint8Array {
	if (chunks.length !== sizes.length) {
		throw new OneNoteFormatError('ONENOTE_CAB_LZX_BLOCKS', 'CAB LZX block metadata is inconsistent.');
	}

	let outputLength = 0;
	for (let index = 0; index < sizes.length; index++) {
		if (sizes[index] < 0 || outputLength > maxOutputBytes - sizes[index]) {
			throw new OneNoteFormatError('ONENOTE_CAB_EXPANDED_LIMIT', 'The expanded CAB folder exceeds the configured size limit.');
		}
		outputLength += sizes[index];
	}

	return new LzxDecoder(outputLength, windowBits).decode(chunks, sizes, requiredBytes ?? outputLength);
}
