/**
 * Reads the typed content and pen strokes of a Samsung Notes .sdocx archive.
 *
 * Offsets follow the MIT-licensed format notes in Dietrich
 * (github.com/Downhillghost/Dietrich, sdocx_specification/) and bxff
 * (github.com/bxff/samsung-notes-format), and were checked against the
 * CC BY 4.0 SDOCX compatibility corpus. Shapes, lines, text boxes, and PDF
 * backgrounds on a page aren't decoded; pages that hold them are only counted.
 */

export const OBJECT_CHARACTER = '\uFFFC';

export const SpanType = {
	Bold: 5,
	Italic: 6,
	Underline: 7,
	Link: 9,
	Highlight: 17,
	Strikethrough: 20,
} as const;

export const ParagraphType = {
	Indent: 2,
	Bullet: 5,
	Style: 10,
} as const;

const ObjectType = {
	Image: 3,
	Table: 22,
	CodeBlock: 23,
} as const;

const RecordType = {
	Base: 0,
	ShapeBase: 6,
	Shape: 7,
} as const;

const FORMAT_WITH_OBJECT_SPANS = 2035;
const SHAPE_HAS_TEXT = 0x1;
const SHAPE_HAS_FILL = 0x20;
const FILL_IMAGE = 2;
const PAGE_HAS_PDF = 0x100;
const LAYER_HIDDEN = 0x1;
const PageObjectType = {
	Stroke: 1,
	GroupedStroke: 15,
} as const;
const STROKE_RECORD = 1;
const STROKE_COMPACT = 0x1;
const STROKE_HAS_ANGLES = 0x4;
const StrokeStyle = {
	AdvancedSetting: 0x2,
	Color: 0x4,
	Size: 0x8,
} as const;
const DEFAULT_STROKE_COLOR = 0xFF000000;
const DEFAULT_STROKE_SIZE = 2;

export interface SamsungSpan {
	type: number;
	start: number;
	end: number;
	/** The first byte for on/off spans, or the ARGB colour for highlights. */
	value: number;
	url?: string;
}

/** A paragraph format applied to paragraphs `start` up to, but not including, `end`. */
export interface SamsungParagraphFormat {
	type: number;
	start: number;
	end: number;
	first: number;
	second: number;
}

export type SamsungObject =
	| { kind: 'table', offset: number, rows: SamsungText[][] }
	| { kind: 'code', offset: number, language: string, code: string }
	| { kind: 'image', offset: number, bindId: number }
	| { kind: 'other', offset: number, type: number };

export interface SamsungText {
	text: string;
	spans: SamsungSpan[];
	paragraphs: SamsungParagraphFormat[];
	objects: SamsungObject[];
}

export interface SamsungNote {
	title: string;
	body: SamsungText | null;
	/** Milliseconds since 1970. */
	ctime?: number;
	mtime?: number;
	/** Media bind ID to the file name under media/. */
	media: Map<number, string>;
	/** The pen strokes on each page that has any, in page order. */
	drawings: SamsungStroke[][];
	/** Pages with shapes, lines, text boxes, or PDF backgrounds, which aren't imported. */
	unsupportedPages: number;
}

export interface SamsungStroke {
	/** Page coordinates. */
	points: { x: number, y: number }[];
	/** ARGB. */
	color: number;
	size: number;
}

export interface SamsungArchive {
	note: ArrayBuffer;
	mediaInfo?: ArrayBuffer;
	/** pageIdInfo.dat, which orders the pages. */
	pageOrder?: ArrayBuffer;
	/** Each .page file by its name without the extension. */
	pages: Map<string, ArrayBuffer>;
}

const UTF16 = new TextDecoder('utf-16le');

class Reader {
	private readonly view: DataView;
	readonly length: number;

