import { IconName, setIcon } from 'obsidian';
import { redrawTree, SelectableNode, setNodeSelection } from './tree';

/**
 * The tree pickers, drawn.
 *
 * Airtable, the Notion API and OneNote all ask the same question - which of
 * these do you want? - and had each grown their own copy of the same markup:
 * the app's file tree, which styles.css dresses for the import dialog. This is
 * the copy they share. What ticking a box means is tree.ts, next door, which
 * stays free of the DOM because it is what the tests drive.
 *
 * What is left to each importer is the icon, whether a node opens, and what
 * opening one does - an Airtable base fetches its tables when it is expanded.
 */

/** What drawing a node needs of it, beyond what selecting it needs. */
export interface ViewableNode<T extends SelectableNode> extends SelectableNode {
	title: string;
	/** Whether its children are folded away. */
	collapsed?: boolean;
	children?: T[];
}

/** The parts of a tree its importer draws differently. */
export interface TreeView<T extends ViewableNode<T>> {
	/** The icon for a node, which may say whether it is open. */
	icon(node: T): IconName;
	/**
	 * Whether a node opens at all. Whether it has children, unless the importer
	 * knows better: an Airtable base opens before its tables are known, because
	 * opening it is what fetches them.
	 */
	isCollapsible?(node: T): boolean;
	/**
	 * A count beside the node's name, quietly and to the right, the way the
	 * app's own trees carry one.
	 *
	 * It is how many notes ticking that node would write, and nothing else: a
	 * number that counted something else - the tables in a base, the sections
	 * in a notebook - reads as the size of the import and is not. An importer
	 * that cannot say cheaply says nothing, which is what leaving this out does.
	 */
	flair?(node: T): string;
	/**
	 * Called as a node is opened, for one that fetches what is under it. Says
	 * whether the tree changed underneath and has to be drawn again.
	 *
	 * The row is passed for somewhere to put a spinner. A node that could not
	 * be opened is left collapsed by setting `collapsed` back.
	 */
	onExpand?(node: T, rowEl: HTMLElement): Promise<boolean>;
	/** Draw the whole tree again, which each importer does its own way. */
	redraw(): void;
}

/**
 * A line where the tree goes, for when there is no tree to put there yet.
 *
 * What is waited for, what came back empty, and what went wrong all belong
 * here rather than in the button beside it: this is where the answer is going
 * to appear, and it is a place that can hold a sentence without resizing.
 */
export function showTreePlaceholder(container: HTMLElement, text: string): void {
	redrawTree(container, () => {
		container.createDiv({ cls: 'publish-placeholder', text });
	});
}

/** Draw these nodes, and everything under them, into a container. */
export function renderTreeNodes<T extends ViewableNode<T>>(container: HTMLElement, nodes: T[], view: TreeView<T>): void {
	for (const node of nodes) {
		renderTreeNode(container, node, view);
	}
}

function renderTreeNode<T extends ViewableNode<T>>(container: HTMLElement, node: T, view: TreeView<T>): void {
	const children = node.children ?? [];
	const collapsible = view.isCollapsible?.(node) ?? children.length > 0;

	const treeItem = container.createDiv('tree-item');

	const treeItemSelf = treeItem.createDiv('tree-item-self');
	treeItemSelf.addClass('is-clickable');
	treeItemSelf.addClass(collapsible ? 'mod-folder' : 'mod-file');

	// Dimmed and unclickable; see .import-section .tree-item-self.is-disabled
	treeItemSelf.toggleClass('is-disabled', node.disabled);

	// Drawn before the row's contents, which is where it sits
	const collapseIcon = collapsible ? treeItemSelf.createDiv('tree-item-icon collapse-icon') : null;
	if (collapseIcon) {
		treeItemSelf.addClass('mod-collapsible');
		setIcon(collapseIcon, 'right-triangle');
		collapseIcon.toggleClass('is-collapsed', !!node.collapsed);
		treeItem.toggleClass('is-collapsed', !!node.collapsed);
	}

	const treeItemInner = treeItemSelf.createDiv('tree-item-inner file-tree-item');

	// Checked and disabled as properties, not attributes: an attribute only
	// says what the state started as
	const checkbox = treeItemInner.createEl('input', { type: 'checkbox', cls: 'file-tree-item-checkbox' });
	checkbox.checked = node.selected;
	checkbox.disabled = node.disabled;

	if (!node.disabled) {
		checkbox.addEventListener('change', () => {
			setNodeSelection(node, checkbox.checked);
			view.redraw();
		});
	}

	const iconEl = treeItemInner.createDiv('file-tree-item-icon');
	setIcon(iconEl, view.icon(node));

	treeItemInner.createDiv('file-tree-item-title').setText(node.title);

	// After the row's contents, which is what puts it at the far end
	const flair = view.flair?.(node);
	if (flair) {
		treeItemSelf.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: flair });
	}

	const childrenContainer = treeItem.createDiv('tree-item-children');
	if (node.collapsed) childrenContainer.hide();

	renderTreeNodes(childrenContainer, children, view);

	if (collapseIcon) {
		// Folded with the DOM rather than a redraw, so the rest of the tree stays
		// where the user left it
		const fold = () => {
			collapseIcon.toggleClass('is-collapsed', !!node.collapsed);
			treeItem.toggleClass('is-collapsed', !!node.collapsed);
			childrenContainer.toggle(!node.collapsed);

			// The icon may be the other thing that says whether it is open
			iconEl.empty();
			setIcon(iconEl, view.icon(node));
		};

		// The arrow stays clickable on a disabled row, which styles.css restores
		collapseIcon.addEventListener('click', evt => {
			evt.stopPropagation();
			node.collapsed = !node.collapsed;

			// A node that fetches what is under it cannot be drawn until that
			// lands. One that does not is folded here and now, in this click.
			if (!node.collapsed && view.onExpand) {
				void view.onExpand(node, treeItemSelf)
					.then(changed => changed ? view.redraw() : fold())
					.catch(e => console.error('Could not open the tree item', e));
				return;
			}

			fold();
		});
	}
}
