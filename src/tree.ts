
export interface SelectableNode {
	selected: boolean;
	disabled: boolean;
	children?: SelectableNode[];
}

export function setNodeSelection(node: SelectableNode, selected: boolean): void {
	node.selected = selected;

	for (const child of node.children ?? []) {
		// A selected parent owns the selection of its descendants.
		child.disabled = selected;
		setNodeSelection(child, selected);
	}
}

export function setAllSelection(nodes: SelectableNode[], selected: boolean): void {
	for (const node of nodes) {
		if (!node.disabled) {
			setNodeSelection(node, selected);
		}

		setAllSelection(node.children ?? [], selected);
	}
}

export function areAllSelected(nodes: SelectableNode[]): boolean {
	return nodes.every(node => node.selected && areAllSelected(node.children ?? []));
}

export function areAnySelected(nodes: SelectableNode[]): boolean {
	return nodes.some(node => node.selected || areAnySelected(node.children ?? []));
}

export function selectedNodes<T extends SelectableNode>(nodes: T[], canImport: (node: T) => boolean = () => true, into: T[] = []): T[] {
	for (const node of nodes) {
		if (node.selected && canImport(node)) into.push(node);
		selectedNodes((node.children ?? []) as T[], canImport, into);
	}

	return into;
}

export interface NamedNode {
	title: string;
	children?: NamedNode[];
}

/** Returns matches, their descendants, and the ancestors needed to reach them. */
export function nodesMatching<T extends NamedNode>(nodes: T[], query: string): Set<T> {
	const wanted = query.trim().toLowerCase();
	const kept = new Set<T>();
	if (!wanted) return kept;

	const walk = (node: T, underAMatch: boolean): boolean => {
		const matches = underAMatch || node.title.toLowerCase().includes(wanted);
		let keep = matches;

		for (const child of (node.children ?? []) as T[]) {
			if (walk(child, matches)) keep = true;
		}

		if (keep) kept.add(node);
		return keep;
	};

	for (const node of nodes) walk(node, false);

	return kept;
}

export function redrawTree(container: HTMLElement, draw: () => void): void {
	// Preserve every scrolling ancestor while emptying collapses the tree.
	const scrolled: [HTMLElement, number][] = [];
	for (let el: HTMLElement | null = container; el; el = el.parentElement) {
		if (el.scrollTop > 0) scrolled.push([el, el.scrollTop]);
	}

	container.empty();
	draw();

	for (const [el, scrollTop] of scrolled) {
		if (el.scrollTop !== scrollTop) el.scrollTop = scrollTop;
	}
}