	constructor(readonly bytes: Uint8Array, public pos = 0) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.length = bytes.byteLength;
	}

	private need(count: number): void {
		if (count < 0 || this.pos + count > this.length) {
			throw new RangeError(`Samsung Notes data ends early at ${this.pos} (wanted ${count} bytes of ${this.length})`);
		}
	}

	u8(): number {
		this.need(1);
		return this.view.getUint8(this.pos++);
	}

	u16(): number {
		this.need(2);
		const value = this.view.getUint16(this.pos, true);
		this.pos += 2;
		return value;
	}

	u32(): number {
		this.need(4);
		const value = this.view.getUint32(this.pos, true);
		this.pos += 4;
		return value;
	}

	i32(): number {
		this.need(4);
		const value = this.view.getInt32(this.pos, true);
		this.pos += 4;
		return value;
	}

	f32(): number {
		this.need(4);
		const value = this.view.getFloat32(this.pos, true);
		this.pos += 4;
		return value;
	}

	f64(): number {
		this.need(8);
		const value = this.view.getFloat64(this.pos, true);
		this.pos += 8;
		return value;
	}

	/** A little-endian unsigned integer of up to four bytes. */
	uint(bytes: number): number {
		let value = 0;
		for (let i = 0; i < bytes; i++) value += this.u8() * 2 ** (8 * i);
		return value;
	}

	u64(): number {
		const low = this.u32();
		return this.u32() * 0x100000000 + low;
	}

	utf16(units: number): string {
		this.need(units * 2);
		const text = UTF16.decode(this.bytes.subarray(this.pos, this.pos + units * 2));
		this.pos += units * 2;
		return text;
	}

	shortString(): string {
		const units = this.u16();
		return units === 0xFFFF ? '' : this.utf16(units);
	}

	slice(count: number): Reader {
		this.need(count);
		const sub = new Reader(this.bytes.subarray(this.pos, this.pos + count));
		this.pos += count;
		return sub;
	}

	u16At(at: number): number {
		return at + 2 <= this.length ? this.view.getUint16(at, true) : -1;
	}

	u32At(at: number): number {
		return at + 4 <= this.length ? this.view.getUint32(at, true) : -1;
	}
}

/** Microseconds since 1970, as stored, to the milliseconds the vault uses. */
function toMilliseconds(microseconds: number): number | undefined {
	return microseconds > 0 ? Math.floor(microseconds / 1000) : undefined;
}

export function parseSamsungNote(archive: SamsungArchive): SamsungNote {
	const reader = new Reader(new Uint8Array(archive.note));
	reader.pos = 14;
	const formatVersion = reader.u32();
	reader.shortString();
	reader.u32();
	const created = reader.u64();
	const modified = reader.u64();
	reader.pos += 20;

	const titleObject = reader.slice(reader.u32());
	const bodyObject = reader.slice(reader.u32());

	const drawings: SamsungStroke[][] = [];
	let unsupportedPages = 0;
	for (const data of orderedPages(archive)) {
		const page = parsePage(data);
		if (page.strokes.length > 0) drawings.push(page.strokes);
		if (page.unsupported) unsupportedPages++;
	}

	return {
		title: textObjectAt(titleObject, 0, formatVersion)?.text.text.trim() ?? '',
		body: textObjectAt(bodyObject, 0, formatVersion)?.text ?? null,
		ctime: toMilliseconds(created),
		mtime: toMilliseconds(modified),
		media: archive.mediaInfo ? parseMediaInfo(archive.mediaInfo) : new Map<number, string>(),
		drawings,
		unsupportedPages,
	};
}

/**
 * A serialized text object: a base record, a shape-base record, and a shape
 * record whose own data begins with a sized TextCommon block.
 */
function textObjectAt(reader: Reader, at: number, formatVersion: number): { text: SamsungText, end: number } | null {
	const shape = shapeRecordAt(reader, at);
	if (!shape || (shape.mask & SHAPE_HAS_TEXT) === 0) return null;

	const sizeAt = shape.at + shape.ownOffset;
	const size = reader.u32At(sizeAt);
	if (size < 0 || sizeAt + 4 + size > reader.length) return null;

	const block = new Reader(reader.bytes.subarray(sizeAt + 4, sizeAt + 4 + size));
	try {
		const text = parseTextCommon(block, formatVersion);
		if (block.pos !== block.length) return null;
		return { text, end: sizeAt + 4 + size };
	}
	catch (error) {
		if (error instanceof RangeError) return null;
		throw error;
	}
}

