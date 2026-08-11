/** Iteratively reads the object graph. Ported from OfficeIMO (MIT). */

import { OneNoteFormatError } from '../errors';
import { EMPTY_GUID, readGuid, readUInt16, readUInt32, readUInt64 } from './binary';
import { FileNodeId } from './constants';
import { FileNode, FileNodeChunkReference, FileNodeList } from './file-node-list';
import { ExtendedGuid } from './file-header';
import { PropertySet, readPropertySet } from './property-set';
import { ReaderOptions } from './options';

const FILE_DATA_HEADER = 'bde316e7-2665-4511-a4c4-8d4d0b7a9eac';
const FILE_DATA_FOOTER = '71fba722-0f79-4a0b-bb13-899256426b24';

export interface RootObjectReference {
	objectId: ExtendedGuid;
	role: number;
}

export interface RoleAssociation {
	contextId?: ExtendedGuid;
	role: number;
	order: number;
}

export interface RevisionManifest {
	id: ExtendedGuid;
	dependencyId?: ExtendedGuid;
	role: number;
	isEncrypted: boolean;
	contextId?: ExtendedGuid;
	objectSpaceId?: ExtendedGuid;
	rootObjects: RootObjectReference[];
	roleAssociations: RoleAssociation[];
}

export interface RevisionStoreObject {
	id: ExtendedGuid;
	jcid: number;
	referenceCount: number;
	revisionId?: ExtendedGuid;
	isRevision: boolean;
	propertySet?: PropertySet;
	fileDataReference?: string;
	fileExtension?: string;
}

export interface FileDataStoreObject {
	referenceId: string;
	payload: Uint8Array;
}

export interface ObjectGraph {
	revisions: RevisionManifest[];
	objects: RevisionStoreObject[];
	fileDataObjects: FileDataStoreObject[];
}

export function keyOf(id: ExtendedGuid): string {
	return `${id.identifier}:${id.value}`;
}

function isEmptyGuid(id: ExtendedGuid): boolean {
	return id.identifier === EMPTY_GUID && id.value === 0;
}

function readExtendedGuidAt(data: Uint8Array, offset: number): ExtendedGuid {
	return { identifier: readGuid(data, offset), value: readUInt32(data, offset + 16), encodedLength: 20 };
}

function resolveCompactId(data: Uint8Array, offset: number, globalIds: Map<number, string>, absoluteOffset: number): ExtendedGuid {
	const compact = readUInt32(data, offset);
	const identifier = globalIds.get(compact >>> 8);

	if (identifier === undefined) {
		throw new OneNoteFormatError('ONENOTE_COMPACT_ID', 'A CompactID references a missing global-identification table entry.', absoluteOffset);
	}

	return { identifier, value: compact & 0xff, encodedLength: 4 };
}

function readByte(data: Uint8Array, offset: number): number {
	if (offset < 0 || offset >= data.length) {
		throw new OneNoteFormatError('ONENOTE_TRUNCATED_STRUCTURE', 'The OneNote file ended before a required structure could be read.', offset);
	}
	return data[offset];
}

function readStorageString(data: Uint8Array, position: number, absoluteOffset: number): { value: string, next: number } {
	const characterCount = readUInt32(data, position);
	position += 4;

	if (characterCount > 0x3fffffff || position > data.length - characterCount * 2) {
		throw new OneNoteFormatError('ONENOTE_STORAGE_STRING', 'A StringInStorageBuffer length exceeds its containing structure.', absoluteOffset + position - 4);
	}

	const bytes = data.subarray(position, position + characterCount * 2);
	return { value: new TextDecoder('utf-16le').decode(bytes), next: position + characterCount * 2 };
}

interface ListFrame {
	list: FileNodeList;
	globalIds: Map<number, string>;
	currentRevision?: RevisionManifest;
	currentObjectSpace?: ExtendedGuid;
	nextNodeIndex: number;
}

class GraphReader {
	readonly result: ObjectGraph = { revisions: [], objects: [], fileDataObjects: [] };
	private readonly visited = new Set<FileNodeList>();
	private readonly knownRevisions = new Map<string, RevisionManifest>();
	private readonly knownJcids = new Map<string, number>();
	private nextRoleAssociationOrder = 0;
	private totalAssetBytes = 0;

	constructor(
		private readonly file: Uint8Array,
		private readonly declaredFileLength: number,
		private readonly options: ReaderOptions,
	) {
	}

