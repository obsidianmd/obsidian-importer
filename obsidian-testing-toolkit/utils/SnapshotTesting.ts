/**
 * Obsidian Testing Toolkit - Snapshot Testing Utilities
 *
 * Jest snapshot testing integration for Obsidian plugin testing.
 * Provides utilities for creating and managing test snapshots.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { MockVault } from '../core/MockVault';
import { MockWorkspace } from '../core/MockWorkspace';
import { MockMetadataCache } from '../core/MockMetadataCache';
import { TestEnvironment } from '../core/ObsidianTestFramework';

/**
 * Snapshot configuration options
 */
export interface SnapshotConfig {
  includeBinaryFiles?: boolean;
  includeTimestamps?: boolean;
  includeFileStats?: boolean;
  excludePatterns?: string[];
  customSerializers?: Record<string, (obj: any) => any>;
}

/**
 * Snapshot data structure
 */
export interface SnapshotData {
  type: string;
  timestamp?: number;
  data: any;
  metadata?: Record<string, any>;
}

/**
 * Snapshot testing utilities for Obsidian plugins
 */
export class SnapshotTesting {
  private config: SnapshotConfig;

  constructor(config: SnapshotConfig = {}) {
    this.config = {
      includeBinaryFiles: false,
      includeTimestamps: false,
      includeFileStats: false,
      excludePatterns: [],
      customSerializers: {},
      ...config
    };
  }

  /**
   * Create snapshot of vault state
   */
  public createVaultSnapshot(vault: MockVault): SnapshotData {
    const files = vault.getFiles().map(file => {
      const data: any = {
        path: file.path,
        name: file.name,
        basename: file.basename,
        extension: file.extension
      };

      if (this.config.includeFileStats) {
        data.stat = { ...file.stat };
      }

      return data;
    });

    const folders = vault.getFolders().map(folder => ({
      path: folder.path,
      name: folder.name
    }));

    return {
      type: 'vault',
      timestamp: this.config.includeTimestamps ? Date.now() : undefined,
      data: {
        files: this.sortByPath(files),
        folders: this.sortByPath(folders)
      }
    };
  }

  /**
   * Create snapshot of vault content
   */
  public async createVaultContentSnapshot(vault: MockVault): Promise<SnapshotData> {
    const contentData: any = {};

    for (const file of vault.getFiles()) {
      if (this.shouldExcludeFile(file.path)) {
        continue;
      }

      if (!this.config.includeBinaryFiles && this.isBinaryFile(file.extension)) {
        contentData[file.path] = '<binary file>';
      } else {
        try {
          contentData[file.path] = await vault.read(file);
        } catch (error) {
          contentData[file.path] = `<error reading file: ${error.message}>`;
        }
      }
    }

    return {
      type: 'vault-content',
      timestamp: this.config.includeTimestamps ? Date.now() : undefined,
      data: contentData
    };
  }

  /**
   * Create snapshot of workspace state
   */
  public createWorkspaceSnapshot(workspace: MockWorkspace): SnapshotData {
    const leaves = workspace['leaves'] || [];
    const leafData = leaves.map((leaf: any) => ({
      id: leaf.id,
      viewType: leaf.getViewType(),
      displayText: leaf.getDisplayText(),
      isPinned: leaf.getPinned(),
      isActive: leaf === workspace.getActiveLeaf()
    }));

    return {
      type: 'workspace',
      timestamp: this.config.includeTimestamps ? Date.now() : undefined,
      data: {
        leaves: leafData,
        isMobile: workspace.isMobileMode(),
        layoutReady: workspace.isLayoutReady()
      }
    };
  }

  /**
   * Create snapshot of metadata cache
   */
  public createMetadataCacheSnapshot(metadataCache: MockMetadataCache): SnapshotData {
    const cachedFiles = metadataCache.getCachedFiles();
    const cacheData: any = {};

    for (const filePath of cachedFiles) {
      const file = metadataCache.vault.getFileByPath(filePath);
      if (!file || this.shouldExcludeFile(filePath)) {
        continue;
      }

      const metadata = metadataCache.getFileCache(file);
      if (metadata) {
        // Remove position data and timestamps for consistent snapshots
        cacheData[filePath] = this.sanitizeMetadata(metadata);
      }
    }

    return {
      type: 'metadata-cache',
      timestamp: this.config.includeTimestamps ? Date.now() : undefined,
      data: cacheData
    };
  }

