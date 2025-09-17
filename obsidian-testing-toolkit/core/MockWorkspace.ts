/**
 * Obsidian Testing Toolkit - Mock Workspace Implementation
 *
 * Mock implementation of Obsidian's Workspace for testing layout management,
 * leaf handling, and workspace events.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { MockVault, MockTFile } from './MockVault';
import { MockEditor } from './MockEditor';

/**
 * Mock implementation of Obsidian's WorkspaceLeaf
 */
export class MockWorkspaceLeaf extends EventEmitter {
  public view: any;
  public parent: any;
  public workspace: MockWorkspace;
  public id: string;

  private isActive: boolean = false;
  private isPinned: boolean = false;

  constructor(workspace: MockWorkspace, id?: string) {
    super();
    this.workspace = workspace;
    this.id = id || this.generateId();
  }

  /**
   * Open a view in this leaf
   */
  public async openFile(file: MockTFile, state?: any): Promise<void> {
    const viewType = this.getViewTypeForFile(file);
    await this.setViewState({ type: viewType, state: { file: file.path, ...state } });
  }

  /**
   * Set the view state for this leaf
   */
  public async setViewState(viewState: { type: string; state?: any }): Promise<void> {
    const oldView = this.view;

    // Create new view based on type
    this.view = this.createView(viewState.type, viewState.state);

    if (oldView) {
      this.emit('view-unloaded', oldView);
    }

    this.emit('view-loaded', this.view);
    this.workspace.emit('active-leaf-change', this);
  }

  /**
   * Get the current view state
   */
  public getViewState(): any {
    return this.view ? this.view.getState() : null;
  }

  /**
   * Detach this leaf
   */
  public detach(): void {
    if (this.parent) {
      this.parent.removeChild(this);
    }
    this.workspace.removeLeaf(this);
    this.emit('detached');
  }

  /**
   * Pin this leaf
   */
  public setPinned(pinned: boolean): void {
    this.isPinned = pinned;
    this.emit('pinned-changed', pinned);
  }

  /**
   * Check if leaf is pinned
   */
  public getPinned(): boolean {
    return this.isPinned;
  }

  /**
   * Set active state
   */
  public setActive(active: boolean): void {
    this.isActive = active;
    if (active) {
      this.workspace.setActiveLeaf(this);
    }
    this.emit('active-changed', active);
  }

  /**
   * Get display text for this leaf
   */
  public getDisplayText(): string {
    return this.view ? this.view.getDisplayText() : 'Empty';
  }

  /**
   * Get view type
   */
  public getViewType(): string {
    return this.view ? this.view.getViewType() : 'empty';
  }

  /**
   * Create a view based on type
   */
  private createView(type: string, state?: any): any {
    switch (type) {
      case 'markdown':
        return new MockMarkdownView(this, state);
      case 'empty':
        return new MockEmptyView(this, state);
      default:
        return new MockGenericView(this, type, state);
    }
  }

  /**
   * Determine view type for file
   */
  private getViewTypeForFile(file: MockTFile): string {
    if (file.extension === 'md') {
      return 'markdown';
    }
    return 'text';
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}

/**
 * Mock markdown view
 */
export class MockMarkdownView extends EventEmitter {
  public leaf: MockWorkspaceLeaf;
  public file: MockTFile | null = null;
  public editor: MockEditor;
  public mode: 'preview' | 'source' = 'source';

  constructor(leaf: MockWorkspaceLeaf, state?: any) {
    super();
    this.leaf = leaf;
    this.editor = new MockEditor();

    if (state?.file) {
      this.loadFile(state.file);
    }
  }

  public getViewType(): string {
    return 'markdown';
  }

  public getDisplayText(): string {
    return this.file ? this.file.basename : 'Untitled';
  }

  public async loadFile(filePath: string): Promise<void> {
    this.file = this.leaf.workspace.vault.getFileByPath(filePath);
    if (this.file) {
      const content = await this.leaf.workspace.vault.read(this.file);
      this.editor.setValue(content);
    }
  }

  public getState(): any {
    return {
      type: 'markdown',
      state: {
        file: this.file?.path,
        mode: this.mode,
        cursor: this.editor.getCursor()
      }
    };
  }

  public setState(state: any): void {
    if (state.file) {
      this.loadFile(state.file);
    }
    if (state.mode) {
      this.mode = state.mode;
    }
    if (state.cursor) {
      this.editor.setCursor(state.cursor);
    }
  }

  public getMode(): string {
    return this.mode;
  }

  public setMode(mode: 'preview' | 'source'): void {
    this.mode = mode;
    this.emit('mode-changed', mode);
  }
}

/**
 * Mock empty view
 */
export class MockEmptyView extends EventEmitter {
  public leaf: MockWorkspaceLeaf;

