# Examples

Practical examples for using the Obsidian Testing Toolkit in real-world scenarios.

## Table of Contents

- [Basic Plugin Testing](#basic-plugin-testing)
- [Vault Operations](#vault-operations)
- [Metadata and Links](#metadata-and-links)
- [User Interface Testing](#user-interface-testing)
- [Plugin Interactions](#plugin-interactions)
- [Performance Testing](#performance-testing)
- [Mobile Testing](#mobile-testing)
- [Data Import/Export](#data-importexport)
- [Settings and Configuration](#settings-and-configuration)
- [Error Handling](#error-handling)

## Basic Plugin Testing

### Simple Plugin Functionality

```typescript
import { createUnitTestRunner } from './obsidian-testing-toolkit/runners/UnitTestRunner';

describe('My Plugin', () => {
  const runner = createUnitTestRunner({
    plugin: {
      manifest: {
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0'
      }
    }
  });

  runner.describe('Basic functionality', suite => {
    suite.it('should initialize correctly', async (env) => {
      const plugin = env.plugin;
      expect(plugin.isPluginLoaded()).toBe(true);
      expect(plugin.manifest.id).toBe('my-plugin');
    });

    suite.it('should add commands', async (env) => {
      const plugin = env.plugin;

      plugin.addCommand({
        id: 'test-command',
        name: 'Test Command',
        callback: () => console.log('Command executed')
      });

      const commands = plugin.getCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0].name).toBe('Test Command');
    });
  });

  await runner.run();
  runner.printResults();
});
```

### Plugin Settings Management

```typescript
import { testPluginComponent } from './obsidian-testing-toolkit/runners/UnitTestRunner';

interface MyPluginSettings {
  enableFeature: boolean;
  maxItems: number;
  customText: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  enableFeature: true,
  maxItems: 10,
  customText: 'Default'
};

await testPluginComponent(
  (env) => {
    const plugin = env.plugin;
    plugin.settings = DEFAULT_SETTINGS;
    return plugin;
  },
  async (plugin, env) => {
    // Test default settings
    expect(plugin.getSetting('enableFeature')).toBe(true);
    expect(plugin.getSetting('maxItems')).toBe(10);

    // Test setting updates
    plugin.setSetting('customText', 'Updated');
    expect(plugin.getSetting('customText')).toBe('Updated');

    // Test save/load cycle
    await plugin.saveSettings();
    plugin.settings = {};
    await plugin.loadSettings();
    expect(plugin.getSetting('customText')).toBe('Updated');
  }
);
```

## Vault Operations

### File Creation and Management

```typescript
import { testVaultOperation } from './obsidian-testing-toolkit/runners/UnitTestRunner';

describe('File Operations', () => {
  test('Create and manage files', async () => {
    await testVaultOperation(async (env) => {
      const vault = env.vault;

      // Create a basic file
      const file = await vault.create('test-note.md', '# Test Note\n\nThis is a test.');
      expect(file.name).toBe('test-note.md');
      expect(file.basename).toBe('test-note');
      expect(file.extension).toBe('md');

      // Read file content
      const content = await vault.read(file);
      expect(content).toContain('# Test Note');

      // Modify file
      await vault.modify(file, '# Updated Note\n\nContent updated.');
      const updatedContent = await vault.read(file);
      expect(updatedContent).toContain('Updated Note');

      // Create folder structure
      await vault.createFolder('Projects');
      await vault.createFolder('Projects/Active');

      // Move file to folder
      await vault.rename(file, 'Projects/Active/test-note.md');
      expect(vault.getFileByPath('Projects/Active/test-note.md')).toBeTruthy();
      expect(vault.getFileByPath('test-note.md')).toBeFalsy();

      // Copy file
      const copiedFile = await vault.copy(file, 'Projects/test-note-copy.md');
      expect(copiedFile.path).toBe('Projects/test-note-copy.md');

      // Verify folder structure
      const projectsFolder = vault.getFolderByPath('Projects');
      expect(projectsFolder).toBeTruthy();
      expect(projectsFolder!.children.length).toBe(2); // Active folder + copied file
    });
  });
});
```

### Batch File Operations

```typescript
import { TestDataManager } from './obsidian-testing-toolkit/utils/TestDataManager';

test('Bulk file operations', async () => {
  await testVaultOperation(async (env) => {
    const { vault, testData } = env;

    // Create multiple files at once
    const fileNames = [
      'Notes/Note 1.md',
      'Notes/Note 2.md',
      'Notes/Note 3.md',
      'Projects/Project A.md',
      'Projects/Project B.md'
    ];

    const files = await testData.createSampleFiles(fileNames);
    expect(files).toHaveLength(5);

    // Verify all files exist
    const allFiles = vault.getFiles();
    expect(allFiles).toHaveLength(5);

    // Test file filtering
    const noteFiles = allFiles.filter(f => f.path.startsWith('Notes/'));
    expect(noteFiles).toHaveLength(3);

    const projectFiles = allFiles.filter(f => f.path.startsWith('Projects/'));
    expect(projectFiles).toHaveLength(2);

    // Batch rename operation
    for (const file of noteFiles) {
      const newName = file.basename.replace('Note', 'Document');
      await vault.rename(file, `Notes/${newName}.md`);
    }

    // Verify renames
    expect(vault.getFileByPath('Notes/Document 1.md')).toBeTruthy();
    expect(vault.getFileByPath('Notes/Document 2.md')).toBeTruthy();
    expect(vault.getFileByPath('Notes/Note 1.md')).toBeFalsy();
  });
});
```

## Metadata and Links

### Link Processing and Resolution

```typescript
import { createIntegrationTestRunner } from './obsidian-testing-toolkit/runners/IntegrationTestRunner';

test('Link processing', async () => {
  const runner = createIntegrationTestRunner({
    generateSampleData: true
  });

  runner.scenario('Link resolution', scenario => {
    scenario
      .step('Create linked files', async (env) => {
        const { vault } = env;

        // Create source file with links
        await vault.create('source.md', `
# Source File

Links to other files:
- [[target-file]]
- [[Projects/My Project]]
- [[Non-existent File]]

Block reference: [[target-file#important-section]]
        `);

        // Create target files
        await vault.create('target-file.md', `
# Target File

## Important Section
This section can be referenced.
        `);

        await vault.createFolder('Projects');
        await vault.create('Projects/My Project.md', '# My Project\n\nProject details here.');
      })

      .step('Process metadata', async (env) => {
        const { vault, metadataCache } = env;

        // Trigger metadata processing
        const sourceFile = vault.getFileByPath('source.md')!;
        await metadataCache.triggerCacheUpdate(sourceFile);

        // Check cached metadata
        const metadata = metadataCache.getFileCache(sourceFile);
        expect(metadata).toBeTruthy();
        expect(metadata!.links).toHaveLength(4); // 3 regular links + 1 block reference

        // Check link targets
        const links = metadata!.links!;
        expect(links.find(l => l.link === 'target-file')).toBeTruthy();
        expect(links.find(l => l.link === 'Projects/My Project')).toBeTruthy();
        expect(links.find(l => l.link === 'Non-existent File')).toBeTruthy();
      })

      .step('Verify link resolution', async (env) => {
        const { vault, metadataCache } = env;

        const sourceFile = vault.getFileByPath('source.md')!;

        // Check resolved links
        const resolvedLinks = metadataCache.getResolvedLinks(sourceFile);
        expect(resolvedLinks['target-file.md']).toBe(1);
        expect(resolvedLinks['Projects/My Project.md']).toBe(1);

        // Check unresolved links
        const unresolvedLinks = metadataCache.getUnresolvedLinks(sourceFile);
        expect(unresolvedLinks['Non-existent File']).toBe(1);

        // Check backlinks
        const targetFile = vault.getFileByPath('target-file.md')!;
        const backlinks = metadataCache.getBacklinksForFile(targetFile);
        expect(backlinks['source.md']).toBeTruthy();
        expect(backlinks['source.md']).toHaveLength(2); // Regular link + block reference
      });
  });

  await runner.run();
});
```

### Frontmatter Processing

```typescript
test('Frontmatter handling', async () => {
  await testVaultOperation(async (env) => {
    const { vault, metadataCache } = env;

    // Create file with complex frontmatter
    const content = `---
title: Complex Document
author: Test Author
date: 2023-01-15
tags: [test, example, frontmatter]
categories:
  - Testing
  - Documentation
metadata:
  version: 1.0
  status: draft
aliases: ["Complex Doc", "Test Document"]
publish: true
rating: 4.5
---

# Document Content

This document has complex frontmatter.`;

    const file = await vault.create('complex-doc.md', content);
    await metadataCache.triggerCacheUpdate(file);

    const metadata = metadataCache.getFileCache(file);
    expect(metadata?.frontmatter).toBeTruthy();

    const fm = metadata!.frontmatter!;
    expect(fm.title).toBe('Complex Document');
    expect(fm.author).toBe('Test Author');
    expect(fm.tags).toEqual(['test', 'example', 'frontmatter']);
    expect(fm.categories).toEqual(['Testing', 'Documentation']);
    expect(fm.metadata.version).toBe(1.0);
    expect(fm.publish).toBe(true);
    expect(fm.rating).toBe(4.5);
    expect(fm.aliases).toEqual(['Complex Doc', 'Test Document']);
  });
});
```

## User Interface Testing

### Command Execution

```typescript
import { createE2ETestRunner } from './obsidian-testing-toolkit/runners/E2ETestRunner';

test('Command execution flow', async () => {
  const runner = createE2ETestRunner({
    plugins: ['my-plugin']
  });

  runner.journey('Command workflow', journey => {
    journey
      .setup(async (env) => {
        // Set up plugin with commands
        const plugin = env.app.plugins.getPlugin('my-plugin');
        plugin.addCommand({
          id: 'create-daily-note',
          name: 'Create Daily Note',
          callback: async () => {
            const today = new Date().toISOString().split('T')[0];
            await env.vault.create(`Daily Notes/${today}.md`, `# ${today}\n\n## Today's Tasks\n- [ ] `);
          }
        });
      })

      .command('Execute daily note command', 'my-plugin:create-daily-note')

      .assert('Daily note created', async (env) => {
        const today = new Date().toISOString().split('T')[0];
        const dailyNote = env.vault.getFileByPath(`Daily Notes/${today}.md`);
        expect(dailyNote).toBeTruthy();

        const content = await env.vault.read(dailyNote!);
        expect(content).toContain(`# ${today}`);
        expect(content).toContain("Today's Tasks");
      });
  });

  await runner.run();
});
```

### Workspace Layout Testing

```typescript
test('Workspace layout management', async () => {
  await testVaultOperation(async (env) => {
    const { vault, workspace } = env;

    // Create test files
    await vault.create('file1.md', '# File 1');
    await vault.create('file2.md', '# File 2');
    await vault.create('file3.md', '# File 3');

    // Test initial state
    expect(workspace.getActiveLeaf()).toBeTruthy();

    // Open files in different leaves
    const leaf1 = workspace.getActiveLeaf()!;
    await leaf1.openFile(vault.getFileByPath('file1.md')!);

    const leaf2 = workspace.createLeafBySplit(leaf1, 'horizontal');
    await leaf2.openFile(vault.getFileByPath('file2.md')!);

    const leaf3 = workspace.createLeafBySplit(leaf2, 'vertical');
    await leaf3.openFile(vault.getFileByPath('file3.md')!);

    // Verify layout
    const markdownLeaves = workspace.getLeavesOfType('markdown');
    expect(markdownLeaves).toHaveLength(3);

    // Test active leaf switching
    workspace.setActiveLeaf(leaf2);
    expect(workspace.getActiveLeaf()).toBe(leaf2);

    // Test leaf pinning
    leaf1.setPinned(true);
    expect(leaf1.getPinned()).toBe(true);

    // Test leaf closing
    leaf3.detach();
    const remainingLeaves = workspace.getLeavesOfType('markdown');
    expect(remainingLeaves).toHaveLength(2);
  });
});
```

## Plugin Interactions

### Multi-Plugin Scenarios

```typescript
test('Plugin interaction', async () => {
  const runner = createIntegrationTestRunner({
    enablePlugins: true,
    plugins: [
      { id: 'plugin-a', manifest: { id: 'plugin-a', name: 'Plugin A' } },
      { id: 'plugin-b', manifest: { id: 'plugin-b', name: 'Plugin B' } }
    ]
  });

  runner.scenario('Plugin collaboration', scenario => {
    scenario
      .setup(async (env) => {
        // Configure plugin interactions
        const pluginA = env.app.plugins.getPlugin('plugin-a');
        const pluginB = env.app.plugins.getPlugin('plugin-b');

        // Plugin A provides a service
        pluginA.addCommand({
          id: 'get-data',
          name: 'Get Data',
          callback: () => {
            return { data: 'from-plugin-a', timestamp: Date.now() };
          }
        });

        // Plugin B consumes the service
        pluginB.addCommand({
          id: 'process-data',
          name: 'Process Data',
          callback: () => {
            const data = env.app.commands.executeCommandById('plugin-a:get-data');
            return { processed: true, original: data };
          }
        });
      })

      .step('Test individual plugins', async (env) => {
        expect(env.app.isPluginLoaded('plugin-a')).toBe(true);
        expect(env.app.isPluginLoaded('plugin-b')).toBe(true);
      })

      .step('Test plugin communication', async (env) => {
        const result = env.app.commands.executeCommandById('plugin-b:process-data');
        expect(result).toBeTruthy();
      });
  });

  await runner.run();
});
```

### Plugin Event System

```typescript
import { waitForEvent } from './obsidian-testing-toolkit/utils/AsyncTestHelpers';

test('Plugin event handling', async () => {
  await testVaultOperation(async (env) => {
    const { vault, app } = env;

    // Set up event listeners
    const events: string[] = [];

    vault.on('create', (file) => {
      events.push(`create:${file.path}`);
    });

    vault.on('modify', (file) => {
      events.push(`modify:${file.path}`);
    });

    vault.on('delete', (file) => {
      events.push(`delete:${file.path}`);
    });

    // Perform operations and wait for events
    const file = await vault.create('test.md', 'content');
    await waitForEvent(vault, 'create');

    await vault.modify(file, 'updated content');
    await waitForEvent(vault, 'modify');

    await vault.delete(file);
    await waitForEvent(vault, 'delete');

    // Verify event sequence
    expect(events).toEqual([
      'create:test.md',
      'modify:test.md',
      'delete:test.md'
    ]);
  });
});
```

## Performance Testing

### Load Testing

```typescript
import { freezeTime, timeTravel } from './obsidian-testing-toolkit/utils/DateMocking';

test('Plugin performance under load', async () => {
  const runner = createIntegrationTestRunner({
    monitorPerformance: true,
    sampleFileCount: 1000 // Large dataset
  });

  runner.scenario('Performance test', scenario => {
    scenario
      .step('Create large dataset', async (env) => {
        const { testData } = env;

        // Generate large number of files
        for (let i = 0; i < 1000; i++) {
          await testData.createSampleFile(`Notes/Note ${i}.md`);
        }
      })

      .step('Test metadata processing speed', async (env) => {
        const { vault, metadataCache } = env;

        const startTime = Date.now();

        // Process all files
        const files = vault.getFiles();
        for (const file of files) {
          await metadataCache.triggerCacheUpdate(file);
        }

        const processingTime = Date.now() - startTime;

        // Assert reasonable performance
        expect(processingTime).toBeLessThan(5000); // 5 seconds for 1000 files
        expect(metadataCache.getCachedFiles()).toHaveLength(1000);
      })

      .step('Test search performance', async (env) => {
        const { vault } = env;

        const startTime = Date.now();

        // Simulate search across all files
        const searchTerm = 'test';
        const results = vault.getFiles().filter(file =>
          file.name.toLowerCase().includes(searchTerm)
        );

        const searchTime = Date.now() - startTime;

        expect(searchTime).toBeLessThan(100); // Fast search
        expect(results.length).toBeGreaterThan(0);
      });
  });

  const results = await runner.run();

  // Check performance metrics
  const performance = results[0].performance;
  expect(performance).toBeTruthy();
  expect(performance!.avgStepDuration).toBeLessThan(2000);
});
```

### Memory Usage Testing

```typescript
test('Memory usage monitoring', async () => {
  await testVaultOperation(async (env) => {
    const { vault, fileSystem } = env;

    // Monitor initial state
    const initialStats = fileSystem.getStats();

    // Create many files
    const fileCount = 500;
    for (let i = 0; i < fileCount; i++) {
      await vault.create(`file-${i}.md`, `# File ${i}\n\n${'x'.repeat(1000)}`); // 1KB each
    }

    // Check memory usage
    const afterCreationStats = fileSystem.getStats();
    expect(afterCreationStats.totalSize).toBeGreaterThan(fileCount * 1000);

    // Clean up files
    const files = vault.getFiles();
    for (const file of files) {
      await vault.delete(file);
    }

    // Verify cleanup
    const finalStats = fileSystem.getStats();
    expect(finalStats.fileCount).toBe(0);
    expect(finalStats.totalSize).toBe(0);
  });
});
```

## Mobile Testing

### Mobile-Specific Features

```typescript
test('Mobile interface adaptation', async () => {
  const runner = createE2ETestRunner({
    environment: 'mobile',
    mobileMode: true
  });

  runner.journey('Mobile user workflow', journey => {
    journey
      .environment('mobile')
      .setup(async (env) => {
        // Verify mobile mode
        expect(env.app.isMobile).toBe(true);
        expect(env.workspace.isMobileMode()).toBe(true);
      })

      .custom('Test mobile navigation', async (env) => {
        const { vault, workspace } = env;

        // Create files
        await vault.create('note1.md', '# Note 1');
        await vault.create('note2.md', '# Note 2');

        // Mobile navigation pattern - single pane
        const leaf = workspace.getActiveLeaf()!;
        await leaf.openFile(vault.getFileByPath('note1.md')!);

        // Verify single pane behavior
        const leaves = workspace.getLeavesOfType('markdown');
        expect(leaves).toHaveLength(1);

        // Navigate to another file (should replace current)
        await leaf.openFile(vault.getFileByPath('note2.md')!);
        expect(leaf.view.file?.path).toBe('note2.md');
      })

      .assert('Mobile optimizations active', async (env) => {
        expect(env.app.isMobile).toBe(true);
        expect(env.workspace.isMobileMode()).toBe(true);
      });
  });

  await runner.run();
});
```

### Touch Interface Testing

```typescript
test('Touch interactions', async () => {
  const runner = createE2ETestRunner({
    environment: 'mobile',
    interactionSpeed: 'slow' // Simulate touch interactions
  });

  runner.journey('Touch workflow', journey => {
    journey
      .custom('Touch file creation', async (env) => {
        // Simulate touch-based file creation
        const { vault } = env;

        // Touch interaction would typically trigger through UI
        // Here we simulate the resulting action
        await vault.create('touch-created.md', '# Created via Touch');

        const file = vault.getFileByPath('touch-created.md');
        expect(file).toBeTruthy();
      })

      .wait('Touch delay', 500) // Simulate touch interaction delay

      .custom('Test touch scrolling behavior', async (env) => {
        // Simulate touch scrolling through large document
        const { vault } = env;

        const longContent = Array(100).fill('').map((_, i) => `## Section ${i + 1}\n\nContent for section ${i + 1}.`).join('\n\n');
        await vault.create('long-document.md', longContent);

        const leaf = env.workspace.getActiveLeaf()!;
        await leaf.openFile(vault.getFileByPath('long-document.md')!);

        // Verify document structure for scrolling
        const metadata = env.metadataCache.getFileCache(vault.getFileByPath('long-document.md')!);
        expect(metadata?.headings).toHaveLength(100);
      });
  });

  await runner.run();
});
```

## Data Import/Export

### Import Testing

```typescript
import { enableNetworkMocking, mockJsonResponse } from './obsidian-testing-toolkit/utils/NetworkMocking';

test('Data import workflow', async () => {
  enableNetworkMocking();

  // Mock external API
  mockJsonResponse('https://api.example.com/export', {
    notes: [
      { title: 'Imported Note 1', content: '# Imported Note 1\n\nContent from external source.' },
      { title: 'Imported Note 2', content: '# Imported Note 2\n\nMore imported content.' }
    ]
  });

  await testVaultOperation(async (env) => {
    const { vault, app } = env;

    // Simulate import process
    const response = await app.requestUrl('https://api.example.com/export');
    const data = response.json;

    // Process imported data
    for (const note of data.notes) {
      const fileName = `${note.title}.md`;
      await vault.create(fileName, note.content);
    }

    // Verify import
    const importedFiles = vault.getFiles();
    expect(importedFiles).toHaveLength(2);

    const note1 = vault.getFileByPath('Imported Note 1.md');
    expect(note1).toBeTruthy();

    const content1 = await vault.read(note1!);
    expect(content1).toContain('Content from external source');
  });
});
```

### Export Testing

```typescript
test('Data export workflow', async () => {
  await testVaultOperation(async (env) => {
    const { vault, testData } = env;

    // Create sample data to export
    await testData.createProjectStructure('Export Test Project');
    await testData.createDailyNotesStructure(new Date('2023-01-01'), 7);

    // Simulate export process
    const allFiles = vault.getFiles();
    const exportData = {
      vault: vault.name,
      exportDate: new Date().toISOString(),
      files: []
    };

    for (const file of allFiles) {
      const content = await vault.read(file);
      exportData.files.push({
        path: file.path,
        name: file.name,
        content: content,
        stats: file.stat
      });
    }

    // Verify export structure
    expect(exportData.files.length).toBeGreaterThan(0);
    expect(exportData.vault).toBe(vault.name);

    // Verify file integrity
    const projectFile = exportData.files.find(f => f.path.includes('Export Test Project'));
    expect(projectFile).toBeTruthy();
    expect(projectFile.content).toContain('# Export Test Project');

    const dailyNotes = exportData.files.filter(f => f.path.includes('Daily Notes'));
    expect(dailyNotes).toHaveLength(7);
  });
});
```

## Settings and Configuration

### Settings Panel Testing

```typescript
test('Settings management', async () => {
  const runner = createIntegrationTestRunner({
    enablePlugins: true,
    plugins: [{
      id: 'settings-plugin',
      settings: {
        enableNotifications: true,
        maxFileSize: 1000000,
        customPath: 'custom/path',
        themes: ['dark', 'light']
      }
    }]
  });

  runner.scenario('Settings workflow', scenario => {
    scenario
      .step('Verify default settings', async (env) => {
        const plugin = env.app.plugins.getPlugin('settings-plugin');

        expect(plugin.getSetting('enableNotifications')).toBe(true);
        expect(plugin.getSetting('maxFileSize')).toBe(1000000);
        expect(plugin.getSetting('customPath')).toBe('custom/path');
        expect(plugin.getSetting('themes')).toEqual(['dark', 'light']);
      })

      .step('Update settings', async (env) => {
        const plugin = env.app.plugins.getPlugin('settings-plugin');

        // Update individual settings
        plugin.setSetting('enableNotifications', false);
        plugin.setSetting('maxFileSize', 2000000);
        plugin.setSetting('customPath', 'updated/path');

        // Verify updates
        expect(plugin.getSetting('enableNotifications')).toBe(false);
        expect(plugin.getSetting('maxFileSize')).toBe(2000000);
        expect(plugin.getSetting('customPath')).toBe('updated/path');
      })

      .step('Test settings persistence', async (env) => {
        const plugin = env.app.plugins.getPlugin('settings-plugin');

        // Save settings
        await plugin.saveSettings();

        // Reset settings object
        plugin.settings = {};

        // Load settings
        await plugin.loadSettings();

        // Verify persistence
        expect(plugin.getSetting('enableNotifications')).toBe(false);
        expect(plugin.getSetting('maxFileSize')).toBe(2000000);
      })

      .step('Test invalid settings', async (env) => {
        const plugin = env.app.plugins.getPlugin('settings-plugin');

        // Test with undefined values
        expect(plugin.getSetting('nonexistentSetting')).toBeUndefined();
        expect(plugin.getSetting('nonexistentSetting', 'default')).toBe('default');

        // Test type safety
        plugin.setSetting('maxFileSize', 'invalid-number');
        expect(typeof plugin.getSetting('maxFileSize')).toBe('string');
      });
  });

  await runner.run();
});
```

### Configuration Validation

```typescript
test('Configuration validation', async () => {
  await testPluginComponent(
    (env) => {
      const plugin = env.plugin;

      // Define configuration schema
      const configSchema = {
        required: ['apiKey', 'endpoint'],
        properties: {
          apiKey: { type: 'string', minLength: 10 },
          endpoint: { type: 'string', pattern: '^https?://' },
          maxRetries: { type: 'number', minimum: 0, maximum: 10 },
          enableDebug: { type: 'boolean' }
        }
      };

      plugin.configSchema = configSchema;
      return plugin;
    },
    async (plugin, env) => {
      // Test valid configuration
      const validConfig = {
        apiKey: '1234567890abcdef',
        endpoint: 'https://api.example.com',
        maxRetries: 3,
        enableDebug: false
      };

      plugin.updateSettings(validConfig);
      expect(plugin.getSetting('apiKey')).toBe(validConfig.apiKey);
      expect(plugin.getSetting('endpoint')).toBe(validConfig.endpoint);

      // Test invalid configuration
      const invalidConfig = {
        apiKey: '123', // Too short
        endpoint: 'not-a-url',
        maxRetries: 15, // Too high
        enableDebug: 'not-boolean'
      };

      // In a real implementation, you'd validate against schema
      // Here we simulate validation results
      expect(() => {
        if (invalidConfig.apiKey.length < 10) {
          throw new Error('API key too short');
        }
      }).toThrow('API key too short');

      expect(() => {
        if (!invalidConfig.endpoint.match(/^https?:\/\//)) {
          throw new Error('Invalid endpoint URL');
        }
      }).toThrow('Invalid endpoint URL');
    }
  );
});
```

## Error Handling

### Error Recovery Testing

```typescript
import { mockErrorResponse } from './obsidian-testing-toolkit/utils/NetworkMocking';

test('Error handling and recovery', async () => {
  enableNetworkMocking();

  // Mock network errors
  mockErrorResponse('https://api.example.com/error', 500, 'Internal Server Error');
  mockErrorResponse('https://api.example.com/timeout', 408, 'Request Timeout');

  await testVaultOperation(async (env) => {
    const { app, vault } = env;

    // Test network error handling
    try {
      await app.requestUrl('https://api.example.com/error');
      fail('Should have thrown an error');
    } catch (error) {
      expect(error.message).toContain('Internal Server Error');
    }

    // Test timeout handling
    try {
      await app.requestUrl('https://api.example.com/timeout');
      fail('Should have thrown a timeout error');
    } catch (error) {
      expect(error.message).toContain('Request Timeout');
    }

    // Test file operation errors
    try {
      await vault.create('invalid/path/file.md', 'content');
      fail('Should have thrown a path error');
    } catch (error) {
      expect(error.message).toContain('no such file or directory');
    }

    // Test reading non-existent file
    try {
      const nonExistentFile = vault.getFileByPath('missing.md');
      if (nonExistentFile) {
        await vault.read(nonExistentFile);
      } else {
        throw new Error('File not found');
      }
      fail('Should have thrown file not found error');
    } catch (error) {
      expect(error.message).toContain('File not found');
    }
  });
});
```

### Graceful Degradation

```typescript
test('Graceful degradation', async () => {
  const runner = createIntegrationTestRunner({
    networkConditions: 'offline' // Simulate offline mode
  });

  runner.scenario('Offline operation', scenario => {
    scenario
      .step('Test offline functionality', async (env) => {
        const { vault, app } = env;

        // Core functionality should work offline
        const file = await vault.create('offline-note.md', '# Offline Note');
        expect(file).toBeTruthy();

        const content = await vault.read(file);
        expect(content).toContain('Offline Note');

        // Network-dependent features should degrade gracefully
        try {
          await app.requestUrl('https://api.example.com/sync');
          fail('Network request should fail in offline mode');
        } catch (error) {
          // Expected to fail - should handle gracefully
          expect(error).toBeTruthy();
        }
      })

      .step('Test fallback mechanisms', async (env) => {
        const { vault } = env;

        // Create local backup instead of syncing
        const files = vault.getFiles();
        const backup = {
          timestamp: Date.now(),
          files: files.map(f => ({
            path: f.path,
            name: f.name,
            size: f.stat.size
          }))
        };

        // Verify backup creation
        expect(backup.files).toHaveLength(1);
        expect(backup.files[0].name).toBe('offline-note.md');
      });
  });

  await runner.run();
});
```

---

These examples demonstrate comprehensive testing scenarios for Obsidian plugins. Each example focuses on practical, real-world testing situations that plugin developers commonly encounter.

For more specific use cases or advanced testing patterns, refer to the [API documentation](API.md) or check the `fixtures/` directory for additional sample data and configurations.