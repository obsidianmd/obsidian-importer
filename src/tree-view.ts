import { ButtonComponent, IconName, SearchComponent, setIcon, Setting } from 'obsidian';
import { i18n } from './i18n';
import { areAllSelected, areAnySelected, nodesMatching, redrawTree, SelectableNode, setAllSelection, setNodeSelection } from './tree';


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
	selectionChanged(): void;
	filtered?: Set<T> | null;
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
	view: Omit<TreeView<T>, 'redraw' | 'selectionChanged'>;
	onChange?(): void;
	loadsItself?: boolean;
	setting?: Setting | null;
}

export class TreePicker<T extends ViewableNode<T>> {
	nodes: T[] = [];
	readonly treeEl: HTMLElement;

	private toggleButton: ButtonComponent;
	private loadButton: ButtonComponent;
	private rowEl: HTMLElement;
	private sectionEl: HTMLElement;
	private filterEl: HTMLElement;
	private search: SearchComponent;
	private query: string = '';
	private loadGeneration: number = 0;

	constructor(containerEl: HTMLElement, private options: TreePickerOptions<T>) {
		const setting = (options.setting ?? new Setting(containerEl))
			.setName(options.name)
			.setDesc(options.desc ?? '')
			.addButton(button => {
				this.toggleButton = button;
				button.buttonEl.addClass('importer-tree-button');
				button.buttonEl.hide();
				button.setButtonText(i18n.tree.buttonSelectAll()).onClick(() => {
					setAllSelection(this.nodes, !areAllSelected(this.nodes));
					this.render();
				});
			})
			.addButton(button => {
				this.loadButton = button;
				button.buttonEl.addClass('importer-tree-button');
				button.setButtonText(i18n.tree.buttonLoad());
				if (options.loadsItself) button.buttonEl.hide();
			});

		this.rowEl = setting.settingEl;
		const treeParentEl = options.setting?.settingEl.parentElement ?? containerEl;
		this.sectionEl = treeParentEl.createDiv('import-section file-tree publish-section');
		const sectionEl = this.sectionEl;

		this.filterEl = sectionEl.createDiv('importer-tree-filter');
		this.filterEl.hide();

		this.search = new SearchComponent(this.filterEl)
			.setPlaceholder(i18n.tree.placeholderFilter())
			.onChange(query => {
				this.query = query;
				this.render();
			});

		this.treeEl = sectionEl.createDiv('publish-change-list');

		showTreePlaceholder(this.treeEl, options.hint);
	}

	onLoad(action: () => void): void {
		this.loadButton.onClick(action);
	}

	toggle(shown: boolean): void {
		this.rowEl.toggle(shown);
		this.sectionEl.toggle(shown);
	}

	async load(load: (isCurrent: () => boolean) => Promise<T[]>): Promise<void> {
		const generation = ++this.loadGeneration;
		const isCurrent = () => generation === this.loadGeneration;

		this.nodes = [];
		this.clearFilter();
		this.toggleButton.buttonEl.hide();
		this.loadButton.setDisabled(true).setButtonText(i18n.tree.buttonLoading());
		this.setStatus(this.options.loading);

		try {
			const nodes = await load(isCurrent);
			if (!isCurrent()) return;

			this.nodes = nodes;
			this.render();
			if (this.nodes.length > 0) this.toggleButton.buttonEl.show();
		}
		catch (e) {
			if (!isCurrent()) return;

			this.setStatus(this.options.failed(e));
			this.options.onChange?.();
			throw e;
		}
		finally {
			if (isCurrent()) this.loadButton.setDisabled(false).setButtonText(i18n.tree.buttonRefresh());
		}
	}

	setStatus(text: string): void {
		showTreePlaceholder(this.treeEl, text);
	}

	reset(): void {
		this.loadGeneration++;
		this.nodes = [];
		this.toggleButton.buttonEl.hide();
		this.loadButton.setDisabled(false).setButtonText(i18n.tree.buttonLoad());
		this.clearFilter();
		this.setStatus(this.options.hint);
		this.options.onChange?.();
	}

	private clearFilter(): void {
		this.query = '';
		this.search.setValue('');
		this.filterEl.hide();
	}

	render(): void {
		const filtered = this.query.trim() ? nodesMatching(this.nodes, this.query) : null;

		redrawTree(this.treeEl, () => {
			if (this.nodes.length === 0) {
				drawPlaceholder(this.treeEl, this.options.empty);
				return;
			}

			if (filtered && filtered.size === 0) {
				drawPlaceholder(this.treeEl, i18n.tree.msgNoMatches());
				return;
			}

			renderTreeNodes(this.treeEl, this.nodes, {
				...this.options.view,
				filtered,
				redraw: () => this.render(),
				selectionChanged: () => this.selectionChanged(),
			});
		});

		this.filterEl.toggle(this.nodes.length > 0);
		this.selectionChanged();
	}