  constructor(leaf: MockWorkspaceLeaf, state?: any) {
    super();
    this.leaf = leaf;
  }

  public getViewType(): string {
    return 'empty';
  }

  public getDisplayText(): string {
    return 'New tab';
  }

  public getState(): any {
    return { type: 'empty' };
  }

  public setState(state: any): void {
    // Empty view has no state
  }
}

/**
 * Mock generic view for other view types
 */
export class MockGenericView extends EventEmitter {
  public leaf: MockWorkspaceLeaf;
  public viewType: string;
  public state: any;

  constructor(leaf: MockWorkspaceLeaf, viewType: string, state?: any) {
    super();
    this.leaf = leaf;
    this.viewType = viewType;
    this.state = state || {};
  }

  public getViewType(): string {
    return this.viewType;
  }

  public getDisplayText(): string {
    return this.viewType;
  }

  public getState(): any {
    return { type: this.viewType, state: this.state };
  }

  public setState(state: any): void {
    this.state = { ...this.state, ...state };
  }
}

/**
 * Configuration options for MockWorkspace
 */
export interface MockWorkspaceConfig {
  vault: MockVault;
  mobile?: boolean;
  layout?: 'default' | 'mobile';
}

/**
 * Mock implementation of Obsidian's Workspace
 */
export class MockWorkspace extends EventEmitter {
  public app: any;
  public vault: MockVault;
  public containerEl: HTMLElement;
  public leftSplit: any;
  public rightSplit: any;
  public rootSplit: any;

  private leaves: MockWorkspaceLeaf[] = [];
  private activeLeaf: MockWorkspaceLeaf | null = null;
  private config: MockWorkspaceConfig;
  private layoutReady: boolean = false;
  private isMobile: boolean = false;

  constructor(config: MockWorkspaceConfig) {
    super();
    this.config = config;
    this.vault = config.vault;
    this.isMobile = config.mobile || false;

    // Create container element
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'workspace';

    // Create split containers
    this.leftSplit = this.createSplit('left');
    this.rightSplit = this.createSplit('right');
    this.rootSplit = this.createSplit('root');

    // Create initial leaf
    this.createInitialLeaf();
  }

  /**
   * Get the active leaf
   */
  public getActiveViewOfType(type: string): any {
    return this.activeLeaf?.view && this.activeLeaf.view.getViewType() === type
      ? this.activeLeaf.view
      : null;
  }

  /**
   * Get all leaves
   */
  public getLeavesOfType(type: string): MockWorkspaceLeaf[] {
    return this.leaves.filter(leaf => leaf.getViewType() === type);
  }

  /**
   * Get the active leaf
   */
  public getActiveLeaf(): MockWorkspaceLeaf | null {
    return this.activeLeaf;
  }

  /**
   * Set the active leaf
   */
  public setActiveLeaf(leaf: MockWorkspaceLeaf): void {
    if (this.activeLeaf) {
      this.activeLeaf.setActive(false);
    }
    this.activeLeaf = leaf;
    leaf.setActive(true);
    this.emit('active-leaf-change', leaf);
  }

  /**
   * Create a new leaf
   */
  public createLeafBySplit(leaf?: MockWorkspaceLeaf, direction?: 'horizontal' | 'vertical'): MockWorkspaceLeaf {
    const newLeaf = new MockWorkspaceLeaf(this);
    this.leaves.push(newLeaf);

    if (!this.activeLeaf) {
      this.setActiveLeaf(newLeaf);
    }

    this.emit('leaf-created', newLeaf);
    return newLeaf;
  }

  /**
   * Create a new leaf in the main area
   */
  public getLeaf(newLeaf?: boolean): MockWorkspaceLeaf {
    if (newLeaf || !this.activeLeaf) {
      return this.createLeafBySplit();
    }
    return this.activeLeaf;
  }

  /**
   * Create a new leaf with specific state
   */
  public createLeafWithState(state: any, location?: 'tab' | 'split' | 'window'): MockWorkspaceLeaf {
    const leaf = this.createLeafBySplit();
    leaf.setViewState(state);
    return leaf;
  }

  /**
   * Open a file in the workspace
   */
  public async openLinkText(
    linkText: string,
    sourcePath?: string,
    newLeaf?: boolean,
    openViewState?: any
  ): Promise<void> {
    const file = this.vault.getFileByPath(linkText);
    if (file) {
      const leaf = this.getLeaf(newLeaf);
      await leaf.openFile(file, openViewState);
    }
  }

