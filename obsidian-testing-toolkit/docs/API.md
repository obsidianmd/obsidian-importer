# API Reference

Complete API documentation for the Obsidian Testing Toolkit.

## Core Testing Framework

### ObsidianTestFramework

Main orchestrator for Obsidian plugin testing.

#### Constructor

```typescript
new ObsidianTestFramework(config?: TestFrameworkConfig)
```

#### Methods

##### setup()
```typescript
async setup(): Promise<TestEnvironment>
```
Initialize the test environment with all required mocks.

##### teardown()
```typescript
async teardown(): Promise<void>
```
Clean up and tear down the test environment.

##### getEnvironment()
```typescript
getEnvironment(): TestEnvironment
```
Get the current test environment.

##### createSnapshot()
```typescript
createSnapshot(): any
```
Create a snapshot of the current environment state.

##### restoreSnapshot()
```typescript
async restoreSnapshot(snapshot: any): Promise<void>
```
Restore environment from a snapshot.

#### Configuration

```typescript
interface TestFrameworkConfig {
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
  performance?: {
    enableProfiling?: boolean;
    memoryTracking?: boolean;
    timeoutMs?: number;
  };
  mobile?: {
    enabled?: boolean;
    platform?: 'ios' | 'android';
    viewport?: { width: number; height: number };
  };
}
```

#### Test Environment

```typescript
interface TestEnvironment {
  app: MockApp;
  vault: MockVault;
  workspace: MockWorkspace;
  metadataCache: MockMetadataCache;
  plugin?: MockPlugin;
  testData: TestDataManager;
  fileSystem: FileSystemMock;
}
```

---

## Mock Implementations

### MockVault

Complete implementation of Obsidian's Vault API.

#### File Operations

```typescript
// Create files and folders
async create(path: string, data?: string): Promise<MockTFile>
async createFolder(path: string): Promise<MockTFolder>

// Read and write
async read(file: MockTFile | string): Promise<string>
async readBinary(file: MockTFile | string): Promise<ArrayBuffer>
async modify(file: MockTFile, data: string): Promise<void>
async writeBinary(file: MockTFile, data: ArrayBuffer): Promise<void>

// File management
async copy(file: MockTFile, newPath: string): Promise<MockTFile>
async rename(file: MockTFile | MockTFolder, newPath: string): Promise<void>
async delete(file: MockTFile | MockTFolder): Promise<void>

// File access
getFiles(): MockTFile[]
getFolders(): MockTFolder[]
getFileByPath(path: string): MockTFile | null
getFolderByPath(path: string): MockTFolder | null
exists(path: string): boolean
```

#### MockTFile

```typescript
class MockTFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number; size: number };
  vault: MockVault;
}
```

#### MockTFolder

```typescript
class MockTFolder {
  path: string;
  name: string;
  children: (MockTFile | MockTFolder)[];
  vault: MockVault;
  parent: MockTFolder | null;
}
```

### MockApp

Complete implementation of Obsidian's App interface.

#### Properties

```typescript
interface MockApp {
  vault: MockVault;
  workspace: MockWorkspace;
  metadataCache: MockMetadataCache;
  commands: MockCommands;
  setting: MockSettings;
  keymap: MockKeymap;
  plugins: MockPlugins;
  isMobile: boolean;
  lastEvent: any;
}
```

#### Plugin Management

```typescript
// Load and manage plugins
loadPlugin(id: string, manifest?: any): void
unloadPlugin(id: string): void
isPluginLoaded(id: string): boolean
getLoadedPlugins(): string[]

// Network requests
async requestUrl(url: string, options?: any): Promise<any>
addRequestMock(url: string | RegExp, response: any): void
removeRequestMock(url: string | RegExp): void
```

### MockPlugin

Plugin lifecycle and functionality simulation.

#### Lifecycle

```typescript
// Plugin lifecycle
async onload(): Promise<void>
async onunload(): Promise<void>

// Status checking
isPluginLoaded(): boolean
isPluginEnabled(): boolean
```

#### Features

```typescript
// Commands
addCommand(command: {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean;
  hotkeys?: any[];
}): void

// UI Elements
addStatusBarItem(): any
addRibbonIcon(icon: string, title: string, callback: () => void): any
addSettingTab(settingTab: any): void

// Event handling
registerEvent(eventRef: any): void
registerDomEvent(element: Element, type: string, listener: EventListener): void
registerInterval(id: number): number

// Settings
async loadSettings(): Promise<void>
async saveSettings(): Promise<void>
getSetting(key: string, defaultValue?: any): any
setSetting(key: string, value: any): void
```