	private selectionChanged(): void {
		this.toggleButton.setButtonText(areAllSelected(this.nodes) ? i18n.tree.buttonDeselectAll() : i18n.tree.buttonSelectAll());
		this.options.onChange?.();
	}
}

export function renderTreeNodes<T extends ViewableNode<T>>(container: HTMLElement, nodes: T[], view: TreeView<T>, above: Ancestor<T>[] = []): void {
	for (const node of nodes) {
		if (view.filtered && !view.filtered.has(node)) continue;

		renderTreeNode(container, node, view, above);
	}
}

interface Ancestor<T extends ViewableNode<T>> {
	checkbox: HTMLInputElement;
	node: T;
}

/** Obsidian styles indeterminate checkboxes through this data attribute. */
function setSelectionState<T extends ViewableNode<T>>(checkbox: HTMLInputElement, node: T): void {
	const children = node.children ?? [];
	const all = node.selected && areAllSelected(children);
	const some = !all && (node.selected || areAnySelected(children));

	checkbox.checked = all;
	checkbox.setAttr('data-indeterminate', some);
}

function refreshSelection<T extends ViewableNode<T>>(treeItem: HTMLElement, node: T, view: TreeView<T>): void {
	// Avoid instanceof across a separate Settings window.
	const selfEl = treeItem.firstElementChild as HTMLElement | null;
	const checkbox = selfEl?.querySelector<HTMLInputElement>('input.file-tree-item-checkbox');

	if (checkbox) {
		checkbox.disabled = node.disabled;
		setSelectionState(checkbox, node);
	}

	selfEl?.toggleClass('is-disabled', node.disabled);

	const childrenEl = treeItem.lastElementChild;
	if (!childrenEl || childrenEl === selfEl) return;

	const drawn = (node.children ?? []).filter(child => !view.filtered || view.filtered.has(child));
	const rows = Array.from(childrenEl.children) as HTMLElement[];

	drawn.forEach((child, index) => {
		if (rows[index]) refreshSelection(rows[index], child, view);
	});
}

function renderTreeNode<T extends ViewableNode<T>>(container: HTMLElement, node: T, view: TreeView<T>, above: Ancestor<T>[] = []): void {
	const children = node.children ?? [];
	const collapsible = view.isCollapsible?.(node) ?? children.length > 0;

	// Filtering expands matches without changing the saved collapsed state.
	let folded = view.filtered ? false : !!node.collapsed;

	const treeItem = container.createDiv('tree-item');

	const treeItemSelf = treeItem.createDiv('tree-item-self');
	treeItemSelf.addClass('is-clickable');
	treeItemSelf.addClass(collapsible ? 'mod-folder' : 'mod-file');

	treeItemSelf.toggleClass('is-disabled', node.disabled);

	const collapseIcon = collapsible ? treeItemSelf.createDiv('tree-item-icon collapse-icon') : null;
	if (collapseIcon) {
		treeItemSelf.addClass('mod-collapsible');
		setIcon(collapseIcon, 'right-triangle');
		collapseIcon.toggleClass('is-collapsed', folded);
		treeItem.toggleClass('is-collapsed', folded);
	}

	const treeItemInner = treeItemSelf.createDiv('tree-item-inner file-tree-item');

	const checkbox = treeItemInner.createEl('input', { type: 'checkbox', cls: 'file-tree-item-checkbox' });
	checkbox.disabled = node.disabled;
	setSelectionState(checkbox, node);

	checkbox.addEventListener('change', () => {
		if (node.disabled) return;

		setNodeSelection(node, checkbox.checked);

		refreshSelection(treeItem, node, view);
		for (const ancestor of above) setSelectionState(ancestor.checkbox, ancestor.node);
		view.selectionChanged();
	});

	const iconEl = treeItemInner.createDiv('file-tree-item-icon');
	setIcon(iconEl, view.icon(node));

	treeItemInner.createDiv('file-tree-item-title').setText(node.title);

	const flair = view.flair?.(node);
	if (flair) {
		treeItemSelf.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: flair });
	}

	const childrenContainer = treeItem.createDiv('tree-item-children');
	if (folded) childrenContainer.hide();

	renderTreeNodes(childrenContainer, children, view, [...above, { checkbox, node }]);

	if (collapseIcon) {
		const fold = () => {
			collapseIcon.toggleClass('is-collapsed', folded);
			treeItem.toggleClass('is-collapsed', folded);
			childrenContainer.toggle(!folded);

			iconEl.empty();
			setIcon(iconEl, view.icon(node));
		};

		collapseIcon.addEventListener('click', evt => {
			evt.stopPropagation();
			folded = !folded;
			node.collapsed = folded;

			if (!folded && view.onExpand) {
				void view.onExpand(node, treeItemSelf)
					.then(changed => changed ? view.redraw() : fold())
					.catch(e => console.error('Could not open the tree item', e));
				return;
			}

			fold();
		});
	}
}
