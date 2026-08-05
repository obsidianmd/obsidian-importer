/**
 * The selection behind the tree pickers.
 *
 * Airtable and the Notion API both let the user tick their way through a tree
 * of things to import, and both had grown their own copy of the same rules.
 * They agreed - checked against each other before this was pulled out - and
 * this is the copy they now share.
 *
 * Nothing here touches the DOM. Drawing a node differs between the two for
 * real reasons: an Airtable base is collapsible before its tables are known,
 * because expanding one is what fetches them.
 */

/**
 * What the selection needs of a node. Each importer's own node type has more
 * on it, and satisfies this by having these.
 */
export interface SelectableNode {
	selected: boolean;
	/** Selected by an ancestor, so it cannot be unticked on its own. */
	disabled: boolean;
	children?: SelectableNode[];
}

/**
 * Tick or untick a node and everything under it.
 *
 * A descendant of a selected node is selected and disabled: it is coming
 * either way, so its own checkbox has nothing left to say. The node itself
 * keeps whatever disabled state it had, since that belongs to its parent.
 */
export function setNodeSelection(node: SelectableNode, selected: boolean): void {
	node.selected = selected;

	for (const child of node.children ?? []) {
		child.disabled = selected;
		setNodeSelection(child, selected);
	}
}

/**
 * Tick or untick everything, leaving alone what an ancestor already decided.
 *
 * A disabled node is skipped rather than set, but its children are still
 * walked: the tree is only disabled below something selected, and unticking
 * that something is what frees them.
 */
export function setAllSelection(nodes: SelectableNode[], selected: boolean): void {
	for (const node of nodes) {
		if (!node.disabled) {
			setNodeSelection(node, selected);
		}

		setAllSelection(node.children ?? [], selected);
	}
}

/** Whether every node in the tree is selected, which is what names the button. */
export function areAllSelected(nodes: SelectableNode[]): boolean {
	return nodes.every(node => node.selected && areAllSelected(node.children ?? []));
}

/**
 * Redraw a tree without losing where the user was.
 *
 * The container is the scroll box, so emptying it sends the list back to the
 * top - and ticking a checkbox redraws the whole tree, which is exactly when
 * the user is looking at what they just clicked.
 */
export function redrawTree(container: HTMLElement, draw: () => void): void {
	const scrollTop = container.scrollTop;

	container.empty();
	draw();

	container.scrollTop = scrollTop;
}
