import { readUInt32 } from '../onestore/binary';
import { ExtendedGuid } from '../onestore/file-header';
import { PropertySet, PropertyValue } from '../onestore/property-set';
import { RevisionStoreObject } from '../onestore/objects';

export function findProperty(set: PropertySet | undefined, propertyId: number): PropertyValue | undefined {
	if (!set) return undefined;

	const normalized = propertyId & 0x7fffffff;
	for (let index = set.properties.length - 1; index >= 0; index--) {
		if ((set.properties[index].rawId & 0x7fffffff) === normalized) return set.properties[index];
	}

	return undefined;
}

export function readData(item: RevisionStoreObject | undefined, propertyId: number): Uint8Array | undefined {
	return findProperty(item?.propertySet, propertyId)?.data;
}

export function readReferences(item: RevisionStoreObject | undefined, propertyId: number): ExtendedGuid[] {
	return findProperty(item?.propertySet, propertyId)?.referencedIds ?? [];
}

export function readString(item: RevisionStoreObject | undefined, propertyId: number): string | undefined {
	const data = readData(item, propertyId);
	if (!data || data.length === 0) return undefined;

	const even = data.length - (data.length % 2);
	return trimTrailingNulls(new TextDecoder('utf-16le').decode(data.subarray(0, even)));
}

export function readSingleByteString(item: RevisionStoreObject | undefined, propertyId: number): string | undefined {
	const data = readData(item, propertyId);
	if (!data || data.length === 0) return undefined;

	let value = '';
	for (const byte of data) value += String.fromCharCode(byte);
	return trimTrailingNulls(value);
}

export function readBoolean(item: RevisionStoreObject | undefined, propertyId: number): boolean | undefined {
	return findProperty(item?.propertySet, propertyId)?.booleanValue;
}

export function readUInt32Property(item: RevisionStoreObject | undefined, propertyId: number): number | undefined {
	const value = findProperty(item?.propertySet, propertyId)?.scalarValue;
	return value === undefined ? undefined : value >>> 0;
}

export function readFloat(item: RevisionStoreObject | undefined, propertyId: number): number | undefined {
	const data = readData(item, propertyId);
	if (!data || data.length !== 4) return undefined;
	return new DataView(data.buffer, data.byteOffset, 4).getFloat32(0, true);
}

export function readUInt32Array(item: RevisionStoreObject | undefined, propertyId: number): number[] {
	const data = readData(item, propertyId);
	if (!data || data.length % 4 !== 0) return [];

	const values: number[] = [];
	for (let index = 0; index < data.length; index += 4) values.push(readUInt32(data, index));
	return values;
}

/** A Windows FILETIME, which counts 100ns ticks from 1601. */
export function readFileTime(item: RevisionStoreObject | undefined, propertyId: number): Date | undefined {
	const value = findProperty(item?.propertySet, propertyId)?.scalarValue;
	if (value === undefined || value === 0) return undefined;

	const milliseconds = value / 10000 - 11644473600000;
	return Number.isFinite(milliseconds) ? new Date(milliseconds) : undefined;
}

/** Seconds from 1980-01-01. */
export function readTime32(item: RevisionStoreObject | undefined, propertyId: number): Date | undefined {
	const value = readUInt32Property(item, propertyId);
	return value === undefined ? undefined : new Date(Date.UTC(1980, 0, 1) + value * 1000);
}

function trimTrailingNulls(value: string): string {
	let end = value.length;
	while (end > 0 && value.charCodeAt(end - 1) === 0) end--;
	return value.slice(0, end);
}
