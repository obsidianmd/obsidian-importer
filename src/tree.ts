
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

/** A node a filter can read: what it is called, and what is under it. */
export interface NamedNode {
	title: string;
	children?: NamedNode[];
}

/**
 * Which nodes a query leaves standing: the ones it names, everything under one
 * of those, and the branch that leads down to it — a match whose path is hidden
 * is an answer nobody can reach.
 *
 * An empty query is nobody asking, and is answered with nothing rather than
 * with everything: whether to filter at all is the caller's to decide.
 */
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
	const scrollTop = container.scrollTop;

	container.empty();
	draw();

	// empty() resets the scroll position.
	container.scrollTop = scrollTop;
}
