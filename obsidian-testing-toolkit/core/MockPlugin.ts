/**
 * Obsidian Testing Toolkit - Mock Plugin Implementation
 *
 * Mock implementation of Obsidian's Plugin class for testing plugin lifecycle,
 * settings, commands, and event handling.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { MockApp } from './MockApp';

/**
 * Plugin manifest interface
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description?: string;
  author?: string;
  authorUrl?: string;
  fundingUrl?: string;
  isDesktopOnly?: boolean;
}

/**
 * Configuration options for MockPlugin
 */
export interface MockPluginConfig {
  app: MockApp;
  manifest: PluginManifest;
  settings?: any;
  pluginDir?: string;
}

/**
 * Mock implementation of Obsidian's Plugin class
 */
export class MockPlugin extends EventEmitter {
  public app: MockApp;
  public manifest: PluginManifest;
  public settings: any;
  public pluginDir: string;

  private isLoaded: boolean = false;
  private isEnabled: boolean = false;
  private commands: Map<string, any> = new Map();
  private statusBarItems: any[] = [];
  private ribbonIcons: any[] = [];
  private settingTabs: any[] = [];
  private intervals: Set<number> = new Set();
  private eventListeners: Map<string, Function[]> = new Map();

  constructor(config: MockPluginConfig) {
    super();
    this.app = config.app;
    this.manifest = config.manifest;
    this.settings = config.settings || {};
    this.pluginDir = config.pluginDir || `/plugins/${config.manifest.id}`;
  }

  /**
   * Plugin lifecycle: Load
   */
  public async onload(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    this.isLoaded = true;
    this.isEnabled = true;

    // Load saved settings
    await this.loadSettings();

    this.emit('load');
  }

  /**
   * Plugin lifecycle: Unload
   */
  public async onunload(): Promise<void> {
    if (!this.isLoaded) {
      return;
    }

    // Clear all intervals
    this.intervals.forEach(id => clearInterval(id));
    this.intervals.clear();

    // Remove all commands
    this.commands.forEach((_, id) => {
      this.app.commands.removeCommand(id);
    });
    this.commands.clear();

    // Remove status bar items
    this.statusBarItems.forEach(item => item.remove?.());
    this.statusBarItems.length = 0;

    // Remove ribbon icons
    this.ribbonIcons.forEach(icon => icon.remove?.());
    this.ribbonIcons.length = 0;

    // Remove setting tabs
    this.settingTabs.forEach(tab => tab.remove?.());
    this.settingTabs.length = 0;

    // Remove event listeners
    this.eventListeners.clear();

    this.isLoaded = false;
    this.isEnabled = false;

    this.emit('unload');
  }

  /**
   * Add a command to the plugin
   */
  public addCommand(command: {
    id: string;
    name: string;
    callback?: () => void;
    checkCallback?: (checking: boolean) => boolean;
    hotkeys?: any[];
    icon?: string;
    mobileOnly?: boolean;
  }): void {
    const fullId = `${this.manifest.id}:${command.id}`;
    const commandWithId = { ...command, id: fullId };

    this.commands.set(fullId, commandWithId);
    this.app.commands.addCommand(commandWithId);

    this.emit('command-added', commandWithId);
  }

  /**
   * Remove a command from the plugin
   */
  public removeCommand(id: string): void {
    const fullId = `${this.manifest.id}:${id}`;
    this.commands.delete(fullId);
    this.app.commands.removeCommand(fullId);

    this.emit('command-removed', fullId);
  }

  /**
   * Add a status bar item
   */
  public addStatusBarItem(): any {
    const item = {
      setText: (text: string) => { item.text = text; },
      setTooltip: (tooltip: string) => { item.tooltip = tooltip; },
      addClass: (className: string) => { item.classes = item.classes || []; item.classes.push(className); },
      removeClass: (className: string) => {
        item.classes = item.classes?.filter((c: string) => c !== className) || [];
      },
      remove: () => {
        const index = this.statusBarItems.indexOf(item);
        if (index !== -1) {
          this.statusBarItems.splice(index, 1);
        }
      },
      text: '',
      tooltip: '',
      classes: [] as string[]
    };

    this.statusBarItems.push(item);
    this.emit('status-bar-item-added', item);

    return item;
  }

  /**
   * Add a ribbon icon
   */
  public addRibbonIcon(icon: string, title: string, callback: () => void): any {
    const ribbonIcon = {
      icon,
      title,
      callback,
      addClass: (className: string) => { ribbonIcon.classes = ribbonIcon.classes || []; ribbonIcon.classes.push(className); },
      removeClass: (className: string) => {
        ribbonIcon.classes = ribbonIcon.classes?.filter(c => c !== className) || [];
      },
      remove: () => {
        const index = this.ribbonIcons.indexOf(ribbonIcon);
        if (index !== -1) {
          this.ribbonIcons.splice(index, 1);
        }
      },
      classes: [] as string[]
    };

    this.ribbonIcons.push(ribbonIcon);
    this.emit('ribbon-icon-added', ribbonIcon);

    return ribbonIcon;
  }

  /**
   * Add a settings tab
   */
  public addSettingTab(settingTab: any): void {
    this.settingTabs.push(settingTab);
    this.emit('setting-tab-added', settingTab);
  }

  /**
   * Register an interval
   */
  public registerInterval(id: number): number {
    this.intervals.add(id);
    return id;
  }

  /**
   * Register an event listener
   */
  public registerEvent(eventRef: any): void {
    // Mock event registration
    this.emit('event-registered', eventRef);
  }

  /**
   * Register a DOM event listener
   */
  public registerDomEvent(
    element: Element,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions
  ): void {
    element.addEventListener(type, listener, options);

    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);