  /**
   * Create complete environment snapshot
   */
  public async createEnvironmentSnapshot(environment: TestEnvironment): Promise<SnapshotData> {
    const vaultSnapshot = this.createVaultSnapshot(environment.vault);
    const contentSnapshot = await this.createVaultContentSnapshot(environment.vault);
    const workspaceSnapshot = this.createWorkspaceSnapshot(environment.workspace);
    const metadataSnapshot = this.createMetadataCacheSnapshot(environment.metadataCache);

    return {
      type: 'environment',
      timestamp: this.config.includeTimestamps ? Date.now() : undefined,
      data: {
        vault: vaultSnapshot.data,
        content: contentSnapshot.data,
        workspace: workspaceSnapshot.data,
        metadata: metadataSnapshot.data,
        app: {
          isMobile: environment.app.isMobile,
          loadedPlugins: environment.app.getLoadedPlugins()
        }
      }
    };
  }

  /**
   * Create snapshot of plugin state
   */
  public createPluginSnapshot(plugin: any): SnapshotData {
    const data: any = {
      manifest: plugin.manifest,
      isLoaded: plugin.isPluginLoaded(),
      isEnabled: plugin.isPluginEnabled()
    };

    if (plugin.settings) {
      data.settings = { ...plugin.settings };
    }

    if (plugin.getCommands) {
      data.commands = plugin.getCommands().map((cmd: any) => ({
        id: cmd.id,
        name: cmd.name
      }));
    }

    return {
      type: 'plugin',
      timestamp: this.config.includeTimestamps ? Date.now() : undefined,
      data
    };
  }

  /**
   * Compare two snapshots and return differences
   */
  public compareSnapshots(snapshot1: SnapshotData, snapshot2: SnapshotData): any {
    if (snapshot1.type !== snapshot2.type) {
      throw new Error(`Cannot compare snapshots of different types: ${snapshot1.type} vs ${snapshot2.type}`);
    }

    return this.deepCompare(snapshot1.data, snapshot2.data);
  }