function shapeRecordAt(reader: Reader, at: number): { at: number, ownOffset: number, mask: number } | null {
	const baseSize = reader.u32At(at);
	if (baseSize < 6 || reader.u16At(at + 4) !== RecordType.Base) return null;

	const shapeBaseAt = at + baseSize;
	const shapeBaseSize = reader.u32At(shapeBaseAt);
	if (shapeBaseSize < 6 || reader.u16At(shapeBaseAt + 4) !== RecordType.ShapeBase) return null;

	const shapeAt = shapeBaseAt + shapeBaseSize;
	if (reader.u16At(shapeAt + 4) !== RecordType.Shape) return null;

	const ownOffset = reader.u32At(shapeAt + 6);
	const mask = reader.u32At(shapeAt + 13);
	if (ownOffset < 0 || mask < 0) return null;
	return { at: shapeAt, ownOffset, mask };
}

function parseTextCommon(reader: Reader, formatVersion: number): SamsungText {
	const text = reader.utf16(reader.u32());

	const spans: SamsungSpan[] = [];
	const spanCount = reader.u32();
	for (let i = 0; i < spanCount; i++) {
		const record = reader.slice(reader.u16());
		const type = record.u32();
		const start = record.u32();
		const end = record.u32();
		record.u32();
		spans.push(parseSpanValue(record, type, start, end));
	}

	const paragraphs: SamsungParagraphFormat[] = [];
	const paragraphCount = reader.u32();
	for (let i = 0; i < paragraphCount; i++) {
		const record = reader.slice(reader.u16());
		const type = record.u32();
		const start = record.u32();
		const end = record.u32();
		const first = record.length - record.pos >= 4 ? record.u32() : 0;
		const second = record.length - record.pos >= 4 ? record.u32() : 0;
		paragraphs.push({ type, start, end, first, second });
	}

	reader.pos += 16 + 1;
	const sections = reader.u16();
	reader.pos += sections * 8;

	const objects: SamsungObject[] = [];
	if (formatVersion >= FORMAT_WITH_OBJECT_SPANS) {
		const flags = reader.u32();
		reader.u32();
		if (flags & 1) {
			const count = reader.u32();
			for (let i = 0; i < count; i++) {
				const record = reader.slice(reader.u32());
				const size = record.u32();
				const type = record.u32();
				const blob = record.slice(size);
				const offset = record.u32();
				objects.push(parseObject(blob, type, offset, formatVersion));
			}
		}
	}

	return { text, spans, paragraphs, objects };
}

function parseSpanValue(record: Reader, type: number, start: number, end: number): SamsungSpan {
	const span: SamsungSpan = { type, start, end, value: 0 };
	if (type === SpanType.Highlight) {
		span.value = record.i32();
	}
	else if (type === SpanType.Link) {
		record.u32();
		record.u32();
		const units = record.length - record.pos >= 4 ? record.u32() : 0;
		if (units > 0 && units !== 0xFFFFFFFF) span.url = record.utf16(units);
	}
	else if (record.pos < record.length) {
		span.value = record.u8();
	}
	return span;
}

function parseObject(blob: Reader, type: number, offset: number, formatVersion: number): SamsungObject {
	if (type === ObjectType.Image) {
		const bindId = imageBindId(blob);
		if (bindId !== null) return { kind: 'image', offset, bindId };
	}
	else if (type === ObjectType.Table) {
		const columns = tableColumnCount(blob);
		const cells = nestedTextObjects(blob, formatVersion);
		if (columns > 0 && cells.length > 0 && cells.length % columns === 0) {
			const rows: SamsungText[][] = [];
			for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));
			return { kind: 'table', offset, rows };
		}
	}
	else if (type === ObjectType.CodeBlock) {
		const [label, code] = nestedTextObjects(blob, formatVersion);
		if (label && code) return { kind: 'code', offset, language: label.text.trim(), code: code.text };
	}
	return { kind: 'other', offset, type };
}