### MockWorkspace

Workspace and layout management.

#### Layout Management

```typescript
// Leaf management
getActiveLeaf(): MockWorkspaceLeaf | null
setActiveLeaf(leaf: MockWorkspaceLeaf): void
createLeafBySplit(leaf?: MockWorkspaceLeaf, direction?: 'horizontal' | 'vertical'): MockWorkspaceLeaf
getLeaf(newLeaf?: boolean): MockWorkspaceLeaf

// View access
getActiveViewOfType(type: string): any
getLeavesOfType(type: string): MockWorkspaceLeaf[]

// Navigation
async openLinkText(linkText: string, sourcePath?: string, newLeaf?: boolean): Promise<void>

// Mobile support
setMobileMode(mobile: boolean, platform?: 'ios' | 'android'): void
isMobileMode(): boolean
```

#### MockWorkspaceLeaf

```typescript
class MockWorkspaceLeaf {
  // File operations
  async openFile(file: MockTFile, state?: any): Promise<void>
  async setViewState(viewState: { type: string; state?: any }): Promise<void>
  getViewState(): any

  // Leaf management
  detach(): void
  setPinned(pinned: boolean): void
  getPinned(): boolean
  getDisplayText(): string
  getViewType(): string
}
```

### MockEditor

CodeMirror-based editor simulation.

#### Text Operations

```typescript
// Content access
getValue(): string
setValue(content: string): void
getLine(line: number): string
lineCount(): number

// Text modification
replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition): void
replaceSelection(replacement: string): void
insert(text: string): void
deleteChar(): void

// Cursor and selection
getCursor(): EditorPosition
setCursor(pos: EditorPosition | number, ch?: number): void
getSelection(): string
setSelection(from: EditorPosition, to?: EditorPosition): void
clearSelection(): void

// Utility
getWordAt(pos: EditorPosition): { anchor: EditorPosition; head: EditorPosition } | null
posToOffset(pos: EditorPosition): number
offsetToPos(offset: number): EditorPosition
```

#### Editor Position

```typescript
interface EditorPosition {
  line: number;
  ch: number;
}
```

### MockMetadataCache

Metadata parsing and caching.

#### Cache Access

```typescript
// File metadata
getFileCache(file: MockTFile): CachedMetadata | null
isCached(file: MockTFile): boolean
getCachedFiles(): string[]

// Links and references
getResolvedLinks(file: MockTFile): Record<string, number>
getUnresolvedLinks(file: MockTFile): Record<string, number>
getBacklinksForFile(file: MockTFile): Record<string, LinkCache[]>

// Tags
getTags(): Record<string, number>

// Cache management
async triggerCacheUpdate(file: MockTFile): Promise<void>
clearCache(file: MockTFile): void
clear(): void
```

#### Metadata Types

```typescript
interface CachedMetadata {
  frontmatter?: FrontmatterCache;
  links?: LinkCache[];
  embeds?: EmbedCache[];
  tags?: TagCache[];
  headings?: HeadingCache[];
  blocks?: BlockCache[];
  sections?: SectionCache[];
}

interface LinkCache {
  link: string;
  original: string;
  displayText?: string;
  position: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}
```

---

## Test Runners

### UnitTestRunner

Fast, isolated component testing.

#### Configuration

```typescript
interface UnitTestConfig {
  autoSetup?: boolean;
  mockTimers?: boolean;
  mockNetwork?: boolean;
  freezeTime?: boolean;
  isolation?: 'none' | 'basic' | 'strict';
  timeout?: number;
  plugin?: {
    manifest?: any;
    settings?: any;
  };
}
```

#### Usage

```typescript
const runner = createUnitTestRunner(config);

runner.describe('Test Suite', suite => {
  suite.setup(() => {
    // Suite setup
  });

  suite.beforeEach(() => {
    // Before each test
  });

  suite.it('Test case', async (env) => {
    // Test implementation
  });

  suite.afterEach(() => {
    // After each test
  });

  suite.teardown(() => {
    // Suite teardown
  });
});

const results = await runner.run();
```

#### Convenience Functions