	processList(list: FileNodeList): void {
		if (this.visited.has(list)) return;
		this.visited.add(list);

		const frames: ListFrame[] = [{ list, globalIds: new Map(), nextNodeIndex: 0 }];

		while (frames.length > 0) {
			const frame = frames[frames.length - 1];
			if (frame.nextNodeIndex >= frame.list.nodes.length) {
				frames.pop();
				continue;
			}

			const node = frame.list.nodes[frame.nextNodeIndex++];
			this.processNode(node, frame);

			if (node.referencedList && !this.visited.has(node.referencedList)) {
				this.visited.add(node.referencedList);
				const inherited = node.id === FileNodeId.objectGroupListReference ? frame.currentRevision : undefined;
				frames.push({
					list: node.referencedList,
					globalIds: new Map(),
					currentRevision: inherited,
					currentObjectSpace: inherited?.objectSpaceId,
					nextNodeIndex: 0,
				});
			}
		}
	}

	private processNode(node: FileNode, frame: ListFrame): void {
		switch (node.id) {
			case FileNodeId.revisionManifestListStart:
				frame.currentObjectSpace = readExtendedGuidAt(node.data, 0);
				break;

			case FileNodeId.revisionManifestStart4:
			case FileNodeId.revisionManifestStart6:
			case FileNodeId.revisionManifestStart7: {
				const revision = this.readRevisionManifest(node);
				revision.objectSpaceId = frame.currentObjectSpace;
				revision.roleAssociations.push({ contextId: revision.contextId, role: revision.role, order: this.nextRoleAssociationOrder++ });

				if (this.knownRevisions.has(keyOf(revision.id))) {
					throw new OneNoteFormatError('ONENOTE_REVISION_ID', 'A revision manifest identifier is duplicated.', node.fileOffset);
				}

				this.knownRevisions.set(keyOf(revision.id), revision);
				this.result.revisions.push(revision);
				frame.currentRevision = revision;
				break;
			}

			case FileNodeId.revisionRoleDeclaration:
				this.readRevisionRoleDeclaration(node, frame.currentObjectSpace, false);
				break;
			case FileNodeId.revisionRoleAndContextDeclaration:
				this.readRevisionRoleDeclaration(node, frame.currentObjectSpace, true);
				break;

			case FileNodeId.globalIdTableStart:
			case FileNodeId.globalIdTableStart2:
				frame.globalIds.clear();
				break;
			case FileNodeId.globalIdTableEntry:
				readGlobalIdEntry(node, frame.globalIds);
				break;

			case FileNodeId.rootObjectReference2:
			case FileNodeId.rootObjectReference3:
				if (frame.currentRevision) readRootReference(node, frame.globalIds, frame.currentRevision);
				break;

			case FileNodeId.objectDeclarationWithRefCount:
			case FileNodeId.objectDeclarationWithRefCount2:
			case FileNodeId.objectDeclaration2RefCount:
			case FileNodeId.objectDeclaration2LargeRefCount:
			case FileNodeId.readOnlyObjectDeclaration2RefCount:
			case FileNodeId.readOnlyObjectDeclaration2LargeRefCount:
			case FileNodeId.objectRevisionWithRefCount:
			case FileNodeId.objectRevisionWithRefCount2:
				this.readObject(node, frame.globalIds, frame.currentRevision);
				break;

			case FileNodeId.objectDeclarationFileData3RefCount:
			case FileNodeId.objectDeclarationFileData3LargeRefCount:
				this.readFileDataDeclaration(node, frame.globalIds, frame.currentRevision);
				break;

			case FileNodeId.fileDataStoreObjectReference:
				this.readFileDataStoreObject(node);
				break;
		}
	}

	private readRevisionManifest(node: FileNode): RevisionManifest {
		const id = readExtendedGuidAt(node.data, 0);
		const dependency = readExtendedGuidAt(node.data, 20);
		const roleOffset = node.id === FileNodeId.revisionManifestStart4 ? 48 : 40;

		const manifest: RevisionManifest = {
			id,
			dependencyId: isEmptyGuid(dependency) ? undefined : dependency,
			role: readUInt32(node.data, roleOffset),
			isEncrypted: readUInt16(node.data, roleOffset + 4) !== 0,
			rootObjects: [],
			roleAssociations: [],
		};

		if (node.id === FileNodeId.revisionManifestStart7) manifest.contextId = readExtendedGuidAt(node.data, 46);
		return manifest;
	}

