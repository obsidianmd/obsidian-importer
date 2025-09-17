/**
 * Jest global teardown file
 *
 * This file runs once after all tests have completed. Use it for global cleanup
 * and reporting that needs to happen after all test files have finished.
 */

module.exports = async () => {
  console.log('🧹 Cleaning up Obsidian Testing Toolkit global environment...');

  // Clean up any global test infrastructure
  if (global.OBSIDIAN_TEST_CONFIG) {
    delete global.OBSIDIAN_TEST_CONFIG;
  }

  // Clean up global mocks
  if (global.app) {
    delete global.app;
  }

  // Final cleanup
  console.log('✅ Global test environment cleanup complete');
};