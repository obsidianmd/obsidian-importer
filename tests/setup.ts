// Global test setup
import './mocks/obsidian';

// Mock global fetch for tests
global.fetch = jest.fn();

// Mock console methods for cleaner test output
global.console = {
  ...console,
  // Suppress console.log during tests unless needed
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Setup test timeout
jest.setTimeout(10000);

// Global test utilities
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidMarkdown(): R;
      toBeValidYaml(): R;
    }
  }
}

// Custom matchers
expect.extend({
  toBeValidMarkdown(received: string) {
    const isValid = typeof received === 'string' && received.length > 0;
    if (isValid) {
      return {
        message: () => `expected ${received} not to be valid markdown`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be valid markdown`,
        pass: false,
      };
    }
  },

  toBeValidYaml(received: string) {
    try {
      const lines = received.split('\n');
      const hasYamlDelimiters = lines[0] === '---' && lines.includes('---', 1);
      return {
        message: () => `expected ${received} ${hasYamlDelimiters ? 'not ' : ''}to be valid YAML`,
        pass: hasYamlDelimiters,
      };
    } catch (error) {
      return {
        message: () => `expected ${received} to be valid YAML but got error: ${error}`,
        pass: false,
      };
    }
  },
});