	private readRevisionRoleDeclaration(node: FileNode, currentObjectSpace: ExtendedGuid | undefined, includesContext: boolean): void {
		const revisionId = readExtendedGuidAt(node.data, 0);
		const role = readUInt32(node.data, 20);

		if (role > 0xffff) {
			throw new OneNoteFormatError('ONENOTE_REVISION_ROLE', 'A revision-role label has nonzero reserved high bytes.', node.fileOffset + 20);
		}

		const revision = this.knownRevisions.get(keyOf(revisionId));
		if (!revision || !currentObjectSpace || !revision.objectSpaceId || keyOf(currentObjectSpace) !== keyOf(revision.objectSpaceId)) {
			throw new OneNoteFormatError(
				'ONENOTE_REVISION_ROLE_TARGET',
				'A revision-role declaration does not reference a preceding revision in the current object space.',
				node.fileOffset);
		}

		let contextId: ExtendedGuid | undefined;
		if (includesContext) {
			const context = readExtendedGuidAt(node.data, 24);
			if (!isEmptyGuid(context)) contextId = context;
		}

		revision.roleAssociations.push({ contextId, role, order: this.nextRoleAssociationOrder++ });
	}

	private readObject(node: FileNode, globalIds: Map<number, string>, revision: RevisionManifest | undefined): void {
		if (this.result.objects.length >= this.options.maxObjects) {
			throw new OneNoteFormatError('ONENOTE_OBJECT_LIMIT', 'The object declaration limit was exceeded.', node.fileOffset);
		}
		if (!node.chunkReference || node.chunkReference.isNil || (node.chunkReference.offset === 0 && node.chunkReference.length === 0)) {
			throw new OneNoteFormatError('ONENOTE_OBJECT_REFERENCE', 'An object declaration does not reference object data.', node.fileOffset);
		}

		const bodyOffset = node.chunkReference.encodedLength;
		const id = resolveCompactId(node.data, bodyOffset, globalIds, node.fileOffset + bodyOffset);
		const isRevision = node.id === FileNodeId.objectRevisionWithRefCount || node.id === FileNodeId.objectRevisionWithRefCount2;

		let jcid: number;
		let referenceCount: number;

		if (node.id === FileNodeId.objectDeclarationWithRefCount || node.id === FileNodeId.objectDeclarationWithRefCount2) {
			jcid = 0x00020001;
			const countOffset = bodyOffset + 10;
			referenceCount = node.id === FileNodeId.objectDeclarationWithRefCount
				? readByte(node.data, countOffset)
				: readUInt32(node.data, countOffset);
		}
		else if (isRevision) {
			jcid = this.knownJcids.get(keyOf(id)) ?? 0;
			const flagsOffset = bodyOffset + 4;
			referenceCount = node.id === FileNodeId.objectRevisionWithRefCount
				? readByte(node.data, flagsOffset) >> 2
				: readUInt32(node.data, flagsOffset + 4);
		}
		else {
			jcid = readUInt32(node.data, bodyOffset + 4);
			const countOffset = bodyOffset + 9;
			const large = node.id === FileNodeId.objectDeclaration2LargeRefCount ||
				node.id === FileNodeId.readOnlyObjectDeclaration2LargeRefCount;
			referenceCount = large ? readUInt32(node.data, countOffset) : readByte(node.data, countOffset);
		}

		const record: RevisionStoreObject = { id, jcid, referenceCount, revisionId: revision?.id, isRevision };

		if (!revision?.isEncrypted) {
			const objectData = this.referencedRange(node.chunkReference, 0, node.chunkReference.length, 'object property set');
			record.propertySet = readPropertySet(objectData, globalIds, this.options, node.chunkReference.offset);
		}

		this.result.objects.push(record);
		if (jcid !== 0) this.knownJcids.set(keyOf(id), jcid);
	}

	private readFileDataDeclaration(node: FileNode, globalIds: Map<number, string>, revision: RevisionManifest | undefined): void {
		if (this.result.objects.length >= this.options.maxObjects) {
			throw new OneNoteFormatError('ONENOTE_OBJECT_LIMIT', 'The object declaration limit was exceeded.', node.fileOffset);
		}

		const id = resolveCompactId(node.data, 0, globalIds, node.fileOffset);
		const jcid = readUInt32(node.data, 4);
		const large = node.id === FileNodeId.objectDeclarationFileData3LargeRefCount;
		const referenceCount = large ? readUInt32(node.data, 8) : readByte(node.data, 8);

		const reference = readStorageString(node.data, large ? 12 : 9, node.fileOffset);
		const extension = readStorageString(node.data, reference.next, node.fileOffset);

		this.result.objects.push({
			id,
			jcid,
			referenceCount,
			revisionId: revision?.id,
			isRevision: false,
			fileDataReference: reference.value,
			fileExtension: extension.value,
		});
		this.knownJcids.set(keyOf(id), jcid);
	}

