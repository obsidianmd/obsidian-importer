/**
 * What the user is offered to import, worked out from a Notion search.
 *
 * The importer asks /v1/search for everything the integration can see and gets
 * back a flat list of pages and data sources, each naming its parent. Turning
 * that into the tree the picker draws is the whole of this file: decide what
 * does not belong in it, flatten the rest, then hang each item off its parent.
 *
 * It is here rather than on the importer because it needs nothing from the
 * vault or the network - only a search response, which a test can hold - and
 * because what it drops is where the reports of missing pages keep landing.
 */

/** A page or data source's parent, as the API describes it. */
export type NotionParent =
	| { type: 'page_id', page_id: string }
	| { type: 'data_source_id', data_source_id: string, database_id: string }
	| { type: 'database_id', database_id: string }
	| { type: 'workspace', workspace: true }
	| { type: 'block_id', block_id: string };

/** A node in the tree the picker draws. */
export interface NotionTreeNode {
	id: string; // For pages: page ID; For databases: data_source ID
	title: string;
	type: 'page' | 'database';
	parentId: string | null;
	children: NotionTreeNode[];
	selected: boolean;
	disabled: boolean; // Disabled when parent is selected
	collapsed: boolean; // Whether the node's children are collapsed
}

/** One row of the flat list, before it becomes a tree. */
export interface NotionItem {
	id: string;
	title: string;
	type: 'page' | 'database';
	parentId: string | null;
}

/**
 * Extract title from a Notion item (page or data_source)
 * Both use the same title array structure with rich text
 */
export function extractItemTitle(item: any, defaultTitle: string = 'Untitled'): string {
	let titleArray: any[] | undefined;

	// data_source has title directly
	if (item.title) {
		titleArray = item.title;
	}
	// page has title in properties object
	// properties is an object where one of the keys has type: 'title'
	else if (item.properties) {
		// Find the property with type 'title'
		for (const key in item.properties) {
			const prop = item.properties[key];
			if (prop.type === 'title' && prop.title) {
				titleArray = prop.title;
				break;
			}
		}
	}

	if (!titleArray || !Array.isArray(titleArray)) {
		return defaultTitle;
	}

	const title = titleArray
		.map((t: any) => t.text?.content || t.plain_text || '')
		.join('')
		.trim();

	return title || defaultTitle;
}

/**
 * Extract parent ID from a parent object (used for both page.parent and data_source.database_parent)
 * Note: Items with block_id parent should be filtered out before calling this
 */
export function extractParentId(
	parentObj: NotionParent | null | undefined,
	context: 'page' | 'database'
): string | null {
	if (!parentObj) {
		return null;
	}

	switch (parentObj.type) {
		case 'page_id':
			return parentObj.page_id;

		case 'data_source_id':
			// Pages in a database have data_source_id as parent
			return parentObj.data_source_id;

		case 'database_id':
			// Databases can have database_id as parent (nested databases)
			return parentObj.database_id;

		case 'workspace':
			// Top-level item
			return null;

		case 'block_id':
			// This should have been filtered out before calling this function
			console.warn('[Notion Importer] block_id parent should be filtered before calling extractParentId');
			return null;

		default: {
			// TypeScript exhaustiveness check
			const _exhaustive: never = parentObj;
			console.warn(`[Notion Importer] Unexpected parent type for ${context}:`, _exhaustive);
			return null;
		}
	}
}

/**
 * The flat list a search response reduces to.
 *
 * Two-phase filtering:
 * Phase 1: Collect all items and identify databases that are inside blocks
 * Phase 2: Filter out pages that belong to those databases
 */
export function collectItems(allRawItems: any[]): NotionItem[] {
	// Phase 1: Identify items that should be filtered
	// Collect IDs of pages and databases that won't appear in tree:
	// - Databases with database_parent.type === 'block_id'
	// - Pages with parent.type === 'block_id'
	const filteredIds = new Set<string>();

	for (const item of allRawItems) {
		if (item.object === 'data_source') {
			// Databases inside blocks
			if (item.database_parent && item.database_parent.type === 'block_id') {
				filteredIds.add(item.id);
			}
		}
		else if (item.object === 'page') {
			// Pages with block_id parent
			if (item.parent && item.parent.type === 'block_id') {
				filteredIds.add(item.id);
			}
		}
	}

	// Phase 2: Process items and filter appropriately
	const allItems: NotionItem[] = [];
	for (const item of allRawItems) {
		// Skip if this item itself is in the filtered list
		if (filteredIds.has(item.id)) {
			continue;
		}

		// Skip databases whose parent page is filtered
		if (item.object === 'data_source' && item.database_parent && item.database_parent.type === 'page_id') {
			const parentPageId = item.database_parent.page_id;
			if (filteredIds.has(parentPageId)) {
				continue;
			}
		}

		// Skip pages that belong to filtered databases
		if (item.object === 'page' && item.parent && item.parent.type === 'data_source_id') {
			const dataSourceId = item.parent.data_source_id;
			if (filteredIds.has(dataSourceId)) {
				continue;
			}
		}

		// Process page or data_source (database)
		if (item.object === 'page' || item.object === 'data_source') {
			const isDatabase = item.object === 'data_source';
			const title = extractItemTitle(item, isDatabase ? 'Untitled Database' : 'Untitled');
			const parentObj = isDatabase ? item.database_parent : item.parent;
			const parentId = extractParentId(parentObj, isDatabase ? 'database' : 'page');

			allItems.push({
				id: item.id,
				title,
				type: isDatabase ? 'database' : 'page',
				parentId,
			});
		}
	}

	return allItems;
}

/**
 * Build tree structure from flat list
 */
export function buildTree(items: NotionItem[]): NotionTreeNode[] {
	const nodeMap = new Map<string, NotionTreeNode>();
	const roots: NotionTreeNode[] = [];

	// Create all nodes
	for (const item of items) {
		nodeMap.set(item.id, {
			id: item.id,
			title: item.title,
			type: item.type,
			parentId: item.parentId,
			children: [],
			selected: false,
			disabled: false,
			collapsed: true, // Default to collapsed
		});
	}

	// Build tree relationships
	for (const node of nodeMap.values()) {
		if (node.parentId && nodeMap.has(node.parentId)) {
			const parent = nodeMap.get(node.parentId)!;
			parent.children.push(node);
		}
		else {
			// No parent or parent not in list -> root node
			roots.push(node);
		}
	}

	// Sort children by title
	const sortNodes = (nodes: NotionTreeNode[]) => {
		nodes.sort((a, b) => a.title.localeCompare(b.title));
		for (const node of nodes) {
			sortNodes(node.children);
		}
	};
	sortNodes(roots);

	return roots;
}
