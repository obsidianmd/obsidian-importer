/**
 * Jest configuration for Obsidian Testing Toolkit
 *
 * This configuration provides a complete Jest setup optimized for testing
 * Obsidian plugins with the testing toolkit.
 */

module.exports = {
  // Test environment
  testEnvironment: 'jsdom',

  // Setup files
  setupFilesAfterEnv: [
    '<rootDir>/obsidian-testing-toolkit/config/jest-setup.js'
  ],

  // Module name mapping for toolkit imports
  moduleNameMapper: {
    '^@obsidian-testing-toolkit/(.*)$': '<rootDir>/obsidian-testing-toolkit/$1',
    '^obsidian$': '<rootDir>/obsidian-testing-toolkit/mocks/obsidian.js',
    '^electron$': '<rootDir>/obsidian-testing-toolkit/mocks/electron.js'
  },

  // Test file patterns
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.(test|spec).{js,jsx,ts,tsx}',
    '<rootDir>/tests/**/*.{js,jsx,ts,tsx}'
  ],

  // File extensions to handle
  moduleFileExtensions: [
    'js',
    'jsx',
    'ts',
    'tsx',
    'json',
    'node'
  ],

  // Transform configuration
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: '<rootDir>/obsidian-testing-toolkit/config/tsconfig.test.json'
    }],
    '^.+\\.(js|jsx)$': ['babel-jest', {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        '@babel/preset-typescript'
      ]
    }]
  },

  // Files to ignore during transformation
  transformIgnorePatterns: [
    'node_modules/(?!(obsidian)/)'
  ],

  // Coverage configuration
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/test-utils/**',
    '!src/**/*.test.{js,jsx,ts,tsx}',
    '!src/**/*.spec.{js,jsx,ts,tsx}'
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'json'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },

  // Test timeouts
  testTimeout: 10000,

  // Snapshot configuration
  snapshotFormat: {
    escapeString: true,
    printBasicPrototype: true
  },

  // Mock configuration
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Verbose output
  verbose: true,

  // Test result processors
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: '<rootDir>/test-results',
      outputName: 'junit.xml'
    }]
  ],

  // Global test configuration
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/obsidian-testing-toolkit/config/tsconfig.test.json'
    }
  },

  // Module resolution
  moduleDirectories: [
    'node_modules',
    '<rootDir>/src',
    '<rootDir>/obsidian-testing-toolkit'
  ],

  // Files to run before tests
  globalSetup: '<rootDir>/obsidian-testing-toolkit/config/jest-global-setup.js',
  globalTeardown: '<rootDir>/obsidian-testing-toolkit/config/jest-global-teardown.js',

  // Watch mode configuration
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ],

  // Error handling
  errorOnDeprecated: true,

  // Cache configuration
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',

  // Extensions and patterns to ignore
  watchPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/coverage/',
    '<rootDir>/dist/',
    '<rootDir>/build/'
  ],

  // Test environment options
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons']
  },

  // Preset for Obsidian plugin testing
  displayName: {
    name: 'Obsidian Plugin Tests',
    color: 'blue'
  }
};