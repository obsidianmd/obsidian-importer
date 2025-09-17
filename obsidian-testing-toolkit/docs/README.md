# Obsidian Testing Toolkit

A comprehensive, modular testing framework specifically designed for Obsidian plugin development. This toolkit provides everything you need to test your Obsidian plugins thoroughly, from unit tests to end-to-end scenarios.

## 🚀 Features

### Complete Obsidian API Mocking
- **MockVault**: Full file system simulation with metadata
- **MockApp**: Complete app state and plugin management
- **MockWorkspace**: Leaf management and layout simulation
- **MockEditor**: CodeMirror-based editor simulation
- **MockPlugin**: Plugin lifecycle and settings management

### Test Runners
- **Unit Test Runner**: Fast, isolated component testing
- **Integration Test Runner**: Multi-component interaction testing
- **E2E Test Runner**: Complete user journey simulation
- **Coverage Reporter**: Comprehensive code coverage analysis

### Utilities & Helpers
- **Snapshot Testing**: Jest integration for UI and data snapshots
- **Async Test Helpers**: Event waiting, timing, and promises
- **Date Mocking**: Time travel and date simulation
- **Network Mocking**: HTTP request interception and simulation
- **Test Data Manager**: Sample vault and fixture generation

### Fixtures & Sample Data
- **Sample Vaults**: Pre-configured vault structures
- **Test Files**: Complex markdown with various features
- **Mock Manifests**: Plugin configuration examples
- **Template System**: Customizable test scenarios

## 🏗️ Architecture

```
obsidian-testing-toolkit/
├── core/                 # Core mock implementations
│   ├── ObsidianTestFramework.ts
│   ├── MockVault.ts
│   ├── MockApp.ts
│   ├── MockPlugin.ts
│   ├── MockEditor.ts
│   ├── MockWorkspace.ts
│   └── MockMetadataCache.ts
├── utils/               # Testing utilities
│   ├── TestDataManager.ts
│   ├── SnapshotTesting.ts
│   ├── AsyncTestHelpers.ts
│   ├── DateMocking.ts
│   ├── NetworkMocking.ts
│   └── FileSystemMock.ts
├── runners/             # Test execution runners
│   ├── UnitTestRunner.ts
│   ├── IntegrationTestRunner.ts
│   ├── E2ETestRunner.ts
│   └── CoverageReporter.ts
├── fixtures/            # Sample data and fixtures
│   ├── sample-vaults/
│   ├── test-files/
│   └── mock-manifests/
├── config/              # Configuration files
│   ├── jest.config.toolkit.js
│   ├── tsconfig.test.json
│   └── .eslintrc.test.json
└── docs/                # Documentation
    ├── README.md
    ├── API.md
    ├── EXAMPLES.md
    └── MIGRATION.md
```

## 🚀 Quick Start

### Installation

1. Copy the `obsidian-testing-toolkit` folder to your plugin project
2. Install dependencies:

```bash
npm install --save-dev jest @types/jest ts-jest jest-environment-jsdom
```

3. Update your `package.json`:

```json
{
  "scripts": {
    "test": "jest --config obsidian-testing-toolkit/config/jest.config.toolkit.js",
    "test:watch": "jest --watch --config obsidian-testing-toolkit/config/jest.config.toolkit.js",
    "test:coverage": "jest --coverage --config obsidian-testing-toolkit/config/jest.config.toolkit.js"
  }
}
```

### Basic Usage

```typescript
import { createUnitTestRunner } from './obsidian-testing-toolkit/runners/UnitTestRunner';

const runner = createUnitTestRunner();

runner.describe('My Plugin Tests', suite => {
  suite.it('should create a file', async (env) => {
    // Create a test file
    const file = await env.vault.create('test.md', '# Test Content');

    // Verify it was created
    expect(file.name).toBe('test.md');
    expect(await env.vault.read(file)).toBe('# Test Content');
  });

  suite.it('should handle plugin settings', async (env) => {
    // Test plugin settings
    const plugin = env.plugin;
    plugin.setSetting('testSetting', 'testValue');

    expect(plugin.getSetting('testSetting')).toBe('testValue');
  });
});

// Run the tests
runner.run().then(results => {
  runner.printResults();
});
```

## 📚 Documentation

- **[API Reference](API.md)** - Complete API documentation
- **[Examples](EXAMPLES.md)** - Practical usage examples
- **[Migration Guide](MIGRATION.md)** - Upgrading from other testing frameworks

## 🧪 Testing Approaches

### Unit Testing
Test individual components in isolation:

