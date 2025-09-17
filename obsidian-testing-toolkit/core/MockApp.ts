/**
 * Obsidian Testing Toolkit - Mock App Implementation
 *
 * Complete implementation of Obsidian's App interface for testing purposes.
 * Provides access to all major Obsidian APIs and services.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { MockVault } from './MockVault';
import { MockWorkspace } from './MockWorkspace';
import { MockMetadataCache } from './MockMetadataCache';

/**
 * Configuration options for MockApp
 */
export interface MockAppConfig {
  vault: MockVault;
  workspace: MockWorkspace;
  metadataCache: MockMetadataCache;
  isMobile?: boolean;
  plugins?: string[];
  theme?: 'light' | 'dark';
}

/**
 * Mock implementation of Obsidian's Commands
 */
export class MockCommands extends EventEmitter {
  private commands: Map<string, any> = new Map();

  public addCommand(command: {
    id: string;
    name: string;
    callback?: () => void;
    checkCallback?: (checking: boolean) => boolean;
    hotkeys?: any[];
  }): void {
    this.commands.set(command.id, command);
    this.emit('command-added', command);
  }

  public removeCommand(id: string): void {
    this.commands.delete(id);
    this.emit('command-removed', id);
  }

  public executeCommandById(id: string): boolean {
    const command = this.commands.get(id);
    if (command) {
      if (command.callback) {
        command.callback();
      }
      this.emit('command-executed', id);
      return true;
    }
    return false;
  }

  public listCommands(): any[] {
    return Array.from(this.commands.values());
  }
}

/**
 * Mock implementation of Obsidian's Settings
 */
export class MockSettings extends EventEmitter {
  private settings: Map<string, any> = new Map();

  public openTab(id: string): void {
    this.emit('tab-opened', id);
  }

  public openTabById(id: string): void {
    this.emit('tab-opened', id);
  }

  public close(): void {
    this.emit('settings-closed');
  }

  public getSetting(key: string): any {
    return this.settings.get(key);
  }

  public setSetting(key: string, value: any): void {
    this.settings.set(key, value);
    this.emit('setting-changed', key, value);
  }
}

/**
 * Mock implementation of Obsidian's KeymapManager
 */
export class MockKeymap extends EventEmitter {
  private hotkeys: Map<string, any[]> = new Map();

  public getHotkeys(id: string): any[] {
    return this.hotkeys.get(id) || [];
  }

  public setHotkeys(id: string, hotkeys: any[]): void {
    this.hotkeys.set(id, hotkeys);
    this.emit('hotkeys-changed', id, hotkeys);
  }

  public getDefaultHotkeys(id: string): any[] {
    return [];
  }

  public pushScope(scope: any): void {
    this.emit('scope-pushed', scope);
  }

  public popScope(scope: any): void {
    this.emit('scope-popped', scope);
  }
}

/**
 * Mock implementation of Obsidian's PluginManager
 */
export class MockPlugins extends EventEmitter {
  private plugins: Map<string, any> = new Map();
  private manifests: Map<string, any> = new Map();

  public getPlugin(id: string): any {
    return this.plugins.get(id);
  }

  public getPlugins(): Record<string, any> {
    return Object.fromEntries(this.plugins);
  }

