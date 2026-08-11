import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeChunks, decodeText } from '../../src/encoding';

// "中英文对照" encoded as GBK.
const GBK_TITLE = Uint8Array.from([0xd6, 0xd0, 0xd3, 0xa2, 0xce, 0xc4, 0xb6, 0xd4, 0xd5, 0xd5]);
const TITLE = '中英文对照';

function bytes(...parts: (string | Uint8Array)[]): Uint8Array {
	const encoder = new TextEncoder();
	const chunks = parts.map(part => typeof part === 'string' ? encoder.encode(part) : part);
	const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));

	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}

	return out;
}

test('a page is read in the charset its own head declares', () => {
	const page = bytes('<html><head><meta charset="gbk"><title>', GBK_TITLE, '</title></head><body><img src="', GBK_TITLE, '.files/img1.jpg"></body></html>');

	const html = decodeText(page);
	assert.ok(html.includes(`<title>${TITLE}</title>`), html);
	assert.ok(html.includes(`src="${TITLE}.files/img1.jpg"`), 'the path an attachment is looked up by');
});

test('the older http-equiv form says it just as well', () => {
	const page = bytes('<html><head><meta http-equiv="Content-Type" content="text/html; charset=GB2312"><title>', GBK_TITLE, '</title></head></html>');

	assert.ok(decodeText(page).includes(TITLE));
});

test('an ENEX is read in the encoding of its XML declaration', () => {
	const enex = bytes('<?xml version="1.0" encoding="GBK"?>\n<en-export><note><title>', GBK_TITLE, '</title></note></en-export>');

	assert.ok(decodeText(enex).includes(TITLE));
});

test('a byte order mark outranks anything the markup claims', () => {
	const page = bytes(Uint8Array.from([0xef, 0xbb, 0xbf]), '<meta charset="gbk"><p>café</p>');

	const html = decodeText(page);
	assert.equal(html, '<meta charset="gbk"><p>café</p>', 'the mark itself should not survive into the text');
});

test('utf-16 is read from its mark, which is the only place it says so', () => {
	const page = bytes(Uint8Array.from([0xff, 0xfe]), new Uint8Array(
		[...'<p>中文</p>'].flatMap(character => {
			const code = character.charCodeAt(0);
			return [code & 0xff, code >> 8];
		})
	));

	assert.equal(decodeText(page), '<p>中文</p>');
});

test('a file that declares nothing is still read as UTF-8', () => {
	assert.equal(decodeText(bytes('<p>中文 café</p>')), '<p>中文 café</p>');
});

test('a charset no decoder knows is read as UTF-8 rather than failing the import', () => {
	assert.equal(decodeText(bytes('<meta charset="x-mac-inuit"><p>café</p>')), '<meta charset="x-mac-inuit"><p>café</p>');
});

test('a declaration further in than a file can be sniffed is not looked for', () => {
	const page = bytes('<html><head>', '<!--'.padEnd(1200, ' ') + '-->', '<meta charset="gbk">');

	assert.equal(decodeText(page).endsWith('<meta charset="gbk">'), true);
});

test('a stream settles its encoding on the first chunk and keeps it', async () => {
	async function* chunks(): AsyncIterable<Uint8Array> {
		yield bytes('<?xml version="1.0" encoding="gbk"?><en-export><title>');
		yield GBK_TITLE;
		yield bytes('</title></en-export>');
	}

	let text = '';
	for await (const piece of decodeChunks(chunks())) text += piece;

	assert.ok(text.includes(`<title>${TITLE}</title>`), text);
});

test('a character split across two chunks is not split in the text', async () => {
	const utf8 = new TextEncoder().encode('中文');

	async function* chunks(): AsyncIterable<Uint8Array> {
		yield utf8.subarray(0, 2);
		yield utf8.subarray(2);
	}

	let text = '';
	for await (const piece of decodeChunks(chunks())) text += piece;

	assert.equal(text, '中文');
});
