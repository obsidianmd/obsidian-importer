# Migration Guide

This guide helps you migrate from other testing frameworks to the Obsidian Testing Toolkit.

## 📋 Table of Contents

- [From Jest-only Setup](#from-jest-only-setup)
- [From Custom Mock Implementation](#from-custom-mock-implementation)
- [From No Testing](#from-no-testing)
- [From Other Testing Frameworks](#from-other-testing-frameworks)
- [Breaking Changes](#breaking-changes)
- [Best Practices](#best-practices)

## 🔄 From Jest-only Setup

If you're currently using Jest without Obsidian-specific mocking:

### Before
```typescript
// Your old test
describe('My Plugin', () => {
  it('should do something', () => {
    // Manual mocking required
    const mockApp = {
      vault: {
        create: jest.fn(),
        read: jest.fn()
      }
    };

    // Test implementation
  });
});
```

### After
```typescript
// With Obsidian Testing Toolkit
import { createUnitTestRunner } from './obsidian-testing-toolkit/runners/UnitTestRunner';

const runner = createUnitTestRunner();

runner.describe('My Plugin', suite => {
  suite.it('should do something', async (env) => {
    // Full Obsidian environment available
    const file = await env.vault.create('test.md', 'content');
    expect(file.name).toBe('test.md');
  });
});
```

### Migration Steps

1. **Install the toolkit**:
   ```bash
   # Copy obsidian-testing-toolkit to your project
   # Update package.json scripts
   ```

2. **Update jest configuration**:
   ```javascript
   // jest.config.js
   module.exports = require('./obsidian-testing-toolkit/config/jest.config.toolkit.js');
   ```

3. **Convert existing tests**:
   ```typescript
   // Replace manual mocks with test runners
   import { testVaultOperation } from './obsidian-testing-toolkit/runners/UnitTestRunner';

   // Old test becomes:
   await testVaultOperation(async (env) => {
     // Your test logic here
   });
   ```

## 🔧 From Custom Mock Implementation

If you've built your own Obsidian mocking:

### Assessment Checklist

- [ ] Identify which Obsidian APIs you're mocking
- [ ] Check if your tests use file system operations
- [ ] Determine if you have plugin lifecycle tests
- [ ] Note any custom event handling
- [ ] Review editor interaction tests

### Migration Strategy

1. **Map your mocks to toolkit components**:
   ```typescript
   // Your custom vault mock → MockVault
   // Your custom app mock → MockApp
   // Your custom plugin mock → MockPlugin
   ```

2. **Preserve test data**:
   ```typescript
   // Extract your test data
   const testData = new TestDataManager({ vault, fileSystem });

   // Generate equivalent sample data
   await testData.generateVaultFromTemplate('your-custom-structure');
   ```

3. **Convert test patterns**:
   ```typescript
   // Before: Custom setup/teardown
   beforeEach(() => {
     mockVault = new YourCustomVaultMock();
   });

   // After: Automatic environment
   runner.describe('Tests', suite => {
     suite.it('test', async (env) => {
       // env.vault is ready to use
     });
   });
   ```

## 🆕 From No Testing

Starting fresh? Follow this progressive approach:

### Phase 1: Basic Setup
```typescript
// Start with simple unit tests
import { testVaultOperation } from './obsidian-testing-toolkit/runners/UnitTestRunner';

await testVaultOperation(async (env) => {
  const file = await env.vault.create('test.md', '# Test');
  expect(file).toBeDefined();
});
```

### Phase 2: Plugin Testing
```typescript
// Add plugin-specific tests
const runner = createUnitTestRunner({
  plugins: [{ id: 'your-plugin' }]
});

runner.describe('Plugin Tests', suite => {
  suite.it('loads correctly', async (env) => {
    expect(env.plugin.manifest.id).toBe('your-plugin');
  });
});
```

### Phase 3: Integration Testing
```typescript
// Test component interactions
const runner = createIntegrationTestRunner({
  generateSampleData: true
});

runner.scenario('File workflow', scenario => {
  scenario
    .step('Create file', async (env) => {
      await env.vault.create('note.md', '# Note');
    })
    .step('Verify metadata', async (env) => {
      const file = env.vault.getFileByPath('note.md');
      const cache = env.metadataCache.getFileCache(file!);
      expect(cache?.headings).toHaveLength(1);
    });
});
```

### Phase 4: E2E Testing
```typescript
// Test user journeys
const runner = createE2ETestRunner({
  screenshots: true
});

runner.journey('User workflow', journey => {
  journey
    .command('Create note', 'file:new')
    .type('Add content', '# My Note')
    .assert('File created', async (env) => {
      expect(env.vault.getFiles()).toHaveLength(1);
    });
});
```

## 🔄 From Other Testing Frameworks

### From Mocha/Chai
```typescript
// Mocha/Chai style
describe('Tests', () => {
  it('should work', () => {
    expect(result).to.equal(expected);
  });
});

// Toolkit equivalent
const runner = createUnitTestRunner();
runner.describe('Tests', suite => {
  suite.it('should work', async (env) => {
    expect(result).toBe(expected);
  });
});
```

### From Vitest
```typescript
// Vitest style
import { describe, it, expect } from 'vitest';

describe('Tests', () => {
  it('should work', () => {
    // Test logic
  });
});

// Toolkit equivalent - similar pattern
const runner = createUnitTestRunner();
runner.describe('Tests', suite => {
  suite.it('should work', async (env) => {
    // Test logic with Obsidian environment
  });
});
```

### From QUnit
```typescript
// QUnit style
QUnit.test('my test', assert => {
  assert.ok(true, 'passed');
});

// Toolkit equivalent
const runner = createUnitTestRunner();
runner.describe('My Tests', suite => {
  suite.it('my test', async (env) => {
    expect(true).toBe(true);
  });
});
```

## ⚠️ Breaking Changes

### Configuration Changes
- **Old**: Custom jest.config.js
- **New**: Use provided jest.config.toolkit.js

### Test Structure Changes
- **Old**: Direct Jest describe/it
- **New**: Test runners with environment injection

### Mock Changes
- **Old**: Manual mock setup
- **New**: Automatic mock environment

### Import Changes
```typescript
// Old imports
import { jest } from '@jest/globals';

// New imports
import { createUnitTestRunner } from './obsidian-testing-toolkit/runners/UnitTestRunner';
```

## 📝 Best Practices for Migration

### 1. Incremental Migration
```typescript
// Don't migrate everything at once
// Start with one test file
// Gradually convert others

// Phase 1: Convert simple tests
// Phase 2: Convert complex scenarios
// Phase 3: Add new test types
```

### 2. Preserve Test Coverage
```typescript
// Before migration: Check coverage
npm run test:coverage

// After migration: Verify coverage maintained
npm run test:coverage
```

### 3. Update CI/CD
```yaml
# .github/workflows/test.yml
- name: Run tests
  run: npm test
  # Configuration automatically handled by toolkit
```

### 4. Team Training
```typescript
// Document new patterns for your team
// Provide examples specific to your plugin
// Set up pair programming sessions for migration
```

## 🔍 Troubleshooting Common Issues

### Issue: Tests timing out
```typescript
// Solution: Adjust timeouts in global config
global.OBSIDIAN_TEST_CONFIG = {
  timeouts: {
    unit: 10000,      // Increase if needed
    integration: 60000,
    e2e: 120000
  }
};
```

### Issue: Mock data not realistic
```typescript
// Solution: Use TestDataManager
const testData = new TestDataManager({ vault, fileSystem });
await testData.generateVaultFromTemplate('your-use-case');
```

### Issue: Plugin not loading in tests
```typescript
// Solution: Verify plugin configuration
const runner = createUnitTestRunner({
  plugins: [{
    id: 'your-plugin-id',
    manifest: yourManifest  // Provide if custom
  }]
});
```

### Issue: Environment not isolated
```typescript
// Solution: Use proper isolation level
const runner = createUnitTestRunner({
  isolationLevel: 'full'  // Ensures complete isolation
});
```

## 📚 Additional Resources

- [API Reference](API.md) - Complete API documentation
- [Examples](EXAMPLES.md) - Practical usage examples
- [Obsidian Plugin API](https://docs.obsidian.md/Plugins) - Official documentation

## 🆘 Getting Help

If you encounter issues during migration:

1. Check the [Examples](EXAMPLES.md) for similar use cases
2. Review the [API Reference](API.md) for specific functionality
3. Look at the sample test files in `fixtures/`
4. Create an issue with your specific migration challenge

## ✅ Migration Checklist

Use this checklist to track your migration progress:

### Setup
- [ ] Copy obsidian-testing-toolkit to project
- [ ] Install required dependencies
- [ ] Update package.json scripts
- [ ] Configure Jest to use toolkit config

### Test Conversion
- [ ] Identify all existing test files
- [ ] Convert unit tests to use UnitTestRunner
- [ ] Convert integration tests to IntegrationTestRunner
- [ ] Add E2E tests where appropriate
- [ ] Verify all tests pass

### Documentation
- [ ] Update README with new test commands
- [ ] Document any custom test patterns
- [ ] Update contributing guidelines
- [ ] Train team on new testing approach

### CI/CD
- [ ] Update GitHub Actions/CI configuration
- [ ] Verify tests run in CI environment
- [ ] Check coverage reporting works
- [ ] Update deployment scripts if needed

### Cleanup
- [ ] Remove old mock implementations
- [ ] Delete unused test utilities
- [ ] Clean up old configuration files
- [ ] Archive old test documentation

---

**Migration complete!** Your plugin now has comprehensive, reliable testing with the Obsidian Testing Toolkit.