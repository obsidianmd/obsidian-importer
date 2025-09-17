/**
 * Obsidian Testing Toolkit - Core Test Framework
 *
 * Main orchestrator for Obsidian plugin testing. Provides a unified interface
 * for setting up and tearing down test environments with full Obsidian API mocking.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { MockVault } from './MockVault';
import { MockApp } from './MockApp';
import { MockPlugin } from './MockPlugin';
import { MockWorkspace } from './MockWorkspace';
import { MockMetadataCache } from './MockMetadataCache';
import { TestDataManager } from '../utils/TestDataManager';
import { FileSystemMock } from '../utils/FileSystemMock';

/**
 * Configuration options for the test framework
 */
export interface TestFrameworkConfig {
  /** Enable/disable specific mocking features */
  features?: {
    vault?: boolean;
    workspace?: boolean;
    metadataCache?: boolean;
    fileSystem?: boolean;
    plugins?: boolean;
  };

  /** Vault configuration */
  vault?: {
    name?: string;
    path?: string;
    adapter?: 'memory' | 'filesystem';
  };

  /** Plugin configuration */
  plugin?: {
    manifest?: any;
    settings?: any;
    enabledPlugins?: string[];
  };

  /** Test data options */
  testData?: {
    generateSampleVault?: boolean;
    sampleFiles?: string[];
    customFixtures?: Record<string, any>;
  };

  /** Performance testing options */
  performance?: {
    enableProfiling?: boolean;
    memoryTracking?: boolean;
    timeoutMs?: number;
  };

  /** Mobile testing options */
  mobile?: {
    enabled?: boolean;
    platform?: 'ios' | 'android';
    viewport?: { width: number; height: number };
  };
}

/**
 * Test environment context containing all mocked objects
 */
export interface TestEnvironment {
  app: MockApp;
  vault: MockVault;
  workspace: MockWorkspace;
  metadataCache: MockMetadataCache;
  plugin?: MockPlugin;
  testData: TestDataManager;
  fileSystem: FileSystemMock;
}

/**
 * Main test framework class providing comprehensive Obsidian testing capabilities
 */
export class ObsidianTestFramework {
  private config: TestFrameworkConfig;
  private environment: TestEnvironment | null = null;
  private performanceMetrics: Map<string, any> = new Map();
  private activeTests: Set<string> = new Set();

  constructor(config: TestFrameworkConfig = {}) {
    this.config = this.mergeDefaultConfig(config);
  }

  /**
   * Initialize the test environment with all required mocks
   */
  async setup(): Promise<TestEnvironment> {
    if (this.environment) {
      throw new Error('Test environment already initialized. Call teardown() first.');
    }

    const startTime = performance.now();

    try {
      // Initialize file system mock
      const fileSystem = new FileSystemMock({
        adapter: this.config.vault?.adapter || 'memory'
      });

      // Initialize vault mock
      const vault = new MockVault({
        name: this.config.vault?.name || 'test-vault',
        path: this.config.vault?.path || '/test-vault',
        fileSystem
      });

      // Initialize metadata cache
      const metadataCache = new MockMetadataCache({ vault });

      // Initialize workspace
      const workspace = new MockWorkspace({
        vault,
        mobile: this.config.mobile?.enabled || false
      });

      // Initialize app mock
      const app = new MockApp({
        vault,
        workspace,
        metadataCache,
        isMobile: this.config.mobile?.enabled || false
      });

      // Initialize test data manager
      const testData = new TestDataManager({
        vault,
        fileSystem,
        config: this.config.testData
      });

      // Initialize plugin mock if configured
      let plugin: MockPlugin | undefined;
      if (this.config.features?.plugins !== false && this.config.plugin) {
        plugin = new MockPlugin({
          app,
          manifest: this.config.plugin.manifest,
          settings: this.config.plugin.settings
        });
      }

      this.environment = {
        app,
        vault,
        workspace,
        metadataCache,
        plugin,
        testData,
        fileSystem
      };

      // Generate sample data if requested
      if (this.config.testData?.generateSampleVault) {
        await this.generateSampleVault();
      }

      // Record setup performance
      const setupTime = performance.now() - startTime;
      this.performanceMetrics.set('setupTime', setupTime);

      return this.environment;
    } catch (error) {
      throw new Error(`Failed to setup test environment: ${error.message}`);
    }
  }

  /**
   * Clean up and tear down the test environment
   */
  async teardown(): Promise<void> {
    if (!this.environment) {
      return;
    }

    const startTime = performance.now();

    try {
      // Cleanup plugin if present
      if (this.environment.plugin) {
        await this.environment.plugin.onunload();
      }

      // Cleanup file system
      await this.environment.fileSystem.cleanup();

      // Clear caches
      this.environment.metadataCache.clear();
      this.environment.workspace.clearLeaves();

      // Record teardown performance
      const teardownTime = performance.now() - startTime;
      this.performanceMetrics.set('teardownTime', teardownTime);

      this.environment = null;
      this.activeTests.clear();
    } catch (error) {
      throw new Error(`Failed to teardown test environment: ${error.message}`);
    }
  }

