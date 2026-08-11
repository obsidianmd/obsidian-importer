/** Reads ordered property-reference streams. Ported from OfficeIMO (MIT). */

import { OneNoteFormatError } from '../errors';
import { readUInt16, readUInt32 } from './binary';
import { ExtendedGuid } from './file-header';
import { ReaderOptions } from './options';

export interface PropertyValue {
	rawId: number;
	index: number;
	booleanValue?: boolean;
	scalarValue?: number;
	data?: Uint8Array;
	referencedIds?: ExtendedGuid[];
	childPropertyId?: number;
	childPropertySets?: PropertySet[];
}

export interface PropertySet {
	properties: PropertyValue[];
	encodedLength: number;
}

interface ReferenceStream {
	ids: ExtendedGuid[];
	extendedStreamsPresent: boolean;
	osidStreamNotPresent: boolean;
}

const EMPTY_STREAM: ReferenceStream = { ids: [], extendedStreamsPresent: false, osidStreamNotPresent: true };

class Cursor {
	private position = 0;
	private totalProperties = 0;

	constructor(
		private readonly data: Uint8Array,
		private readonly globalIds: Map<number, string>,
		private readonly options: ReaderOptions,
		private readonly absoluteOffset: number,
	) {
	}

	error(code: string, message: string): OneNoteFormatError {
		return new OneNoteFormatError(code, message, this.absoluteOffset + this.position);
	}

	readReferenceStream(): ReferenceStream {
		const header = this.readUInt32();
		const count = header & 0x00ffffff;

		if ((header & 0x3f000000) !== 0 || count > this.options.maxObjects) {
			throw this.error('ONENOTE_OBJECT_STREAM_HEADER', 'An object-reference stream header is invalid or exceeds the object limit.');
		}

		const ids: ExtendedGuid[] = [];
		for (let index = 0; index < count; index++) ids.push(this.readCompactId());

		return {
			ids,
			extendedStreamsPresent: (header & 0x40000000) !== 0,
			osidStreamNotPresent: (header & 0x80000000) !== 0,
		};
	}

	readPropertySet(counters: ReferenceCounters, depth: number): PropertySet {
		if (depth >= this.options.maxPropertySetDepth) {
			throw this.error('ONENOTE_PROPERTY_DEPTH', 'The nested property-set depth limit was exceeded.');
		}

		const start = this.position;
		const count = this.readUInt16();
		if (count > this.options.maxPropertiesPerObject || this.totalProperties > this.options.maxPropertiesPerObject - count) {
			throw this.error('ONENOTE_PROPERTY_LIMIT', 'The property count exceeds the configured per-object limit.');
		}
		this.totalProperties += count;

		const rawIds = new Array<number>(count);
		for (let index = 0; index < count; index++) rawIds[index] = this.readUInt32();

		const properties: PropertyValue[] = [];
		for (let index = 0; index < count; index++) {
			const rawId = rawIds[index];
			const property: PropertyValue = { rawId, index };
			const type = (rawId >>> 26) & 0x1f;

			switch (type) {
				case 0x01:
					break;
				case 0x02:
					property.booleanValue = (rawId & 0x80000000) !== 0;
					break;
				case 0x03:
					this.setScalar(property, 1);
					break;
				case 0x04:
					this.setScalar(property, 2);
					break;
				case 0x05:
					this.setScalar(property, 4);
					break;
				case 0x06:
					this.setScalar(property, 8);
					break;
				case 0x07: {
					const length = this.readUInt32();
					if (length >= 0x40000000) {
						throw this.error('ONENOTE_PROPERTY_DATA_LENGTH', 'A length-prefixed property value is too large.');
					}
					property.data = this.readBytes(length);
					break;
				}
				case 0x08:
					property.referencedIds = counters.takeOids(1, this);
					break;
				case 0x09:
					property.referencedIds = counters.takeOids(this.readReferenceCount(), this);
					break;
				case 0x0a:
					property.referencedIds = counters.takeOsids(1, this);
					break;
				case 0x0b:
					property.referencedIds = counters.takeOsids(this.readReferenceCount(), this);
					break;
				case 0x0c:
					property.referencedIds = counters.takeContexts(1, this);
					break;
				case 0x0d:
					property.referencedIds = counters.takeContexts(this.readReferenceCount(), this);
					break;
				case 0x10: {
					const childCount = this.readReferenceCount();
					if (childCount === 0) {
						property.childPropertySets = [];
						break;
					}

					const childPropertyId = this.readUInt32();
					if (((childPropertyId >>> 26) & 0x1f) !== 0x11) {
						throw this.error('ONENOTE_PROPERTY_ARRAY_TYPE', 'A property-set array does not declare PropertySet element values.');
					}

					property.childPropertyId = childPropertyId;
					property.childPropertySets = [];
					for (let child = 0; child < childCount; child++) {
						property.childPropertySets.push(this.readPropertySet(counters, depth + 1));
					}
					break;
				}
				case 0x11:
					property.childPropertySets = [this.readPropertySet(counters, depth + 1)];
					break;
				default:
					throw this.error(
						'ONENOTE_PROPERTY_TYPE',
						`The property set contains an unsupported representation type 0x${type.toString(16).padStart(2, '0')}.`);
			}

			properties.push(property);
		}

		return { properties, encodedLength: this.position - start };
	}