```typescript
// Single test execution
await runSingleTest('Test name', async (env) => {
  // Test logic
});

// Component testing
await testPluginComponent(
  (env) => new MyComponent(env),
  async (component, env) => {
    // Test component
  }
);

// Vault operations
await testVaultOperation(async (env) => {
  const file = await env.vault.create('test.md', 'content');
  expect(file.name).toBe('test.md');
});
```

### IntegrationTestRunner

Multi-component interaction testing.

#### Configuration

```typescript
interface IntegrationTestConfig {
  vaultTemplate?: string;
  generateSampleData?: boolean;
  sampleFileCount?: number;
  enablePlugins?: boolean;
  plugins?: { id: string; manifest?: any; settings?: any }[];
  timeout?: number;
  monitorPerformance?: boolean;
  mobileMode?: boolean;
  networkConditions?: 'fast' | 'slow' | 'offline';
}
```

#### Usage

```typescript
const runner = createIntegrationTestRunner(config);

runner.scenario('Scenario name', scenario => {
  scenario
    .description('Detailed description')
    .setup(async (env) => {
      // Scenario setup
    })
    .step('Step name', async (env) => {
      // Step implementation
    })
    .stepWithVerify('Step with verification',
      async (env) => {
        // Action
      },
      async (env) => {
        // Verification
      }
    )
    .teardown(async (env) => {
      // Scenario cleanup
    });
});

const results = await runner.run();
```

### E2ETestRunner

Complete user journey simulation.

#### Configuration

```typescript
interface E2ETestConfig {
  environment?: 'desktop' | 'mobile' | 'both';
  vaultTemplate?: string;
  screenshots?: boolean;
  videoRecording?: boolean;
  timeout?: number;
  interactionSpeed?: 'fast' | 'normal' | 'slow';
  waitForAnimations?: boolean;
  plugins?: string[];
}
```

#### Usage

```typescript
const runner = createE2ETestRunner(config);

runner.journey('User journey', journey => {
  journey
    .description('Journey description')
    .environment('desktop')
    .click('Click button', '#button-selector')
    .type('Enter text', 'Hello world')
    .key('Press key', 'Enter')
    .command('Execute command', 'command-id')
    .navigate('Go to file', 'file-path')
    .wait('Wait for animation', 1000)
    .custom('Custom action', async (env) => {
      // Custom action
    })
    .assert('Verify result', async (env) => {
      // Assertion
    });
});

const results = await runner.run();
```

---

## Utilities

### TestDataManager

Sample vault creation and management.

#### Vault Generation

```typescript
// Generate from template
await testData.generateVaultFromTemplate('research-vault');

// Create sample files
await testData.createSampleFile('note.md', template);
await testData.createSampleFiles(['note1.md', 'note2.md']);

// Create structures
await testData.createDailyNotesStructure(startDate, days);
await testData.createProjectStructure('Project Name');
await testData.createKnowledgeBase(['Topic1', 'Topic2']);

// Generate content
const content = testData.generateRandomMarkdown(paragraphs, includeHeadings, includeLists, includeLinks);
```

### SnapshotTesting

Jest snapshot integration.

#### Snapshot Creation

```typescript
const tester = createSnapshotTester();

// Vault snapshots
const vaultSnapshot = tester.createVaultSnapshot(vault);
const contentSnapshot = await tester.createVaultContentSnapshot(vault);

// Workspace snapshots
const workspaceSnapshot = tester.createWorkspaceSnapshot(workspace);

// Metadata snapshots
const metadataSnapshot = tester.createMetadataCacheSnapshot(metadataCache);

// Environment snapshots
const envSnapshot = await tester.createEnvironmentSnapshot(environment);
```

#### Jest Matchers

```typescript
// Extend Jest expectations
expect(vault).toMatchVaultSnapshot();
expect(vault).toMatchVaultContentSnapshot();
expect(workspace).toMatchWorkspaceSnapshot();
```

### AsyncTestHelpers

Async operation and timing utilities.

#### Waiting Functions

```typescript
// Wait for condition
await waitFor(() => condition(), { timeout: 5000 });

// Wait for event
await waitForEvent(emitter, 'event-name', { timeout: 5000 });

// Wait for element
await waitForElement('#selector', { timeout: 5000 });

// Simple delays
await sleep(1000);
await nextTick();
```

#### Mock Timers

