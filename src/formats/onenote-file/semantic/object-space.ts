/**
 * Object spaces, and which revision of one is current.
 *
 * A revision store keeps every revision it has ever committed. A page is the
 * result of replaying its revision chain oldest-first, so a later revision's
 * declaration of an object wins over an earlier one — that replay is what
 * turns a pile of declarations into one page. Ported from OfficeIMO's
 * OneNoteObjectSpaceMaterializer (MIT).
 */

import { ExtendedGuid } from '../onestore/file-header';
import { FileDataStoreObject, RevisionManifest, RevisionStoreObject, keyOf } from '../onestore/objects';
import { RevisionStore } from '../onestore/revision-store';
import { HEADER_CELL_OBJECT_SPACE_ID } from './schema';

export interface MaterializedObjectSpace {
	revision: RevisionManifest;
	getObject(id: ExtendedGuid): RevisionStoreObject | undefined;
	getRoot(role: number): RevisionStoreObject | undefined;
}

export function spaceKey(id: ExtendedGuid, contextId?: ExtendedGuid): string {
	return `${keyOf(id)}|${contextId ? keyOf(contextId) : 'default'}`;
}

export class ObjectSpaceMaterializer {
	private readonly revisions = new Map<string, RevisionManifest>();
	private readonly spaces = new Map<string, RevisionManifest[]>();
	private readonly objectsByRevision = new Map<string, RevisionStoreObject[]>();
	private readonly fileData = new Map<string, FileDataStoreObject>();
	private readonly cache = new Map<string, MaterializedObjectSpace | undefined>();

	constructor(store: RevisionStore) {
		for (const revision of store.graph.revisions) {
			this.revisions.set(keyOf(revision.id), revision);

			if (revision.objectSpaceId) {
				const key = keyOf(revision.objectSpaceId);
				const existing = this.spaces.get(key);
				if (existing) existing.push(revision);
				else this.spaces.set(key, [revision]);
			}
		}

		for (const object of store.graph.objects) {
			if (!object.revisionId) continue;
			const key = keyOf(object.revisionId);
			const existing = this.objectsByRevision.get(key);
			if (existing) existing.push(object);
			else this.objectsByRevision.set(key, [object]);
		}

		// A later store object with the same identity replaces an earlier one.
		for (const item of store.graph.fileDataObjects) this.fileData.set(item.referenceId, item);
	}

	findCurrentSpaceByRootJcid(jcid: number): MaterializedObjectSpace | undefined {
		for (const revisions of this.spaces.values()) {
			const id = revisions[0].objectSpaceId!;
			if (id.identifier === HEADER_CELL_OBJECT_SPACE_ID && id.value === 1) continue;

			const space = this.tryGetSpace(id);
			if (space?.getRoot(1)?.jcid === jcid) return space;
		}

		return undefined;
	}

	tryGetSpace(id: ExtendedGuid, contextId?: ExtendedGuid): MaterializedObjectSpace | undefined {
		const key = spaceKey(id, contextId);
		if (this.cache.has(key)) return this.cache.get(key);

		const revisions = this.spaces.get(keyOf(id));
		if (!revisions) {
			this.cache.set(key, undefined);
			return undefined;
		}

		let current: RevisionManifest | undefined;
		let bestOrder = -1;
		for (const revision of revisions) {
			if (revision.isEncrypted) continue;
			for (const association of revision.roleAssociations) {
				if (association.role !== 1) continue;
				if (!contextEquals(association.contextId, contextId)) continue;
				if (association.order >= bestOrder) {
					bestOrder = association.order;
					current = revision;
				}
			}
		}

		if (!current) {
			this.cache.set(key, undefined);
			return undefined;
		}

		const objects = new Map<string, RevisionStoreObject>();
		const roots = new Map<number, ExtendedGuid>();

		for (const revision of this.getRevisionChain(current)) {
			for (const declaration of this.objectsByRevision.get(keyOf(revision.id)) ?? []) {
				objects.set(keyOf(declaration.id), declaration);
			}
			for (const root of revision.rootObjects) roots.set(root.role, root.objectId);
		}

		const space: MaterializedObjectSpace = {
			revision: current,
			getObject: (objectId: ExtendedGuid) => objects.get(keyOf(objectId)),
			getRoot: (role: number) => {
				const rootId = roots.get(role);
				return rootId ? objects.get(keyOf(rootId)) : undefined;
			},
		};

		this.cache.set(key, space);
		return space;
	}

	/** A revision and everything it was built on, oldest first. */
	getRevisionChain(revision: RevisionManifest): RevisionManifest[] {
		const chain: RevisionManifest[] = [];
		const visited = new Set<string>();
		let current: RevisionManifest | undefined = revision;

		while (current && !visited.has(keyOf(current.id))) {
			visited.add(keyOf(current.id));
			chain.push(current);
			current = current.dependencyId ? this.revisions.get(keyOf(current.dependencyId)) : undefined;
		}

		return chain.reverse();
	}

	/** Follows an object's `<ifndf>` reference to the bytes in the file-data store. */
	resolveFileData(item: RevisionStoreObject): Uint8Array | undefined {
		const reference = item.fileDataReference;
		if (!reference || !reference.toLowerCase().startsWith('<ifndf>')) return undefined;

		const value = reference.slice(7).trim().replace(/\0+$/, '').replace(/^\{|\}$/g, '').toLowerCase();
		return this.fileData.get(value)?.payload;
	}
}

function contextEquals(left: ExtendedGuid | undefined, right: ExtendedGuid | undefined): boolean {
	if (!left) return !right;
	if (!right) return false;
	return keyOf(left) === keyOf(right);
}
