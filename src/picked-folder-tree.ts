import { PickedFile, PickedFolder } from './filesystem';
import { ViewableNode } from './tree-view';

export interface PickedFolderNode extends ViewableNode<PickedFolderNode> {
	path: string;
	files: number;
}

export interface PickedFolderTreeOptions {
	includeFolder?: (folder: PickedFolder, parent: string) => boolean;
	countFile?: (file: PickedFile, parent: string) => boolean;
	isCurrent?: () => boolean;
}

export interface PickedFolderSelection {
	included: Set<string> | null;
	skipped: Set<string>;
}

export async function pickedFolderNodes(
	items: (PickedFile | PickedFolder)[],
	options: PickedFolderTreeOptions = {},
	from: string = '',
): Promise<PickedFolderNode[]> {
	const includeFolder = options.includeFolder ?? (() => true);
	const countFile = options.countFile ?? (() => true);
	const isCurrent = options.isCurrent ?? (() => true);
	const folders = items.filter((item): item is PickedFolder =>
		item.type === 'folder' && includeFolder(item, from));
	const listings = await Promise.all(folders.map(folder => folder.list()));
	if (!isCurrent()) return [];

	const nodes: PickedFolderNode[] = [];
	for (const [index, folder] of folders.entries()) {
		const path = from ? `${from}/${folder.name}` : folder.name;
		const inside = listings[index];
		const children = await pickedFolderNodes(inside, options, path);
		if (!isCurrent()) return [];

		nodes.push({
			title: folder.name,
			path,
			files: inside.filter(item => item.type === 'file' && countFile(item, path)).length
				+ children.reduce((total, child) => total + child.files, 0),
			selected: true,
			disabled: false,
			collapsed: from !== '',
			children,
		});
	}

	return nodes;
}

export function pickedFolderSelection(nodes: PickedFolderNode[]): PickedFolderSelection {
	const included = nodes.length > 0 ? new Set<string>() : null;
	const skipped = new Set<string>();
	if (!included) return { included, skipped };

	const walk = (inside: PickedFolderNode[]): boolean => {
		let wanted = false;

		for (const node of inside) {
			const below = walk(node.children ?? []);

			if (node.selected) included.add(node.path);
			else if (!below) skipped.add(node.path);

			wanted ||= node.selected || below;
		}

		return wanted;
	};

	walk(nodes);
	return { included, skipped };
}