/** The image's media bind ID, stored in its shape's fill effect. */
function imageBindId(blob: Reader): number | null {
	const shape = shapeRecordAt(blob, 0);
	if (!shape || (shape.mask & (SHAPE_HAS_FILL | (SHAPE_HAS_FILL - 1))) !== SHAPE_HAS_FILL) return null;

	const fillAt = shape.at + shape.ownOffset;
	if (blob.bytes[fillAt + 4] !== FILL_IMAGE) return null;
	const bindId = blob.u32At(fillAt + 6);
	return bindId < 0 ? null : bindId;
}

/** The column count leads the own data of the table record that follows the shape record. */
function tableColumnCount(blob: Reader): number {
	const shape = shapeRecordAt(blob, 0);
	if (!shape) return 0;

	const tableAt = shape.at + blob.u32At(shape.at);
	if (blob.u16At(tableAt + 4) !== ObjectType.Table) return 0;
	return blob.u32At(tableAt + blob.u32At(tableAt + 6));
}

/** Text objects nested in a table or code block, in the order they're stored. */
function nestedTextObjects(blob: Reader, formatVersion: number): SamsungText[] {
	const found: SamsungText[] = [];
	const container = shapeRecordAt(blob, 0);
	let at = container ? container.at + blob.u32At(container.at) : 0;
	while (at < blob.length - 6) {
		const child = textObjectAt(blob, at, formatVersion);
		if (child) {
			found.push(child.text);
			at = child.end;
		}
		else {
			at++;
		}
	}
	return found;
}

function parseMediaInfo(data: ArrayBuffer): Map<number, string> {
	const media = new Map<number, string>();
	const reader = new Reader(new Uint8Array(data));
	try {
		reader.u32();
		const count = reader.u16();
		for (let i = 0; i < count; i++) {
			const entry = reader.slice(reader.u32());
			const bindId = entry.u32();
			media.set(bindId, entry.shortString());
		}
	}
	catch (error) {
		if (!(error instanceof RangeError)) throw error;
	}
	return media;
}

/** Pages in the order pageIdInfo.dat lists them, then any it leaves out, by name. */
function orderedPages(archive: SamsungArchive): ArrayBuffer[] {
	const order: string[] = [];
	if (archive.pageOrder) {
		const reader = new Reader(new Uint8Array(archive.pageOrder), 32);
		try {
			const count = reader.u16();
			for (let i = 0; i < count; i++) {
				order.push(reader.shortString());
				reader.pos += 32;
			}
		}
		catch (error) {
			if (!(error instanceof RangeError)) throw error;
		}
	}

	const names = [...new Set([...order, ...[...archive.pages.keys()].sort()])];
	return names.flatMap(name => archive.pages.get(name) ?? []);
}

/**
 * A page's visible pen strokes, stacked by layer number. Anything else on the
 * page, or a stroke that can't be read, makes the page unsupported.
 */
function parsePage(data: ArrayBuffer): { strokes: SamsungStroke[], unsupported: boolean } {
	const reader = new Reader(new Uint8Array(data));
	if (reader.length < 18) return { strokes: [], unsupported: false };

	let unsupported = (reader.u32At(14) & PAGE_HAS_PDF) !== 0;
	const layers: { number: number, strokes: SamsungStroke[] }[] = [];

	const readObject = (layer: SamsungStroke[] | null): void => {
		const type = reader.u8();
		const children = reader.u16();
		const payload = reader.slice(reader.u32() - 32);
		reader.pos += 32;

		if (type === PageObjectType.Stroke || type === PageObjectType.GroupedStroke) {
			const stroke = parseStrokeObject(payload);
			if (!stroke) unsupported = true;
			else if (layer) layer.push(stroke);
		}
		else {
			unsupported = true;
		}

		for (let i = 0; i < children; i++) readObject(layer);
	};

	try {
		reader.pos = reader.u32At(0);
		const layerCount = reader.u16();
		reader.u16();
		for (let i = 0; i < layerCount; i++) {
			const start = reader.pos;
			const headerSize = reader.u32();
			const hidden = (reader.bytes[start + 9] & LAYER_HIDDEN) !== 0;
			const number = reader.u32At(start + 12);
			reader.pos = start + headerSize;

			const strokes: SamsungStroke[] = [];
			const objectCount = reader.u32();
			for (let j = 0; j < objectCount; j++) readObject(hidden ? null : strokes);
			reader.pos += 32;
			layers.push({ number, strokes });
		}
	}
	catch (error) {
		if (!(error instanceof RangeError)) throw error;
		unsupported = true;
	}

	layers.sort((a, b) => a.number - b.number);
	return { strokes: layers.flatMap(layer => layer.strokes), unsupported };
}

