import { Setting } from 'obsidian';
import { PickedFile, PickedFolder } from './filesystem';
import { i18n } from './i18n';
import { TreePicker, ViewableNode } from './tree-view';
import { countText, describeReason } from './util';

export interface PickedFolderNode extends ViewableNode<PickedFolderNode> {
	path: string;
	files: number;
}

export interface PickedFolderTreeOptions {
	includeFolder?: (folder: PickedFolder, chosen: boolean) => boolean;
	countFile?: (file: PickedFile, parent: string) => boolean;
	isCurrent?: () => boolean;
}

export function isHiddenPickedItem(item: PickedFile | PickedFolder): boolean {
	return item.name.startsWith('.');
}

export interface PickedFolderSelection {
	included: Set<string> | null;
	skipped: Set<string>;
}

export class PickedFolderPicker {
	private picker: TreePicker<PickedFolderNode> | null = null;
	private loadedFrom: string = '';

	constructor(
		private readonly source: () => (PickedFile | PickedFolder)[],
		private readonly loadNodes: (
			items: (PickedFile | PickedFolder)[],
			isCurrent: () => boolean,
		) => Promise<PickedFolderNode[]>,
	) {}

	draw(containerEl: HTMLElement, setting?: Setting | null): void {
		this.picker = new TreePicker<PickedFolderNode>(containerEl, {
			setting,
			name: i18n.source.dialogPickFolders(),
			desc: i18n.source.descFolders(),
			hint: i18n.source.msgPickSourceFirst(),
			loading: i18n.source.msgReadingFolders(),
			empty: i18n.source.msgNoFolders(),
			failed: error => describeReason(error),
			view: {
				icon: node => node.children?.length && !node.collapsed ? 'folder-open' : 'folder',
				flair: node => countText(node.files),
			},
			loadsItself: true,
		});

		this.picker.toggle(this.source().length > 0);
	}

	changed(): void {
		const source = this.source();
		this.picker?.toggle(source.length > 0);

		const key = source.map(item => item.toString()).join('\n');
		if (key === this.loadedFrom) return;

		this.loadedFrom = key;
		if (this.picker) void this.load();
	}

	async load(): Promise<void> {
		if (!this.picker) return;

		const source = this.source();
		if (source.length === 0) {
			this.picker.reset();
			return;
		}

		await this.picker.load(isCurrent => this.loadNodes(source, isCurrent));
	}

	selection(): PickedFolderSelection {
		return pickedFolderSelection(this.picker?.nodes ?? []);
	}
}

export interface PlannedPickedItem {
	parent: string;
	source: string;
	/** Null for an empty source folder. */
	file: PickedFile | null;
}

export interface PickedFolderWalkOptions {
	selection: PickedFolderSelection;
	includeFile(file: PickedFile, chosen: boolean): boolean;
	includeFolder(folder: PickedFolder, chosen: boolean): boolean;
	folderPath(folder: PickedFolder, parent: string, chosen: boolean): string;
	onFolder(path: string, chosen: boolean): void;
	shouldStop(): Promise<boolean>;
	onError(item: PickedFile | PickedFolder, error: unknown): void;
}

export async function plannedPickedItems(
	items: (PickedFile | PickedFolder)[],
	into: string,
	options: PickedFolderWalkOptions,
	chosen = true,
	from = '',
): Promise<PlannedPickedItem[]> {
	const planned: PlannedPickedItem[] = [];

	for (const item of items) {
		if (await options.shouldStop()) return planned;

		try {
			if (item.type === 'file') {
				if (!options.includeFile(item, chosen)) continue;
				if (from && options.selection.included && !options.selection.included.has(from)) continue;

				planned.push({ parent: into, source: joinPickedPath(from, item.name), file: item });
				continue;
			}

			if (!options.includeFolder(item, chosen)) continue;
			const source = joinPickedPath(from, item.name);
			if (options.selection.skipped.has(source)) continue;

			const at = options.folderPath(item, into, chosen);
			const listed = await item.list();
			const inside = await plannedPickedItems(listed, at, options, false, source);
			if (inside.length > 0) {
				options.onFolder(at, chosen);
				for (const child of inside) planned.push(child);
			}
			else if (listed.length === 0) {
				options.onFolder(at, chosen);
				planned.push({ parent: at, source, file: null });
			}
		}
		catch (error) {
			options.onError(item, error);
		}
	}

	return planned;
}

export async function pickedFolderNodes(
	items: (PickedFile | PickedFolder)[],
	options: PickedFolderTreeOptions = {},
	from: string = '',
): Promise<PickedFolderNode[]> {
	const includeFolder = options.includeFolder ?? (() => true);
	const countFile = options.countFile ?? (() => true);
	const isCurrent = options.isCurrent ?? (() => true);
	const chosen = from === '';
	const folders = items.filter((item): item is PickedFolder =>
		item.type === 'folder' && includeFolder(item, chosen));
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

function joinPickedPath(from: string, name: string): string {
	return from ? `${from}/${name}` : name;
}
