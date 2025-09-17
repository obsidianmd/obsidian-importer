/**
 * Jest test setup file
 * This file is executed before each test suite
 */

// Mock Obsidian API globally
jest.mock('obsidian', () => require('../__mocks__/obsidian'));

// Set up global test environment
beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
});

// Global test timeout
jest.setTimeout(10000);

// Suppress console logs in tests unless explicitly needed
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};