  /**
   * Get the current test environment
   */
  getEnvironment(): TestEnvironment {
    if (!this.environment) {
      throw new Error('Test environment not initialized. Call setup() first.');
    }
    return this.environment;
  }

  /**
   * Create a snapshot of the current environment state
   */
  createSnapshot(): any {
    const env = this.getEnvironment();
    return {
      vault: env.vault.getSnapshot(),
      workspace: env.workspace.getSnapshot(),
      metadataCache: env.metadataCache.getSnapshot(),
      timestamp: Date.now()
    };
  }

  /**
   * Restore environment from a snapshot
   */
  async restoreSnapshot(snapshot: any): Promise<void> {
    const env = this.getEnvironment();
    await env.vault.restoreFromSnapshot(snapshot.vault);
    await env.workspace.restoreFromSnapshot(snapshot.workspace);
    await env.metadataCache.restoreFromSnapshot(snapshot.metadataCache);
  }

  /**
   * Register a test for tracking
   */
  registerTest(testName: string): void {
    this.activeTests.add(testName);
  }

  /**
   * Unregister a test
   */
  unregisterTest(testName: string): void {
    this.activeTests.delete(testName);
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): Record<string, any> {
    return Object.fromEntries(this.performanceMetrics);
  }

  /**
   * Enable mobile testing mode
   */
  enableMobileMode(platform: 'ios' | 'android' = 'ios'): void {
    const env = this.getEnvironment();
    env.app.isMobile = true;
    env.workspace.setMobileMode(true, platform);
  }

  /**
   * Disable mobile testing mode
   */
  disableMobileMode(): void {
    const env = this.getEnvironment();
    env.app.isMobile = false;
    env.workspace.setMobileMode(false);
  }

  /**
   * Start performance profiling
   */
  startProfiling(profileName: string): void {
    if (this.config.performance?.enableProfiling) {
      this.performanceMetrics.set(`${profileName}_start`, performance.now());
    }
  }

  /**
   * End performance profiling
   */
  endProfiling(profileName: string): number {
    if (this.config.performance?.enableProfiling) {
      const startTime = this.performanceMetrics.get(`${profileName}_start`);
      if (startTime) {
        const duration = performance.now() - startTime;
        this.performanceMetrics.set(`${profileName}_duration`, duration);
        return duration;
      }
    }
    return 0;
  }

  /**
   * Generate sample vault data for testing
   */
  private async generateSampleVault(): Promise<void> {
    const env = this.getEnvironment();

    // Create sample folders
    await env.vault.createFolder('Daily Notes');
    await env.vault.createFolder('Projects');
    await env.vault.createFolder('Templates');
    await env.vault.createFolder('Attachments');

    // Create sample files
    const sampleFiles = this.config.testData?.sampleFiles || [
      'Daily Notes/2023-01-01.md',
      'Projects/Project A.md',
      'Templates/Daily Note Template.md',
      'README.md'
    ];

    for (const filePath of sampleFiles) {
      await env.testData.createSampleFile(filePath);
    }
  }

  /**
   * Merge user config with default configuration
   */
  private mergeDefaultConfig(userConfig: TestFrameworkConfig): TestFrameworkConfig {
    const defaultConfig: TestFrameworkConfig = {
      features: {
        vault: true,
        workspace: true,
        metadataCache: true,
        fileSystem: true,
        plugins: true
      },
      vault: {
        name: 'test-vault',
        path: '/test-vault',
        adapter: 'memory'
      },
      testData: {
        generateSampleVault: false,
        sampleFiles: [],
        customFixtures: {}
      },
      performance: {
        enableProfiling: false,
        memoryTracking: false,
        timeoutMs: 30000
      },
      mobile: {
        enabled: false,
        platform: 'ios',
        viewport: { width: 375, height: 667 }
      }
    };

    return this.deepMerge(defaultConfig, userConfig);
  }

  /**
   * Deep merge utility for configuration objects
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}

/**
 * Global test framework instance for singleton pattern usage
 */
let globalFramework: ObsidianTestFramework | null = null;

/**
 * Get or create global test framework instance
 */
export function getTestFramework(config?: TestFrameworkConfig): ObsidianTestFramework {
  if (!globalFramework) {
    globalFramework = new ObsidianTestFramework(config);
  }
  return globalFramework;
}

/**
 * Reset global test framework instance
 */
export function resetTestFramework(): void {
  if (globalFramework) {
    globalFramework.teardown();
    globalFramework = null;
  }
}

/**
 * Convenience function for quick test setup
 */
export async function setupTest(config?: TestFrameworkConfig): Promise<TestEnvironment> {
  const framework = getTestFramework(config);
  return await framework.setup();
}

/**
 * Convenience function for quick test teardown
 */
export async function teardownTest(): Promise<void> {
  if (globalFramework) {
    await globalFramework.teardown();
  }
}