
export type NotionParent =
	| { type: 'page_id', page_id: string }
	| { type: 'data_source_id', data_source_id: string, database_id: string }
	| { type: 'database_id', database_id: string }
	| { type: 'workspace', workspace: true }
	| { type: 'block_id', block_id: string };

export interface NotionTreeNode {
	id: string;
	title: string;
	type: 'page' | 'database';
	parentId: string | null;
	children: NotionTreeNode[];
	selected: boolean;
	disabled: boolean;
	collapsed: boolean;
}

export interface NotionItem {
	id: string;
	title: string;
	type: 'page' | 'database';
	parentId: string | null;
}

export function extractItemTitle(item: any, defaultTitle: string = 'Untitled'): string {
	let titleArray: any[] | undefined;

	if (item.title) {
		titleArray = item.title;
	}
	else if (item.properties) {
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
			return parentObj.data_source_id;

		case 'database_id':
			return parentObj.database_id;

		case 'workspace':
			return null;

		case 'block_id':
			console.warn('[Notion Importer] block_id parent should be filtered before calling extractParentId');
			return null;

		default: {
			const _exhaustive: never = parentObj;
			console.warn(`[Notion Importer] Unexpected parent type for ${context}:`, _exhaustive);
			return null;
		}
	}
}

export function collectItems(allRawItems: any[]): NotionItem[] {
	const filteredIds = new Set<string>();

	for (const item of allRawItems) {
		if (item.object === 'data_source') {
			if (item.database_parent && item.database_parent.type === 'block_id') {
				filteredIds.add(item.id);
			}
		}
		else if (item.object === 'page') {
			if (item.parent && item.parent.type === 'block_id') {
				filteredIds.add(item.id);
			}
		}
	}

	const allItems: NotionItem[] = [];
	for (const item of allRawItems) {
		if (filteredIds.has(item.id)) {
			continue;
		}

		if (item.object === 'data_source' && item.database_parent && item.database_parent.type === 'page_id') {
			const parentPageId = item.database_parent.page_id;
			if (filteredIds.has(parentPageId)) {
				continue;
			}
		}

		if (item.object === 'page' && item.parent && item.parent.type === 'data_source_id') {
			const dataSourceId = item.parent.data_source_id;
			if (filteredIds.has(dataSourceId)) {
				continue;
			}
		}

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

export function buildTree(items: NotionItem[]): NotionTreeNode[] {
	const nodeMap = new Map<string, NotionTreeNode>();
	const roots: NotionTreeNode[] = [];

	for (const item of items) {
		nodeMap.set(item.id, {
			id: item.id,
			title: item.title,
			type: item.type,
			parentId: item.parentId,
			children: [],
			selected: false,
			disabled: false,
			collapsed: true,
		});
	}

	for (const node of nodeMap.values()) {
		if (node.parentId && nodeMap.has(node.parentId)) {
			const parent = nodeMap.get(node.parentId)!;
			parent.children.push(node);
		}
		else {
			roots.push(node);
		}
	}

	const sortNodes = (nodes: NotionTreeNode[]) => {
		nodes.sort((a, b) => a.title.localeCompare(b.title));
		for (const node of nodes) {
			sortNodes(node.children);
		}
	};
	sortNodes(roots);

	return roots;
}
