
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

export function redrawTree(container: HTMLElement, draw: () => void): void {
	const scrollTop = container.scrollTop;

	container.empty();
	draw();

	// empty() resets the scroll position.
	container.scrollTop = scrollTop;
}
