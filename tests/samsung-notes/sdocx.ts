import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

/** Every file in an .sdocx, by its path in the archive. */
export async function readFiles(path: string): Promise<Map<string, ArrayBuffer>> {
	const zip = new ZipReader(new BlobReader(new Blob([nodeFs.readFileSync(path)])));
	const files = new Map<string, ArrayBuffer>();
	for (const entry of await zip.getEntries()) {
		if (entry.directory || !entry.getData) continue;
		const bytes = await entry.getData(new Uint8ArrayWriter());
		files.set(entry.filename, bytes.slice().buffer);
	}
	await zip.close();
	return files;
}

/** note.note with the first bytes of its body object overwritten, so the body can't be read. */
export async function noteWithBrokenBody(): Promise<ArrayBuffer> {
	const note = (await readFiles(nodePath.join(__dirname, '01-basic-formatting.sdocx'))).get('note.note')!;
	const view = new DataView(note);
	let at = 14 + 4;
	at += 2 + view.getUint16(at, true) * 2;
	at += 4 + 8 + 8 + 20;
	at += 4 + view.getUint32(at, true);
	view.setUint32(at + 4, 0, true);
	return note;
}

interface Span { type: number, start: number, end: number, value: number }
interface Paragraph { type: number, start: number, end: number, first: number, second?: number }

class Writer {
	private readonly bytes: number[] = [];
	u8(value: number): this { this.bytes.push(value & 0xFF); return this; }
	u16(value: number): this { return this.u8(value).u8(value >>> 8); }
	u32(value: number): this { return this.u16(value & 0xFFFF).u16(value >>> 16); }
	utf16(text: string): this { for (let i = 0; i < text.length; i++) this.u16(text.charCodeAt(i)); return this; }
	raw(bytes: Uint8Array): this { this.bytes.push(...bytes); return this; }
	get length(): number { return this.bytes.length; }
	done(): Uint8Array { return new Uint8Array(this.bytes); }
}

const FORMAT_VERSION = 2035;

/** A serialized text object: base, shape-base and shape records, then a TextCommon block holding `text`. */
function textObject(text: string, spans: Span[] = [], paragraphs: Paragraph[] = []): Uint8Array {
	const common = new Writer().u32(text.length).utf16(text).u32(spans.length);
	for (const span of spans) common.u16(17).u32(span.type).u32(span.start).u32(span.end).u32(0).u8(span.value);
	common.u32(paragraphs.length);
	for (const p of paragraphs) common.u16(20).u32(p.type).u32(p.start).u32(p.end).u32(p.first).u32(p.second ?? 0);
	common.raw(new Uint8Array(17)).u16(0).u32(0).u32(0);

	const block = common.done();
	const shape = new Writer().u32(17 + 4 + block.length).u16(7).u32(17).u8(1).u8(0).u8(4).u32(1);
	return new Writer().u32(6).u16(0).u32(6).u16(6).raw(shape.done()).u32(block.length).raw(block).done();
}

/** A note.note whose body is `text` with the given spans and paragraph formats. */
export function buildNote(text: string, spans: Span[] = [], paragraphs: Paragraph[] = []): ArrayBuffer {
	const title = textObject('Built');
	const body = textObject(text, spans, paragraphs);
	const note = new Writer().raw(new Uint8Array(14)).u32(FORMAT_VERSION).u16(0).u32(0)
		.u32(0).u32(0).u32(0).u32(0).raw(new Uint8Array(20))
		.u32(title.length).raw(title).u32(body.length).raw(body);
	return note.done().slice().buffer;
}
