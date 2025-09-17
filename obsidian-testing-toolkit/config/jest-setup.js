/**
 * Jest setup file for Obsidian Testing Toolkit
 *
 * This file is run before each test file and sets up the global testing environment.
 */

// Import testing utilities
import { jestMatchers } from '../utils/SnapshotTesting';
import { enableMockTimers } from '../utils/AsyncTestHelpers';
import { enableNetworkMocking } from '../utils/NetworkMocking';

// Extend Jest matchers with Obsidian-specific matchers
expect.extend(jestMatchers);

// Global test configuration
global.console = {
  ...console,
  // Suppress console.log in tests unless explicitly needed
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: console.warn,
  error: console.error,
};

// Mock global objects that might be used by Obsidian
global.require = jest.fn();
global.process = {
  ...process,
  env: {
    ...process.env,
    NODE_ENV: 'test'
  }
};

// Mock localStorage if not available
if (typeof localStorage === 'undefined') {
  global.localStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    length: 0,
    key: jest.fn()
  };
}

// Mock sessionStorage if not available
if (typeof sessionStorage === 'undefined') {
  global.sessionStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    length: 0,
    key: jest.fn()
  };
}

// Mock URL if not available (for older Node versions)
if (typeof URL === 'undefined') {
  global.URL = class URL {
    constructor(url, base) {
      this.href = url;
      this.origin = 'http://localhost';
      this.protocol = 'http:';
      this.host = 'localhost';
      this.hostname = 'localhost';
      this.port = '';
      this.pathname = '/';
      this.search = '';
      this.hash = '';
    }
  };
}

// Mock fetch if not available
if (typeof fetch === 'undefined') {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
      blob: () => Promise.resolve(new Blob()),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
    })
  );
}

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn(cb => setTimeout(cb, 0));
global.cancelAnimationFrame = jest.fn(id => clearTimeout(id));

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn()
}));

// Mock ResizeObserver
global.ResizeObserver = jest.fn(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn()
}));

// Mock MutationObserver
global.MutationObserver = jest.fn(() => ({
  observe: jest.fn(),
  disconnect: jest.fn(),
  takeRecords: jest.fn()
}));

// Enhanced error handling for async tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Fail the test if there's an unhandled rejection
  throw reason;
});

// Global test helpers
global.testHelpers = {
  // Wait for next tick
  nextTick: () => new Promise(resolve => process.nextTick(resolve)),

  // Wait for specified time
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // Create mock function with helpful defaults
  createMockFn: (name = 'mockFunction') => {
    const fn = jest.fn();
    fn.displayName = name;
    return fn;
  },

  // Create a promise that can be resolved/rejected externally
  createDeferred: () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
};

// Global cleanup function
global.cleanupTest = () => {
  // Clear all mocks
  jest.clearAllMocks();

  // Reset console mocks
  global.console.log.mockClear();
  global.console.debug.mockClear();
  global.console.info.mockClear();

  // Clear localStorage
  if (global.localStorage.clear) {
    global.localStorage.clear();
  }

  // Clear sessionStorage
  if (global.sessionStorage.clear) {
    global.sessionStorage.clear();
  }
};

// Automatically cleanup after each test
afterEach(() => {
  global.cleanupTest();
});

// Increase timeout for integration tests
jest.setTimeout(30000);

// Custom error messages for better debugging
const originalConsoleError = console.error;
console.error = (...args) => {
  // Filter out known non-critical errors
  const message = args[0];
  if (typeof message === 'string') {
    // Suppress React warnings in tests
    if (message.includes('Warning: ReactDOM.render is deprecated')) {
      return;
    }

    // Suppress other known warnings
    if (message.includes('Warning: componentWillMount has been renamed')) {
      return;
    }
  }

  originalConsoleError.apply(console, args);
};

// Configure test environment for Obsidian specifics
beforeAll(() => {
  // Set up global environment variables for testing
  process.env.NODE_ENV = 'test';
  process.env.OBSIDIAN_TESTING = 'true';
});

// Global mock for Obsidian app reference
global.app = {
  vault: null,
  workspace: null,
  metadataCache: null,
  fileManager: null,
  // Will be populated by test framework
};

// Export helpful testing utilities
export {
  jestMatchers,
  enableMockTimers,
  enableNetworkMocking
};