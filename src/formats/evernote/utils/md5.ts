/**
 * MD5, because an ENEX references its attachments by one.
 *
 * `<en-media hash="...">` is the MD5 of the resource's bytes, and matching the
 * two is the only way to tell which attachment a note is pointing at. Nothing
 * here is a security claim - the digest is Evernote's index, not a signature -
 * and the alternative was node:crypto, which is not there off the desktop.
 *
 * RFC 1321. Checked against node:crypto over the fixtures and over random
 * lengths around every padding boundary; see md5.test.ts.
 */

/** Per-round left-rotation amounts. */
const SHIFTS = [
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
	5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
	4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
	6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** floor(abs(sin(i + 1)) * 2^32), the constant of round i. */
const SINES = new Int32Array(64);
for (let i = 0; i < 64; i++) {
	SINES[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;
}

export function md5(bytes: Uint8Array): string {
	const length = bytes.length;

	// The message, a 1 bit, zeroes, and the bit length in the last eight bytes,
	// rounded up to whole 64-byte blocks.
	const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
	padded.set(bytes);
	padded[length] = 0x80;

	const block = new DataView(padded.buffer);
	block.setUint32(padded.length - 8, (length << 3) >>> 0, true);
	block.setUint32(padded.length - 4, Math.floor(length / 0x20000000), true);

	let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
	const words = new Int32Array(16);

	for (let at = 0; at < padded.length; at += 64) {
		for (let i = 0; i < 16; i++) words[i] = block.getInt32(at + i * 4, true);

		let a = a0, b = b0, c = c0, d = d0;

		for (let i = 0; i < 64; i++) {
			let mixed: number;
			let word: number;

			if (i < 16) {
				mixed = (b & c) | (~b & d);
				word = i;
			}
			else if (i < 32) {
				mixed = (d & b) | (~d & c);
				word = (5 * i + 1) % 16;
			}
			else if (i < 48) {
				mixed = b ^ c ^ d;
				word = (3 * i + 5) % 16;
			}
			else {
				mixed = c ^ (b | ~d);
				word = (7 * i) % 16;
			}

			const sum = (mixed + a + SINES[i] + words[word]) | 0;
			const shift = SHIFTS[i];

			a = d;
			d = c;
			c = b;
			b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
		}

		a0 = (a0 + a) | 0;
		b0 = (b0 + b) | 0;
		c0 = (c0 + c) | 0;
		d0 = (d0 + d) | 0;
	}

	return littleEndianHex(a0) + littleEndianHex(b0) + littleEndianHex(c0) + littleEndianHex(d0);
}

function littleEndianHex(word: number): string {
	let out = '';
	for (let byte = 0; byte < 4; byte++) {
		out += ((word >>> (byte * 8)) & 0xff).toString(16).padStart(2, '0');
	}

	return out;
}