  /**
   * Get the most recent leaf
   */
  public getMostRecentLeaf(): MockWorkspaceLeaf | null {
    return this.activeLeaf || (this.leaves.length > 0 ? this.leaves[0] : null);
  }

  /**
   * Remove a leaf
   */
  public removeLeaf(leaf: MockWorkspaceLeaf): void {
    const index = this.leaves.indexOf(leaf);
    if (index !== -1) {
      this.leaves.splice(index, 1);

      if (this.activeLeaf === leaf) {
        this.activeLeaf = this.leaves.length > 0 ? this.leaves[0] : null;
        if (this.activeLeaf) {
          this.activeLeaf.setActive(true);
        }
      }

      this.emit('leaf-removed', leaf);
    }
  }

  /**
   * Clear all leaves
   */
  public clearLeaves(): void {
    const leavesToRemove = [...this.leaves];
    leavesToRemove.forEach(leaf => this.removeLeaf(leaf));
  }

  /**
   * Trigger layout ready
   */
  public triggerLayoutReady(): void {
    if (!this.layoutReady) {
      this.layoutReady = true;
      this.emit('layout-ready');
    }
  }

  /**
   * Check if layout is ready
   */
  public isLayoutReady(): boolean {
    return this.layoutReady;
  }

  /**
   * Iterate over all leaves
   */
  public iterateAllLeaves(callback: (leaf: MockWorkspaceLeaf) => boolean | void): void {
    for (const leaf of this.leaves) {
      const result = callback(leaf);
      if (result === false) {
        break;
      }
    }
  }

  /**
   * Iterate over root leaves
   */
  public iterateRootLeaves(callback: (leaf: MockWorkspaceLeaf) => boolean | void): void {
    this.iterateAllLeaves(callback);
  }

  /**
   * Set mobile mode
   */
  public setMobileMode(mobile: boolean, platform?: 'ios' | 'android'): void {
    this.isMobile = mobile;
    this.containerEl.classList.toggle('is-mobile', mobile);
    if (platform) {
      this.containerEl.classList.toggle(`is-${platform}`, mobile);
    }
    this.emit('mobile-mode-changed', mobile, platform);
  }

  /**
   * Check if in mobile mode
   */
  public isMobileMode(): boolean {
    return this.isMobile;
  }

  /**
   * Change the layout
   */
  public changeLayout(layout?: any): Promise<void> {
    this.emit('layout-change', layout);
    return Promise.resolve();
  }

  /**
   * Get layout configuration
   */
  public getLayout(): any {
    return {
      main: {
        id: 'main',
        type: 'tabs',
        children: this.leaves.map(leaf => ({
          id: leaf.id,
          type: 'leaf',
          state: leaf.getViewState()
        }))
      }
    };
  }

  /**
   * Request save of layout
   */
  public requestSaveLayout(): void {
    this.emit('layout-save-requested');
  }

  /**
   * Focus on a specific leaf
   */
  public focusLeaf(leaf: MockWorkspaceLeaf): void {
    this.setActiveLeaf(leaf);
    leaf.emit('focus');
  }

  /**
   * Create snapshot of workspace state
   */
  public getSnapshot(): any {
    return {
      leaves: this.leaves.map(leaf => ({
        id: leaf.id,
        viewState: leaf.getViewState(),
        isActive: leaf === this.activeLeaf,
        isPinned: leaf.getPinned()
      })),
      layout: this.getLayout(),
      isMobile: this.isMobile,
      layoutReady: this.layoutReady,
      timestamp: Date.now()
    };
  }

  /**
   * Restore workspace from snapshot
   */
  public async restoreFromSnapshot(snapshot: any): Promise<void> {
    // Clear current leaves
    this.clearLeaves();

    // Restore leaves
    for (const leafData of snapshot.leaves) {
      const leaf = new MockWorkspaceLeaf(this, leafData.id);
      if (leafData.viewState) {
        await leaf.setViewState(leafData.viewState);
      }
      leaf.setPinned(leafData.isPinned);
      this.leaves.push(leaf);

      if (leafData.isActive) {
        this.setActiveLeaf(leaf);
      }
    }

    this.isMobile = snapshot.isMobile;
    this.layoutReady = snapshot.layoutReady;

    this.emit('snapshot-restored', snapshot);
  }

  /**
   * Create a split container
   */
  private createSplit(type: string): any {
    return {
      type,
      children: [],
      collapsed: false,
      width: type === 'left' || type === 'right' ? 200 : undefined
    };
  }

  /**
   * Create the initial leaf
   */
  private createInitialLeaf(): void {
    const leaf = new MockWorkspaceLeaf(this);
    this.leaves.push(leaf);
    this.setActiveLeaf(leaf);
  }
}