  public enablePlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (plugin) {
      plugin.enabled = true;
      this.emit('plugin-enabled', id);
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  public disablePlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (plugin) {
      plugin.enabled = false;
      this.emit('plugin-disabled', id);
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  public installPlugin(id: string, manifest: any): void {
    this.manifests.set(id, manifest);
    this.plugins.set(id, { id, manifest, enabled: false });
    this.emit('plugin-installed', id);
  }

  public uninstallPlugin(id: string): void {
    this.plugins.delete(id);
    this.manifests.delete(id);
    this.emit('plugin-uninstalled', id);
  }

  public getManifests(): Record<string, any> {
    return Object.fromEntries(this.manifests);
  }
}

/**
 * Mock implementation of requestUrl function
 */
export class MockRequestUrl {
  private mocks: Map<string, any> = new Map();

  public addMock(url: string | RegExp, response: any): void {
    const key = url instanceof RegExp ? url.source : url;
    this.mocks.set(key, response);
  }

  public removeMock(url: string | RegExp): void {
    const key = url instanceof RegExp ? url.source : url;
    this.mocks.delete(key);
  }

  public clearMocks(): void {
    this.mocks.clear();
  }

  public async request(url: string, options?: any): Promise<any> {
    // Check for direct URL match
    if (this.mocks.has(url)) {
      return this.mocks.get(url);
    }

    // Check for regex matches
    for (const [pattern, response] of this.mocks) {
      try {
        const regex = new RegExp(pattern);
        if (regex.test(url)) {
          return response;
        }
      } catch (e) {
        // Not a valid regex, skip
      }
    }

    // Default response for unmocked requests
    throw new Error(`Unmocked request: ${url}`);
  }
}

/**
 * Mock implementation of Obsidian's App
 */
export class MockApp extends EventEmitter {
  public vault: MockVault;
  public workspace: MockWorkspace;
  public metadataCache: MockMetadataCache;
  public commands: MockCommands;
  public setting: MockSettings;
  public keymap: MockKeymap;
  public plugins: MockPlugins;
  public isMobile: boolean;
  public lastEvent: any = null;

  private requestUrlMock: MockRequestUrl;
  private config: MockAppConfig;
  private loadedPlugins: Set<string> = new Set();

  constructor(config: MockAppConfig) {
    super();
    this.config = config;
    this.vault = config.vault;
    this.workspace = config.workspace;
    this.metadataCache = config.metadataCache;
    this.isMobile = config.isMobile || false;

    // Initialize subsystems
    this.commands = new MockCommands();
    this.setting = new MockSettings();
    this.keymap = new MockKeymap();
    this.plugins = new MockPlugins();
    this.requestUrlMock = new MockRequestUrl();

    // Set up cross-references
    this.workspace.app = this;
    this.metadataCache.app = this;

    // Load default plugins if specified
    if (config.plugins) {
      config.plugins.forEach(pluginId => this.loadPlugin(pluginId));
    }
  }

  /**
   * Load a plugin for testing
   */
  public loadPlugin(id: string, manifest?: any): void {
    if (!manifest) {
      manifest = {
        id,
        name: `Mock Plugin ${id}`,
        version: '1.0.0',
        minAppVersion: '0.15.0',
        author: 'Test Author'
      };
    }

    this.plugins.installPlugin(id, manifest);
    this.plugins.enablePlugin(id);
    this.loadedPlugins.add(id);
    this.emit('plugin-loaded', id);
  }

  /**
   * Unload a plugin
   */
  public unloadPlugin(id: string): void {
    this.plugins.disablePlugin(id);
    this.plugins.uninstallPlugin(id);
    this.loadedPlugins.delete(id);
    this.emit('plugin-unloaded', id);
  }

  /**
   * Check if plugin is loaded
   */
  public isPluginLoaded(id: string): boolean {
    return this.loadedPlugins.has(id);
  }

  /**
   * Get loaded plugin IDs
   */
  public getLoadedPlugins(): string[] {
    return Array.from(this.loadedPlugins);
  }

  /**
   * Mock requestUrl function
   */
  public async requestUrl(url: string, options?: any): Promise<any> {
    return await this.requestUrlMock.request(url, options);
  }

  /**
   * Add mock for requestUrl
   */
  public addRequestMock(url: string | RegExp, response: any): void {
    this.requestUrlMock.addMock(url, response);
  }

  /**
   * Remove mock for requestUrl
   */
  public removeRequestMock(url: string | RegExp): void {
    this.requestUrlMock.removeMock(url);
  }

  /**
   * Clear all requestUrl mocks
   */
  public clearRequestMocks(): void {
    this.requestUrlMock.clearMocks();
  }

  /**
   * Trigger an event (for testing event handling)
   */
  public triggerEvent(eventName: string, ...args: any[]): void {
    this.lastEvent = { eventName, args, timestamp: Date.now() };
    this.emit(eventName, ...args);
  }

  /**
   * Get the last triggered event
   */
  public getLastEvent(): any {
    return this.lastEvent;
  }

  /**
   * Toggle mobile mode
   */
  public setMobileMode(mobile: boolean): void {
    this.isMobile = mobile;
    this.workspace.setMobileMode(mobile);
    this.emit('mobile-mode-changed', mobile);
  }

  /**
   * Simulate app startup
   */
  public async startup(): Promise<void> {
    this.emit('layout-ready');
    this.emit('workspace-layout-ready');
    this.emit('app-loaded');
  }

  /**
   * Simulate app shutdown
   */
  public async shutdown(): Promise<void> {
    // Disable all plugins
    for (const pluginId of this.loadedPlugins) {
      await this.plugins.disablePlugin(pluginId);
    }

    this.emit('app-shutdown');
  }

  /**
   * Get app version
   */
  public getVersion(): string {
    return '1.0.0-test';
  }

  /**
   * Check if app is in development mode
   */
  public internalPlugins: {
    getEnabledPlugins(): string[];
    getPluginById(id: string): any;
    isEnabled(id: string): boolean;
  } = {
    getEnabledPlugins: () => ['file-explorer', 'search', 'quick-switcher'],
    getPluginById: (id: string) => ({ id, enabled: true }),
    isEnabled: (id: string) => ['file-explorer', 'search', 'quick-switcher'].includes(id)
  };

  /**
   * Mock file manager
   */
  public fileManager: {
    generateMarkdownLink(file: any, sourcePath: string): string;
    getNewFileParent(sourcePath: string): any;
    promptForFileName(name: string): Promise<string>;
  } = {
    generateMarkdownLink: (file, sourcePath) => `[[${file.basename}]]`,
    getNewFileParent: (sourcePath) => this.vault.getFolderByPath(''),
    promptForFileName: async (name) => name
  };

  /**
   * Get configuration
   */
  public getConfig(key: string): any {
    return this.vault.getConfig(key);
  }

  /**
   * Set configuration
   */
  public setConfig(key: string, value: any): void {
    this.vault.setConfig(key, value);
    this.emit('config-changed', key, value);
  }

  /**
   * Create snapshot of app state
   */
  public getSnapshot(): any {
    return {
      vault: this.vault.getSnapshot(),
      workspace: this.workspace.getSnapshot(),
      metadataCache: this.metadataCache.getSnapshot(),
      loadedPlugins: Array.from(this.loadedPlugins),
      isMobile: this.isMobile,
      timestamp: Date.now()
    };
  }

  /**
   * Restore app from snapshot
   */
  public async restoreFromSnapshot(snapshot: any): Promise<void> {
    await this.vault.restoreFromSnapshot(snapshot.vault);
    await this.workspace.restoreFromSnapshot(snapshot.workspace);
    await this.metadataCache.restoreFromSnapshot(snapshot.metadataCache);

    this.loadedPlugins.clear();
    snapshot.loadedPlugins.forEach((id: string) => this.loadedPlugins.add(id));
    this.isMobile = snapshot.isMobile;

    this.emit('snapshot-restored', snapshot);
  }
}