	private readFileDataStoreObject(node: FileNode): void {
		if (!node.chunkReference || node.chunkReference.isNil || (node.chunkReference.offset === 0 && node.chunkReference.length === 0)) return;

		const referenceId = readGuid(node.data, node.chunkReference.encodedLength);
		if (node.chunkReference.length < 52) {
			throw new OneNoteFormatError('ONENOTE_FILE_DATA_LENGTH', 'A FileDataStoreObject is shorter than its required framing.', node.chunkReference.offset);
		}

		const header = this.referencedRange(node.chunkReference, 0, 36, 'file-data store object header');
		const length = readUInt64(header, 16);

		if (length > node.chunkReference.length - 52) {
			throw new OneNoteFormatError('ONENOTE_FILE_DATA_LENGTH', 'A FileDataStoreObject payload length exceeds its containing frame.', node.chunkReference.offset + 16);
		}
		if (length > this.options.maxAssetBytes || this.totalAssetBytes > this.options.maxTotalAssetBytes - length) {
			throw new OneNoteFormatError('ONENOTE_ASSET_LIMIT', 'An embedded OneNote asset exceeds the configured materialization limits.', node.fileOffset);
		}

		const footer = this.referencedRange(node.chunkReference, node.chunkReference.length - 16, 16, 'file-data store object footer');
		if (readGuid(header, 0) !== FILE_DATA_HEADER || readGuid(footer, 0) !== FILE_DATA_FOOTER) {
			throw new OneNoteFormatError('ONENOTE_FILE_DATA_FRAMING', 'A FileDataStoreObject has invalid framing GUIDs.', node.chunkReference.offset);
		}

		const payload = this.referencedRange(node.chunkReference, 36, length, 'file-data store object payload');
		this.totalAssetBytes += payload.length;
		this.result.fileDataObjects.push({ referenceId, payload });
	}

	private referencedRange(reference: FileNodeChunkReference, relativeOffset: number, length: number, name: string): Uint8Array {
		if (reference.offset > this.declaredFileLength || reference.length > this.declaredFileLength - reference.offset) {
			throw new OneNoteFormatError('ONENOTE_CHUNK_REFERENCE_BOUNDS', `The ${name} lies outside the declared file length.`, reference.offset);
		}
		if (length < 0 || relativeOffset > reference.length || length > reference.length - relativeOffset) {
			throw new OneNoteFormatError('ONENOTE_CHUNK_REFERENCE_BOUNDS', `The ${name} lies outside its containing chunk reference.`, reference.offset);
		}

		const absoluteOffset = reference.offset + relativeOffset;
		if (absoluteOffset + length > this.file.length) {
			throw new OneNoteFormatError('ONENOTE_TRUNCATED_STRUCTURE', `The file ended while reading ${name}.`, absoluteOffset);
		}

		return this.file.subarray(absoluteOffset, absoluteOffset + length);
	}
}

function readGlobalIdEntry(node: FileNode, globalIds: Map<number, string>): void {
	const index = readUInt32(node.data, 0);

	if (index >= 0xffffff || globalIds.has(index)) {
		throw new OneNoteFormatError('ONENOTE_GLOBAL_ID_INDEX', 'A global-identification table index is invalid or duplicated.', node.fileOffset);
	}

	const identifier = readGuid(node.data, 4);
	if (identifier === EMPTY_GUID) {
		throw new OneNoteFormatError('ONENOTE_GLOBAL_ID_GUID', 'A global-identification table contains an empty GUID.', node.fileOffset + 4);
	}

	globalIds.set(index, identifier);
}

function readRootReference(node: FileNode, globalIds: Map<number, string>, revision: RevisionManifest): void {
	const isExtended = node.id === FileNodeId.rootObjectReference3;
	const objectId = isExtended
		? readExtendedGuidAt(node.data, 0)
		: resolveCompactId(node.data, 0, globalIds, node.fileOffset);

	revision.rootObjects.push({ objectId, role: readUInt32(node.data, isExtended ? 20 : 4) });
}

export function readObjectGraph(
	file: Uint8Array,
	root: FileNodeList,
	declaredFileLength: number,
	options: ReaderOptions,
): ObjectGraph {
	const reader = new GraphReader(file, declaredFileLength, options);
	reader.processList(root);
	return reader.result;
}
