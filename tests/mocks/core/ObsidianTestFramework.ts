/**
 * Simplified mock for ObsidianTestFramework to avoid circular dependencies
 */

import { App, Vault, Workspace, MetadataCache, Plugin } from 'obsidian';

export interface TestEnvironment {
  app: App;
  vault: Vault;
  workspace: Workspace;
  metadataCache: MetadataCache;
  plugin?: Plugin;
  testData?: any;
  fileSystem?: any;
}

export interface TestFrameworkConfig {
  features?: {
    vault?: boolean;
    workspace?: boolean;
    metadataCache?: boolean;
    fileSystem?: boolean;
    plugins?: boolean;
  };
  vault?: {
    name?: string;
    path?: string;
    adapter?: 'memory' | 'filesystem';
  };
  plugin?: {
    manifest?: any;
    settings?: any;
    enabledPlugins?: string[];
  };
  testData?: {
    generateSampleVault?: boolean;
    sampleFiles?: string[];
    customFixtures?: Record<string, any>;
  };
}

/**
 * Simple test environment setup without circular dependencies
 */
export async function setupTest(config?: TestFrameworkConfig): Promise<TestEnvironment> {
  const app = new App();
  const vault = new Vault();
  const workspace = new Workspace();
  const metadataCache = new MetadataCache();

  // Mock file system operations
  const fileSystem = {
    cleanup: jest.fn().mockResolvedValue(undefined),
    createFile: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(''),
    exists: jest.fn().mockResolvedValue(false),
  };

  return {
    app,
    vault,
    workspace,
    metadataCache,
    fileSystem,
  };
}

/**
 * Simple test teardown
 */
export async function teardownTest(): Promise<void> {
  // Simple cleanup - no circular references
  jest.clearAllMocks();
}

/**
 * Export type for compatibility
 */
export { TestEnvironment };