```typescript
import { testVaultOperation } from './obsidian-testing-toolkit/runners/UnitTestRunner';

await testVaultOperation(async (env) => {
  const file = await env.vault.create('note.md', '# My Note');
  expect(file.basename).toBe('note');
});
```

### Integration Testing
Test component interactions:

```typescript
import { createIntegrationTestRunner } from './obsidian-testing-toolkit/runners/IntegrationTestRunner';

const runner = createIntegrationTestRunner({
  generateSampleData: true,
  plugins: [{ id: 'my-plugin' }]
});

runner.scenario('File creation workflow', scenario => {
  scenario
    .step('Create file', async (env) => {
      await env.vault.create('test.md', '# Test');
    })
    .step('Verify metadata', async (env) => {
      const file = env.vault.getFileByPath('test.md');
      const metadata = env.metadataCache.getFileCache(file!);
      expect(metadata?.headings).toHaveLength(1);
    });
});
```

### End-to-End Testing
Test complete user journeys:

```typescript
import { createE2ETestRunner } from './obsidian-testing-toolkit/runners/E2ETestRunner';

const runner = createE2ETestRunner({
  screenshots: true,
  plugins: ['my-plugin']
});

runner.journey('Create and edit note', journey => {
  journey
    .command('Create new note', 'file:new')
    .type('Add title', '# My New Note')
    .key('Save', 'Ctrl+S')
    .assert('File exists', async (env) => {
      expect(env.vault.getFiles()).toHaveLength(1);
    });
});
```

## 🎯 Key Features

### Snapshot Testing
Capture and compare complex data structures:

```typescript
import { createSnapshotTester } from './obsidian-testing-toolkit/utils/SnapshotTesting';

const tester = createSnapshotTester();

// Test vault structure
expect(vault).toMatchVaultSnapshot();

// Test metadata parsing
const snapshot = await tester.createMetadataCacheSnapshot(metadataCache);
expect(snapshot).toMatchSnapshot();
```

### Time and Network Mocking
Control time and network requests:

```typescript
import { freezeTime, timeTravel } from './obsidian-testing-toolkit/utils/DateMocking';
import { mockJsonResponse } from './obsidian-testing-toolkit/utils/NetworkMocking';

// Mock time
freezeTime(new Date('2023-01-01'));
timeTravel(1, 'days');

// Mock network
mockJsonResponse('https://api.example.com/data', { result: 'success' });
```

### Sample Data Generation
Generate realistic test data:

```typescript
const testData = new TestDataManager({ vault, fileSystem });

// Generate sample vault
await testData.generateVaultFromTemplate('research-vault');

// Create daily notes
await testData.createDailyNotesStructure(new Date(), 30);

// Generate random content
const content = testData.generateRandomMarkdown(5, true, true, true);
```

## 🔧 Configuration

### Jest Configuration
The toolkit provides a pre-configured Jest setup:

```javascript
// jest.config.js
module.exports = require('./obsidian-testing-toolkit/config/jest.config.toolkit.js');
```

### TypeScript Configuration
Extend the provided TypeScript configuration:

```json
{
  "extends": "./obsidian-testing-toolkit/config/tsconfig.test.json"
}
```

### ESLint Configuration
Use the testing-specific ESLint rules:

```json
{
  "extends": ["./obsidian-testing-toolkit/config/.eslintrc.test.json"]
}
```

## 📊 Coverage and Reporting

Generate comprehensive test reports:

```typescript
import { getCoverageReporter } from './obsidian-testing-toolkit/runners/CoverageReporter';

const reporter = getCoverageReporter({
  thresholds: { lines: 80, functions: 80, branches: 80 }
});

// Generate reports
await reporter.saveReports();
reporter.printSummary();
```

## 🚀 Advanced Features

### Mobile Testing
Test mobile-specific functionality:

```typescript
const runner = createE2ETestRunner({
  environment: 'mobile',
  mobileMode: true
});
```

### Plugin Interaction Testing
Test plugin interactions:

```typescript
runner.scenario('Plugin collaboration', scenario => {
  scenario.setup(async (env) => {
    env.app.loadPlugin('plugin-a');
    env.app.loadPlugin('plugin-b');
  });
});
```

### Performance Testing
Monitor performance metrics:

```typescript
const runner = createIntegrationTestRunner({
  monitorPerformance: true
});

// Access performance data
const results = await runner.run();
console.log(results[0].performance);
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- Obsidian team for the excellent plugin API
- Jest community for the testing framework
- Plugin developers who provided feedback and testing

---

**Made with ❤️ for the Obsidian plugin development community**