/** A stroke object holds a chain of records; the stroke's own record has its points and style. */
function parseStrokeObject(payload: Reader): SamsungStroke | null {
	let at = 0;
	while (at + 6 <= payload.length) {
		const size = payload.u32At(at);
		if (size < 6 || at + size > payload.length) return null;
		if (payload.u16At(at + 4) === STROKE_RECORD) {
			try {
				return parseStroke(new Reader(payload.bytes.subarray(at, at + size)));
			}
			catch (error) {
				if (error instanceof RangeError) return null;
				throw error;
			}
		}
		at += size;
	}
	return null;
}

function parseStroke(reader: Reader): SamsungStroke | null {
	reader.pos = 6;
	const styleAt = reader.u32();
	const geometry = reader.uint(reader.u8());
	const style = reader.uint(reader.u8());
	const count = reader.u16();
	if (count === 0 || styleAt > reader.length) return null;

	const points = geometry & STROKE_COMPACT
		? compactPoints(reader, count)
		: rawPoints(reader, count, styleAt - reader.pos, (geometry & STROKE_HAS_ANGLES) !== 0);
	if (!points || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;

	reader.pos = styleAt;
	if (style & StrokeStyle.AdvancedSetting) reader.u32();
	const color = style & StrokeStyle.Color ? reader.u32() : DEFAULT_STROKE_COLOR;
	const size = style & StrokeStyle.Size ? reader.f32() : DEFAULT_STROKE_SIZE;
	return { points, color, size };
}

/** A start point, then one step per point: a sign bit and a magnitude in 1/32 units. */
function compactPoints(reader: Reader, count: number): { x: number, y: number }[] {
	let x = reader.f64();
	let y = reader.f64();
	const points = [{ x, y }];
	for (let i = 1; i < count; i++) {
		x += unpackStep(reader.u16());
		y += unpackStep(reader.u16());
		points.push({ x, y });
	}
	return points;
}

function unpackStep(word: number): number {
	const magnitude = (word & 0x7FFF) / 32;
	return word & 0x8000 ? -magnitude : magnitude;
}

/**
 * Full coordinates, as 32- or 64-bit floats. Only the size of the stroke's
 * point data tells them apart: per point it also holds a pressure and a time,
 * two angles when flagged, and a 2-byte tail follows.
 */
function rawPoints(reader: Reader, count: number, available: number, angles: boolean): { x: number, y: number }[] | null {
	const rest = count * (8 + (angles ? 8 : 0)) + 2;
	const coordinate = available === count * 8 + rest ? 4 : available === count * 16 + rest ? 8 : 0;
	if (coordinate === 0) return null;

	const points: { x: number, y: number }[] = [];
	for (let i = 0; i < count; i++) {
		points.push(coordinate === 4
			? { x: reader.f32(), y: reader.f32() }
			: { x: reader.f64(), y: reader.f64() });
	}
	return points;
}

/** Every image bind ID a text uses, including those inside table cells. */
export function imageBindIds(source: SamsungText | null): number[] {
	if (!source) return [];

	const ids: number[] = [];
	for (const object of source.objects) {
		if (object.kind === 'image') ids.push(object.bindId);
		else if (object.kind === 'table') ids.push(...object.rows.flat().flatMap(imageBindIds));
	}
	return [...new Set(ids)];
}

/** A media file's name without the bind-ID prefix Samsung Notes adds, as in `0@photo.jpg`. */
export function mediaDisplayName(filename: string): string {
	return filename.replace(/^\d+@/, '') || filename;
}