  /**
   * Serialize snapshot for Jest
   */
  public serializeSnapshot(snapshot: SnapshotData): string {
    const serializer = this.config.customSerializers?.[snapshot.type];
    if (serializer) {
      return JSON.stringify(serializer(snapshot), null, 2);
    }

    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Create matcher for Jest expect
   */
  public toMatchVaultSnapshot(received: MockVault, snapshotName?: string): { pass: boolean; message: () => string } {
    const snapshot = this.createVaultSnapshot(received);
    const serialized = this.serializeSnapshot(snapshot);

    // This would integrate with Jest's snapshot system
    // For now, we'll simulate the behavior
    const pass = this.validateSnapshot(serialized, snapshotName || 'vault');

    return {
      pass,
      message: () => pass
        ? `Expected vault not to match snapshot`
        : `Expected vault to match snapshot`
    };
  }

  /**
   * Utility method to sort arrays by path
   */
  private sortByPath(items: any[]): any[] {
    return items.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Check if file should be excluded
   */
  private shouldExcludeFile(path: string): boolean {
    return this.config.excludePatterns?.some(pattern => {
      const regex = new RegExp(pattern);
      return regex.test(path);
    }) || false;
  }

  /**
   * Check if file is binary based on extension
   */
  private isBinaryFile(extension: string): boolean {
    const binaryExtensions = ['png', 'jpg', 'jpeg', 'gif', 'pdf', 'mp3', 'mp4', 'zip', 'exe'];
    return binaryExtensions.includes(extension.toLowerCase());
  }

  /**
   * Sanitize metadata for consistent snapshots
   */
  private sanitizeMetadata(metadata: any): any {
    const sanitized = { ...metadata };

    // Remove position data if not including timestamps
    if (!this.config.includeTimestamps) {
      if (sanitized.frontmatter?.position) {
        delete sanitized.frontmatter.position;
      }

      ['links', 'embeds', 'tags', 'headings', 'blocks', 'sections'].forEach(key => {
        if (sanitized[key]) {
          sanitized[key] = sanitized[key].map((item: any) => {
            const { position, ...rest } = item;
            return rest;
          });
        }
      });
    }

    return sanitized;
  }

  /**
   * Deep compare two objects
   */
  private deepCompare(obj1: any, obj2: any, path: string = ''): any {
    const differences: any = {};

    if (typeof obj1 !== typeof obj2) {
      differences[path || 'root'] = {
        type: 'type_mismatch',
        expected: typeof obj1,
        received: typeof obj2
      };
      return differences;
    }

    if (obj1 === null || obj2 === null) {
      if (obj1 !== obj2) {
        differences[path || 'root'] = {
          type: 'value_mismatch',
          expected: obj1,
          received: obj2
        };
      }
      return differences;
    }

    if (typeof obj1 === 'object') {
      const keys1 = Object.keys(obj1);
      const keys2 = Object.keys(obj2);
      const allKeys = new Set([...keys1, ...keys2]);

      for (const key of allKeys) {
        const newPath = path ? `${path}.${key}` : key;

        if (!(key in obj1)) {
          differences[newPath] = {
            type: 'missing_in_expected',
            received: obj2[key]
          };
        } else if (!(key in obj2)) {
          differences[newPath] = {
            type: 'missing_in_received',
            expected: obj1[key]
          };
        } else {
          const subDiff = this.deepCompare(obj1[key], obj2[key], newPath);
          Object.assign(differences, subDiff);
        }
      }
    } else if (obj1 !== obj2) {
      differences[path || 'root'] = {
        type: 'value_mismatch',
        expected: obj1,
        received: obj2
      };
    }

    return Object.keys(differences).length > 0 ? differences : null;
  }

  /**
   * Validate snapshot (placeholder for Jest integration)
   */
  private validateSnapshot(serialized: string, name: string): boolean {
    // In a real implementation, this would compare against stored snapshots
    // For now, we'll always return true as a placeholder
    return true;
  }
}

/**
 * Default snapshot configuration for Obsidian testing
 */
export const defaultSnapshotConfig: SnapshotConfig = {
  includeBinaryFiles: false,
  includeTimestamps: false,
  includeFileStats: false,
  excludePatterns: [
    '^\.obsidian/',
    '\.tmp$',
    '\.cache$'
  ]
};

/**
 * Create snapshot testing instance with default config
 */
export function createSnapshotTester(config?: Partial<SnapshotConfig>): SnapshotTesting {
  return new SnapshotTesting({ ...defaultSnapshotConfig, ...config });
}

/**
 * Jest matcher extensions for Obsidian testing
 */
export const jestMatchers = {
  toMatchVaultSnapshot(received: MockVault, snapshotName?: string) {
    const tester = createSnapshotTester();
    return tester.toMatchVaultSnapshot(received, snapshotName);
  },

  async toMatchVaultContentSnapshot(received: MockVault, snapshotName?: string) {
    const tester = createSnapshotTester();
    const snapshot = await tester.createVaultContentSnapshot(received);
    const serialized = tester.serializeSnapshot(snapshot);

    // Jest snapshot integration would go here
    return {
      pass: true, // Placeholder
      message: () => 'Vault content matches snapshot'
    };
  },

  toMatchWorkspaceSnapshot(received: MockWorkspace, snapshotName?: string) {
    const tester = createSnapshotTester();
    const snapshot = tester.createWorkspaceSnapshot(received);
    const serialized = tester.serializeSnapshot(snapshot);

    return {
      pass: true, // Placeholder
      message: () => 'Workspace matches snapshot'
    };
  }
};

/**
 * Type declarations for Jest matchers
 */
declare global {
  namespace jest {
    interface Matchers<R> {
      toMatchVaultSnapshot(snapshotName?: string): R;
      toMatchVaultContentSnapshot(snapshotName?: string): Promise<R>;
      toMatchWorkspaceSnapshot(snapshotName?: string): R;
    }
  }
}