```typescript
// Enable mock timers
const mockTimer = enableMockTimers();

// Control time
advanceTimers(1000);
runAllTimers();

// Disable mock timers
disableMockTimers();
```

### DateMocking

Time travel and date simulation.

#### Time Control

```typescript
// Freeze time
freezeTime(new Date('2023-01-01'));

// Travel through time
timeTravel(1, 'days');
travelTo(new Date('2023-06-01'));

// Unfreeze time
unfreezeTime();

// Auto-advancing time
withAutoAdvancingTime({ autoAdvance: true }, async () => {
  // Time advances automatically
});
```

#### Date Utilities

```typescript
// Date calculations
const pastDate = DateTestUtils.daysAgo(7);
const futureDate = DateTestUtils.daysFromNow(30);
const startOfDay = DateTestUtils.startOfDay();

// Obsidian date formats
const dailyNoteFormat = DateTestUtils.formatForDailyNote(new Date());
const parsedDate = DateTestUtils.parseFromDailyNote('2023-01-01.md');
```

### NetworkMocking

HTTP request interception and simulation.

#### Request Mocking

```typescript
// Enable network mocking
const networkMock = enableNetworkMocking();

// Mock responses
networkMock.get('/api/data', { status: 200, json: { result: 'success' } });
networkMock.post('/api/create', { status: 201, json: { id: 123 } });

// Mock errors
mockErrorResponse('/api/error', 500, 'Server Error');

// Mock timeouts
mockTimeout('/api/slow', 5000);

// Common scenarios
CommonMocks.github.user('username');
CommonMocks.http.notFound('/api/missing');
```

#### Request Verification

```typescript
// Assert requests were made
NetworkAssertions.expectRequestTo('/api/data');
NetworkAssertions.expectRequestCount(3, { method: 'POST' });
NetworkAssertions.expectNoRequests();

// Wait for requests
const request = await networkMock.waitForRequest({ url: '/api/data' });
```

---

## Configuration

### Jest Configuration

Pre-configured Jest setup with Obsidian-specific optimizations.

```javascript
// jest.config.js
module.exports = require('./obsidian-testing-toolkit/config/jest.config.toolkit.js');
```

Key features:
- jsdom environment for DOM testing
- TypeScript support with ts-jest
- Module name mapping for toolkit imports
- Coverage reporting with thresholds
- Snapshot testing configuration
- Mock timer support

### TypeScript Configuration

Testing-specific TypeScript configuration.

```json
{
  "extends": "./obsidian-testing-toolkit/config/tsconfig.test.json"
}
```

Features:
- Optimized for testing environment
- Path mapping for toolkit imports
- Mock type definitions
- Source map support for debugging

### ESLint Configuration

Testing-specific linting rules.

```json
{
  "extends": ["./obsidian-testing-toolkit/config/.eslintrc.test.json"]
}
```

Includes:
- Jest-specific rules and best practices
- Relaxed rules for test files
- TypeScript testing optimizations
- Import resolution for test files

---

## Error Handling

### Common Errors

#### Environment Not Initialized
```typescript
// Error: Test environment not initialized
const env = framework.getEnvironment(); // Throws if setup() not called

// Solution: Always call setup() first
await framework.setup();
const env = framework.getEnvironment();
```

#### File Not Found
```typescript
// Error: File not found
const file = vault.getFileByPath('missing.md'); // Returns null

// Solution: Check if file exists
const file = vault.getFileByPath('test.md');
if (!file) {
  throw new Error('File not found');
}
```

#### Mock Not Configured
```typescript
// Error: Unmocked request
await requestUrl('https://api.example.com'); // Throws if network mocking enabled

// Solution: Add mock before test
mockJsonResponse('https://api.example.com', { data: 'test' });
```

### Error Recovery

```typescript
// Automatic cleanup on test failure
try {
  await runTest();
} catch (error) {
  await framework.teardown(); // Always cleanup
  throw error;
}
```

---

## Performance Considerations

### Memory Management
- Use `teardown()` to clean up resources
- Clear large data sets between tests
- Use memory adapters for fast testing

### Test Speed
- Use unit tests for fast feedback
- Limit integration test scope
- Mock external dependencies

### Resource Usage
- Batch file operations when possible
- Reuse test environments for related tests
- Monitor memory usage in long test suites

---

This API reference covers the complete toolkit functionality. For practical examples, see [EXAMPLES.md](EXAMPLES.md).