import { ButtonComponent, IconName, setIcon, Setting } from 'obsidian';
import { areAllSelected, redrawTree, SelectableNode, setAllSelection, setNodeSelection } from './tree';


export interface ViewableNode<T extends SelectableNode> extends SelectableNode {
	title: string;
	collapsed?: boolean;
	children?: T[];
}

export interface TreeView<T extends ViewableNode<T>> {
	icon(node: T): IconName;
	isCollapsible?(node: T): boolean;
	flair?(node: T): string;
	onExpand?(node: T, rowEl: HTMLElement): Promise<boolean>;
	redraw(): void;
}

export function showTreePlaceholder(container: HTMLElement, text: string): void {
	redrawTree(container, () => drawPlaceholder(container, text));
}

function drawPlaceholder(container: HTMLElement, text: string): void {
	container.createDiv({ cls: 'publish-placeholder', text });
}

export interface TreePickerOptions<T extends ViewableNode<T>> {
	name: string;
	desc?: string;
	hint: string;
	loading: string;
	empty: string;
	failed(error: unknown): string;
	view: Omit<TreeView<T>, 'redraw'>;
	onChange?(): void;
}

export class TreePicker<T extends ViewableNode<T>> {
	nodes: T[] = [];
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

	onLoad(action: () => void): void {
		this.loadButton.onClick(action);
	}

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
			this.setStatus(this.options.failed(e));
			this.options.onChange?.();
			throw e;
		}
		finally {
			this.loadButton.setDisabled(false).setButtonText('Refresh').removeCta();
		}
	}

	setStatus(text: string): void {
		showTreePlaceholder(this.treeEl, text);
	}

	reset(): void {
		this.nodes = [];
		this.toggleButton.buttonEl.hide();
		this.loadButton.setButtonText('Load').setCta();
		this.setStatus(this.options.hint);
		this.options.onChange?.();
	}

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

	treeItemSelf.toggleClass('is-disabled', node.disabled);

	const collapseIcon = collapsible ? treeItemSelf.createDiv('tree-item-icon collapse-icon') : null;
	if (collapseIcon) {
		treeItemSelf.addClass('mod-collapsible');
		setIcon(collapseIcon, 'right-triangle');
		collapseIcon.toggleClass('is-collapsed', !!node.collapsed);
		treeItem.toggleClass('is-collapsed', !!node.collapsed);
	}

	const treeItemInner = treeItemSelf.createDiv('tree-item-inner file-tree-item');

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

	const flair = view.flair?.(node);
	if (flair) {
		treeItemSelf.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: flair });
	}

	const childrenContainer = treeItem.createDiv('tree-item-children');
	if (node.collapsed) childrenContainer.hide();

	renderTreeNodes(childrenContainer, children, view);

	if (collapseIcon) {
		const fold = () => {
			collapseIcon.toggleClass('is-collapsed', !!node.collapsed);
			treeItem.toggleClass('is-collapsed', !!node.collapsed);
			childrenContainer.toggle(!node.collapsed);

			iconEl.empty();
			setIcon(iconEl, view.icon(node));
		};

		collapseIcon.addEventListener('click', evt => {
			evt.stopPropagation();
			node.collapsed = !node.collapsed;

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