    this.emit('dom-event-registered', { element, type, listener, options });
  }

  /**
   * Load plugin settings
   */
  public async loadSettings(): Promise<void> {
    // In a real environment, this would load from disk
    // For testing, we'll use the provided settings or defaults
    this.settings = { ...this.getDefaultSettings(), ...this.settings };
    this.emit('settings-loaded', this.settings);
  }

  /**
   * Save plugin settings
   */
  public async saveSettings(): Promise<void> {
    // In a real environment, this would save to disk
    // For testing, we'll just emit an event
    this.emit('settings-saved', this.settings);
  }

  /**
   * Get default settings (to be overridden by actual plugins)
   */
  protected getDefaultSettings(): any {
    return {};
  }

  /**
   * Update plugin settings
   */
  public updateSettings(newSettings: Partial<any>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.emit('settings-updated', this.settings);
  }

  /**
   * Get a specific setting value
   */
  public getSetting(key: string, defaultValue?: any): any {
    return this.settings[key] ?? defaultValue;
  }

  /**
   * Set a specific setting value
   */
  public setSetting(key: string, value: any): void {
    this.settings[key] = value;
    this.emit('setting-changed', key, value);
  }

  /**
   * Check if plugin is loaded
   */
  public isPluginLoaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Check if plugin is enabled
   */
  public isPluginEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Get all commands registered by this plugin
   */
  public getCommands(): any[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get all status bar items
   */
  public getStatusBarItems(): any[] {
    return [...this.statusBarItems];
  }

  /**
   * Get all ribbon icons
   */
  public getRibbonIcons(): any[] {
    return [...this.ribbonIcons];
  }

  /**
   * Get all setting tabs
   */
  public getSettingTabs(): any[] {
    return [...this.settingTabs];
  }

  /**
   * Simulate plugin error
   */
  public simulateError(error: Error): void {
    this.emit('error', error);
  }

  /**
   * Simulate plugin update
   */
  public async simulateUpdate(newVersion: string): Promise<void> {
    const oldVersion = this.manifest.version;
    this.manifest.version = newVersion;
    this.emit('update', oldVersion, newVersion);
  }

  /**
   * Get plugin data directory path
   */
  public getDataDir(): string {
    return `${this.pluginDir}/data`;
  }

  /**
   * Get plugin resource path
   */
  public getResourcePath(path: string): string {
    return `${this.pluginDir}/${path}`;
  }

  /**
   * Create snapshot of plugin state
   */
  public getSnapshot(): any {
    return {
      manifest: { ...this.manifest },
      settings: { ...this.settings },
      isLoaded: this.isLoaded,
      isEnabled: this.isEnabled,
      commands: Array.from(this.commands.entries()),
      statusBarItems: this.statusBarItems.length,
      ribbonIcons: this.ribbonIcons.length,
      settingTabs: this.settingTabs.length,
      intervals: this.intervals.size,
      eventListeners: Array.from(this.eventListeners.entries()).map(([type, listeners]) => ({
        type,
        count: listeners.length
      })),
      timestamp: Date.now()
    };
  }

  /**
   * Restore plugin from snapshot
   */
  public async restoreFromSnapshot(snapshot: any): Promise<void> {
    this.manifest = { ...snapshot.manifest };
    this.settings = { ...snapshot.settings };
    this.isLoaded = snapshot.isLoaded;
    this.isEnabled = snapshot.isEnabled;

    // Note: Commands, status bar items, etc. would need to be recreated
    // by the plugin itself after restoration

    this.emit('snapshot-restored', snapshot);
  }
}

/**
 * Base class for plugin settings tabs
 */
export class MockPluginSettingTab extends EventEmitter {
  public app: MockApp;
  public plugin: MockPlugin;
  public containerEl: HTMLElement;

  constructor(app: MockApp, plugin: MockPlugin) {
    super();
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'mock-setting-tab';
  }

  /**
   * Display the settings tab (to be overridden)
   */
  public display(): void {
    this.containerEl.innerHTML = '';
    this.emit('display');
  }

  /**
   * Hide the settings tab
   */
  public hide(): void {
    this.containerEl.style.display = 'none';
    this.emit('hide');
  }

  /**
   * Show the settings tab
   */
  public show(): void {
    this.containerEl.style.display = 'block';
    this.emit('show');
  }

  /**
   * Remove the settings tab
   */
  public remove(): void {
    if (this.containerEl.parentNode) {
      this.containerEl.parentNode.removeChild(this.containerEl);
    }
    this.emit('remove');
  }

  /**
   * Add a setting control
   */
  public addSetting(): any {
    const setting = {
      setName: (name: string) => { setting.name = name; return setting; },
      setDesc: (desc: string) => { setting.description = desc; return setting; },
      addText: (cb: (text: any) => void) => {
        const textInput = { setValue: (value: string) => { textInput.value = value; }, value: '' };
        cb(textInput);
        setting.controls.push({ type: 'text', input: textInput });
        return setting;
      },
      addToggle: (cb: (toggle: any) => void) => {
        const toggle = { setValue: (value: boolean) => { toggle.value = value; }, value: false };
        cb(toggle);
        setting.controls.push({ type: 'toggle', input: toggle });
        return setting;
      },
      addDropdown: (cb: (dropdown: any) => void) => {
        const dropdown = {
          addOption: (value: string, text: string) => { dropdown.options.push({ value, text }); },
          setValue: (value: string) => { dropdown.value = value; },
          value: '',
          options: [] as any[]
        };
        cb(dropdown);
        setting.controls.push({ type: 'dropdown', input: dropdown });
        return setting;
      },
      name: '',
      description: '',
      controls: [] as any[]
    };

    this.emit('setting-added', setting);
    return setting;
  }
}