	private setScalar(property: PropertyValue, byteCount: number): void {
		const bytes = this.readBytes(byteCount);

		let value = 0;
		let exact = true;
		for (let index = bytes.length - 1; index >= 0; index--) {
			if (value > Number.MAX_SAFE_INTEGER / 256) exact = false;
			value = value * 256 + bytes[index];
		}

		if (exact) property.scalarValue = value;
		property.data = bytes;
	}

	private readReferenceCount(): number {
		const count = this.readUInt32();
		if (count > this.options.maxObjects) {
			throw this.error('ONENOTE_REFERENCE_COUNT', 'A property reference count exceeds the configured object limit.');
		}
		return count;
	}

	private readCompactId(): ExtendedGuid {
		const compact = this.readUInt32();
		const value = compact & 0xff;
		const index = compact >>> 8;
		const identifier = this.globalIds.get(index);

		if (identifier === undefined) {
			throw this.error('ONENOTE_COMPACT_ID', 'A property reference uses a missing global-identification table entry.');
		}

		return { identifier, value, encodedLength: 4 };
	}

	private readUInt16(): number {
		this.ensure(2);
		const value = readUInt16(this.data, this.position);
		this.position += 2;
		return value;
	}

	private readUInt32(): number {
		this.ensure(4);
		const value = readUInt32(this.data, this.position);
		this.position += 4;
		return value;
	}

	private readBytes(length: number): Uint8Array {
		this.ensure(length);
		const value = this.data.subarray(this.position, this.position + length);
		this.position += length;
		return value;
	}

	private ensure(length: number): void {
		if (length < 0 || this.position > this.data.length - length) {
			throw this.error('ONENOTE_TRUNCATED_PROPERTY_SET', 'The object data ended inside a property set.');
		}
	}
}

class ReferenceCounters {
	private oidIndex = 0;
	private osidIndex = 0;
	private contextIndex = 0;

	constructor(
		private readonly oids: ExtendedGuid[],
		private readonly osids: ExtendedGuid[],
		private readonly contexts: ExtendedGuid[],
	) {
	}

	takeOids(count: number, cursor: Cursor): ExtendedGuid[] {
		const taken = this.take(this.oids, this.oidIndex, count, cursor, 'object');
		this.oidIndex += count;
		return taken;
	}

	takeOsids(count: number, cursor: Cursor): ExtendedGuid[] {
		const taken = this.take(this.osids, this.osidIndex, count, cursor, 'object-space');
		this.osidIndex += count;
		return taken;
	}

	takeContexts(count: number, cursor: Cursor): ExtendedGuid[] {
		const taken = this.take(this.contexts, this.contextIndex, count, cursor, 'context');
		this.contextIndex += count;
		return taken;
	}

	private take(source: ExtendedGuid[], index: number, count: number, cursor: Cursor, kind: string): ExtendedGuid[] {
		if (count < 0 || index > source.length - count) {
			throw cursor.error('ONENOTE_REFERENCE_STREAM', `A property consumes more ${kind} identifiers than its object stream contains.`);
		}
		return source.slice(index, index + count);
	}
}

export function readPropertySet(
	data: Uint8Array,
	globalIds: Map<number, string>,
	options: ReaderOptions,
	absoluteOffset: number,
): PropertySet {
	const cursor = new Cursor(data, globalIds, options, absoluteOffset);
	const oids = cursor.readReferenceStream();
	let osids = EMPTY_STREAM;
	let contexts = EMPTY_STREAM;

	if (!oids.osidStreamNotPresent) {
		osids = cursor.readReferenceStream();
		if (osids.extendedStreamsPresent) contexts = cursor.readReferenceStream();
	}

	return cursor.readPropertySet(new ReferenceCounters(oids.ids, osids.ids, contexts.ids), 0);
}
