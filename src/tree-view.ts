import { ButtonComponent, IconName, setIcon, Setting } from 'obsidian';
import { areAllSelected, redrawTree, SelectableNode, setAllSelection, setNodeSelection } from './tree';

/**
 * The tree pickers, drawn.
 *
 * Airtable, the Notion API, OneNote and Apple Notes all ask the same question -
 * which of these do you want? - and had each grown their own copy of the same
 * screen: a row naming what is being picked, a Select all beside a Load, and
 * the app's file tree below them, which styles.css dresses for this dialog.
 * This is the copy they share. What ticking a box means is tree.ts, next door,
 * which stays free of the DOM because it is what the tests drive.
 *
 * What is left to each importer is where its nodes come from, and how one is
 * drawn: the icon, whether it opens, and what opening it does - an Airtable
 * base fetches its tables when it is expanded.
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
	redrawTree(container, () => drawPlaceholder(container, text));
}

/** showTreePlaceholder, for a caller already inside a redraw. */
function drawPlaceholder(container: HTMLElement, text: string): void {
	container.createDiv({ cls: 'publish-placeholder', text });
}

/** What a picker needs of its importer beyond how to draw a node. */
export interface TreePickerOptions<T extends ViewableNode<T>> {
	/** What is being picked: "Pages to import". */
	name: string;
	desc?: string;
	/** What the tree says before anything has been loaded into it. */
	hint: string;
	/** What it says while a load is in flight, which each names its own way. */
	loading: string;
	/** What it says when a load came back with nothing. */
	empty: string;
	/** What it says when a load did not come back at all. */
	failed: string;
	/** How a node is drawn. redraw is the picker's own; see TreeView. */
	view: Omit<TreeView<T>, 'redraw'>;
	/** Told when the selection changes, and when a load has landed. */
	onChange?(): void;
}

/**
 * The screen an importer picks from: a row, two buttons, and a tree.
 *
 * The importer says where its nodes come from and hands them over; everything
 * about showing them - which button is offered, what the empty tree says, when
 * Select all becomes Deselect all - is answered here, once.
 */
export class TreePicker<T extends ViewableNode<T>> {
	/** What is being picked from, as the last load left it. */
	nodes: T[] = [];
	/** The scroll box the tree is drawn in, for anything else to write into. */
	readonly treeEl: HTMLElement;

	private toggleButton: ButtonComponent;
	private loadButton: ButtonComponent;

	constructor(containerEl: HTMLElement, private options: TreePickerOptions<T>) {
		new Setting(containerEl)
			.setName(options.name)
			.setDesc(options.desc ?? '')
			.addButton(button => {
				this.toggleButton = button;
				button.buttonEl.addClass('importer-tree-button');
				// Nothing to select until there is something loaded to select
				button.buttonEl.hide();
				button.setButtonText('Select all').onClick(() => {
					setAllSelection(this.nodes, !areAllSelected(this.nodes));
					this.render();
				});
			})
			.addButton(button => {
				this.loadButton = button;
				button.buttonEl.addClass('importer-tree-button', 'mod-cta');
				button.setButtonText('Load');
			});

		this.treeEl = containerEl
			.createDiv('import-section file-tree publish-section')
			.createDiv('publish-change-list');

		showTreePlaceholder(this.treeEl, options.hint);
	}

	/**
	 * What Load and Refresh do.
	 *
	 * The importer's own entry point rather than its loader, so that whatever
	 * it checks before fetching - a token linked, an account signed in, a
	 * folder it has been let into - is checked on a click too.
	 */
	onLoad(action: () => void): void {
		this.loadButton.onClick(action);
	}

	/**
	 * Fetch what goes in the tree, saying so while it happens.
	 *
	 * The button is held and renamed around the wait, since after the first
	 * time it is no longer the thing to do; a failure leaves what it says in
	 * the tree, where the button that tries again is still reachable.
	 */
	async load(load: () => Promise<T[]>): Promise<void> {
		this.nodes = [];
		this.toggleButton.buttonEl.hide();
		this.loadButton.setDisabled(true).setButtonText('Loading...');
		this.setStatus(this.options.loading);

		try {
			this.nodes = await load();
			this.render();
			if (this.nodes.length > 0) this.toggleButton.buttonEl.show();
		}
		catch (e) {
			// Said where the tree would have been, rather than left on the line
			// that says it is still coming. What went wrong is the caller's to
			// report; that it did not arrive is this screen's - including to
			// whatever was waiting on a selection that no longer exists.
			this.setStatus(this.options.failed);
			this.options.onChange?.();
			throw e;
		}
		finally {
			this.loadButton.setDisabled(false).setButtonText('Refresh').removeCta();
		}
	}

	/** Say what is happening where the tree is going to appear. */
	setStatus(text: string): void {
		showTreePlaceholder(this.treeEl, text);
	}

	/** Put the picker back to how it looked before anything was loaded. */
	reset(): void {
		this.nodes = [];
		this.toggleButton.buttonEl.hide();
		this.loadButton.setButtonText('Load').setCta();
		this.setStatus(this.options.hint);
		this.options.onChange?.();
	}

	/** Draw the tree as it now stands, and say that it changed. */
	render(): void {
		redrawTree(this.treeEl, () => {
			if (this.nodes.length === 0) {
				drawPlaceholder(this.treeEl, this.options.empty);
				return;
			}

			renderTreeNodes(this.treeEl, this.nodes, {
				...this.options.view,
				redraw: () => this.render(),
			});
		});

		this.toggleButton.setButtonText(areAllSelected(this.nodes) ? 'Deselect all' : 'Select all');
		this.options.onChange?.();
	}
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
