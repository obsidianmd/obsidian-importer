/**
 * Jest global setup file
 *
 * This file runs once before all tests. Use it for global test configuration
 * that needs to happen before any test files are loaded.
 */

module.exports = async () => {
  // Set global environment variables
  process.env.NODE_ENV = 'test';
  process.env.OBSIDIAN_TESTING = 'true';

  // Initialize any global test infrastructure
  console.log('🚀 Setting up Obsidian Testing Toolkit global environment...');

  // Mock global objects that Obsidian might expect
  global.window = global.window || {};
  global.document = global.document || {};

  // Set up global test configuration
  global.OBSIDIAN_TEST_CONFIG = {
    timeouts: {
      unit: 5000,
      integration: 30000,
      e2e: 60000
    },
    retries: {
      unit: 0,
      integration: 1,
      e2e: 2
    }
  };

  console.log('✅ Global test environment setup complete');
};