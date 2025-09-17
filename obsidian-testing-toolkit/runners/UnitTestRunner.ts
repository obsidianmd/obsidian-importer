/**
 * Obsidian Testing Toolkit - Unit Test Runner
 *
 * Specialized test runner for unit testing Obsidian plugins.
 * Provides isolated testing environment for individual components.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { ObsidianTestFramework, TestEnvironment } from '../core/ObsidianTestFramework';
import { MockPlugin } from '../core/MockPlugin';
import { enableMockTimers, disableMockTimers } from '../utils/AsyncTestHelpers';
import { enableNetworkMocking, disableNetworkMocking } from '../utils/NetworkMocking';
import { freezeTime, unfreezeTime } from '../utils/DateMocking';

/**
 * Unit test configuration
 */
export interface UnitTestConfig {
  /** Enable automatic setup/teardown */
  autoSetup?: boolean;
  /** Mock timers automatically */
  mockTimers?: boolean;
  /** Mock network requests */
  mockNetwork?: boolean;
  /** Freeze time during tests */
  freezeTime?: boolean;
  /** Isolation level */
  isolation?: 'none' | 'basic' | 'strict';
  /** Test timeout in milliseconds */
  timeout?: number;
  /** Plugin configuration for testing */
  plugin?: {
    manifest?: any;
    settings?: any;
  };
}

/**
 * Test suite definition
 */
export interface TestSuite {
  name: string;
  setup?: () => Promise<void> | void;
  teardown?: () => Promise<void> | void;
  beforeEach?: () => Promise<void> | void;
  afterEach?: () => Promise<void> | void;
  tests: TestCase[];
}

/**
 * Test case definition
 */
export interface TestCase {
  name: string;
  test: (env: TestEnvironment) => Promise<void> | void;
  timeout?: number;
  skip?: boolean;
  only?: boolean;
  config?: Partial<UnitTestConfig>;
}

/**
 * Test result
 */
export interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: Error;
  logs?: string[];
}

/**
 * Suite result
 */
export interface SuiteResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  tests: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * Unit test runner for Obsidian plugins
 */
export class UnitTestRunner {
  private framework: ObsidianTestFramework;
  private config: UnitTestConfig;
  private currentEnvironment: TestEnvironment | null = null;
  private suites: TestSuite[] = [];
  private results: SuiteResult[] = [];

  constructor(config: UnitTestConfig = {}) {
    this.config = {
      autoSetup: true,
      mockTimers: false,
      mockNetwork: false,
      freezeTime: false,
      isolation: 'basic',
      timeout: 5000,
      ...config
    };

    this.framework = new ObsidianTestFramework({
      features: {
        vault: true,
        workspace: true,
        metadataCache: true,
        fileSystem: true,
        plugins: true
      },
      plugin: this.config.plugin
    });
  }

  /**
   * Add a test suite
   */
  public describe(name: string, definition: (suite: TestSuiteBuilder) => void): void {
    const builder = new TestSuiteBuilder(name);
    definition(builder);
    this.suites.push(builder.build());
  }

  /**
   * Run all test suites
   */
  public async run(): Promise<SuiteResult[]> {
    this.results = [];

    for (const suite of this.suites) {
      const result = await this.runSuite(suite);
      this.results.push(result);
    }

    return this.results;
  }

  /**
   * Run a specific test suite
   */
  public async runSuite(suite: TestSuite): Promise<SuiteResult> {
    const startTime = Date.now();
    const testResults: TestResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    console.log(`\n🏃 Running suite: ${suite.name}`);

    try {
      // Suite setup
      if (suite.setup) {
        await suite.setup();
      }

      // Check for 'only' tests
      const onlyTests = suite.tests.filter(test => test.only);
      const testsToRun = onlyTests.length > 0 ? onlyTests : suite.tests;

      // Run each test
      for (const test of testsToRun) {
        if (test.skip) {
          testResults.push({
            name: test.name,
            status: 'skipped',
            duration: 0
          });
          skipped++;
          console.log(`  ⏭️  ${test.name} (skipped)`);
          continue;
        }

        const testResult = await this.runTest(test, suite);
        testResults.push(testResult);

        if (testResult.status === 'passed') {
          passed++;
          console.log(`  ✅ ${test.name} (${testResult.duration}ms)`);
        } else {
          failed++;
          console.log(`  ❌ ${test.name} (${testResult.duration}ms)`);
          if (testResult.error) {
            console.log(`     ${testResult.error.message}`);
          }
        }
      }

      // Suite teardown
      if (suite.teardown) {
        await suite.teardown();
      }

    } catch (error) {
      failed++;
      testResults.push({
        name: 'Suite Setup/Teardown',
        status: 'failed',
        duration: 0,
        error: error as Error
      });
    }

    const duration = Date.now() - startTime;
    const status = failed > 0 ? 'failed' : skipped === testResults.length ? 'skipped' : 'passed';

    const result: SuiteResult = {
      name: suite.name,
      status,
      duration,
      tests: testResults,
      passed,
      failed,
      skipped
    };

    console.log(`📊 Suite ${suite.name}: ${passed} passed, ${failed} failed, ${skipped} skipped (${duration}ms)`);

    return result;
  }

  /**
   * Run a single test
   */
  private async runTest(test: TestCase, suite: TestSuite): Promise<TestResult> {
    const startTime = Date.now();
    const testConfig = { ...this.config, ...test.config };
    const timeout = test.timeout || testConfig.timeout!;

    try {
      // Setup test environment
      await this.setupTestEnvironment(testConfig);

      // Suite beforeEach
      if (suite.beforeEach) {
        await suite.beforeEach();
      }

      // Run test with timeout
      await this.runWithTimeout(async () => {
        await test.test(this.currentEnvironment!);
      }, timeout);

      // Suite afterEach
      if (suite.afterEach) {
        await suite.afterEach();
      }

      // Teardown test environment
      await this.teardownTestEnvironment(testConfig);

      return {
        name: test.name,
        status: 'passed',
        duration: Date.now() - startTime
      };

    } catch (error) {
      // Ensure cleanup even on failure
      await this.teardownTestEnvironment(testConfig);

      return {
        name: test.name,
        status: 'failed',
        duration: Date.now() - startTime,
        error: error as Error
      };
    }
  }

  /**
   * Setup test environment based on configuration
   */
  private async setupTestEnvironment(config: UnitTestConfig): Promise<void> {
    if (config.autoSetup) {
      this.currentEnvironment = await this.framework.setup();
    }

    if (config.mockTimers) {
      enableMockTimers();
    }

    if (config.mockNetwork) {
      enableNetworkMocking();
    }

    if (config.freezeTime) {
      freezeTime();
    }

    // Apply isolation settings
    if (config.isolation === 'strict') {
      // In strict isolation, mock more global objects
      this.mockGlobalObjects();
    }
  }

  /**
   * Teardown test environment
   */
  private async teardownTestEnvironment(config: UnitTestConfig): Promise<void> {
    if (config.freezeTime) {
      unfreezeTime();
    }

    if (config.mockNetwork) {
      disableNetworkMocking();
    }

    if (config.mockTimers) {
      disableMockTimers();
    }

    if (config.autoSetup && this.currentEnvironment) {
      await this.framework.teardown();
      this.currentEnvironment = null;
    }

    // Restore global objects if they were mocked
    if (config.isolation === 'strict') {
      this.restoreGlobalObjects();
    }
  }

  /**
   * Run function with timeout
   */
  private async runWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Test timed out after ${timeout}ms`));
      }, timeout);

      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Mock global objects for strict isolation
   */
  private mockGlobalObjects(): void {
    // Mock console methods to capture logs
    const originalConsole = { ...console };
    (global as any)._originalConsole = originalConsole;

    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();

    // Mock localStorage if available
    if (typeof localStorage !== 'undefined') {
      (global as any)._originalLocalStorage = localStorage;
      (global as any).localStorage = {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
        length: 0,
        key: jest.fn()
      };
    }
  }

  /**
   * Restore global objects
   */
  private restoreGlobalObjects(): void {
    if ((global as any)._originalConsole) {
      Object.assign(console, (global as any)._originalConsole);
      delete (global as any)._originalConsole;
    }

    if ((global as any)._originalLocalStorage) {
      (global as any).localStorage = (global as any)._originalLocalStorage;
      delete (global as any)._originalLocalStorage;
    }
  }

  /**
   * Get test results summary
   */
  public getSummary(): {
    totalSuites: number;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  } {
    const totalSuites = this.results.length;
    let totalTests = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let duration = 0;

    for (const suite of this.results) {
      totalTests += suite.tests.length;
      passed += suite.passed;
      failed += suite.failed;
      skipped += suite.skipped;
      duration += suite.duration;
    }

    return {
      totalSuites,
      totalTests,
      passed,
      failed,
      skipped,
      duration
    };
  }

  /**
   * Print test results
   */
  public printResults(): void {
    const summary = this.getSummary();

    console.log('\n📋 Test Results Summary:');
    console.log(`Suites: ${summary.totalSuites}`);
    console.log(`Tests:  ${summary.totalTests}`);
    console.log(`✅ Passed: ${summary.passed}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`⏭️  Skipped: ${summary.skipped}`);
    console.log(`⏱️  Duration: ${summary.duration}ms`);

    if (summary.failed > 0) {
      console.log('\n❌ Failed Tests:');
      for (const suite of this.results) {
        for (const test of suite.tests) {
          if (test.status === 'failed') {
            console.log(`  ${suite.name} > ${test.name}`);
            if (test.error) {
              console.log(`    ${test.error.message}`);
            }
          }
        }
      }
    }
  }
}

/**
 * Test suite builder for fluent API
 */
export class TestSuiteBuilder {
  private suite: Partial<TestSuite>;

  constructor(name: string) {
    this.suite = {
      name,
      tests: []
    };
  }

  /**
   * Add setup hook
   */
  public setup(fn: () => Promise<void> | void): this {
    this.suite.setup = fn;
    return this;
  }

  /**
   * Add teardown hook
   */
  public teardown(fn: () => Promise<void> | void): this {
    this.suite.teardown = fn;
    return this;
  }

  /**
   * Add beforeEach hook
   */
  public beforeEach(fn: () => Promise<void> | void): this {
    this.suite.beforeEach = fn;
    return this;
  }

  /**
   * Add afterEach hook
   */
  public afterEach(fn: () => Promise<void> | void): this {
    this.suite.afterEach = fn;
    return this;
  }

  /**
   * Add a test case
   */
  public it(name: string, test: (env: TestEnvironment) => Promise<void> | void, config?: Partial<UnitTestConfig>): this {
    this.suite.tests!.push({ name, test, config });
    return this;
  }

  /**
   * Add a test case that should be skipped
   */
  public xit(name: string, test: (env: TestEnvironment) => Promise<void> | void): this {
    this.suite.tests!.push({ name, test, skip: true });
    return this;
  }

  /**
   * Add a test case that should be the only one to run
   */
  public fit(name: string, test: (env: TestEnvironment) => Promise<void> | void, config?: Partial<UnitTestConfig>): this {
    this.suite.tests!.push({ name, test, only: true, config });
    return this;
  }

  /**
   * Build the test suite
   */
  public build(): TestSuite {
    return this.suite as TestSuite;
  }
}

/**
 * Convenience functions for unit testing
 */

/**
 * Create a unit test runner with default configuration
 */
export function createUnitTestRunner(config?: UnitTestConfig): UnitTestRunner {
  return new UnitTestRunner(config);
}

/**
 * Run a single test with automatic setup/teardown
 */
export async function runSingleTest(
  name: string,
  test: (env: TestEnvironment) => Promise<void> | void,
  config?: UnitTestConfig
): Promise<TestResult> {
  const runner = createUnitTestRunner(config);

  runner.describe('Single Test', suite => {
    suite.it(name, test);
  });

  const results = await runner.run();
  return results[0].tests[0];
}

/**
 * Test a plugin component in isolation
 */
export async function testPluginComponent<T>(
  componentFactory: (env: TestEnvironment) => T,
  test: (component: T, env: TestEnvironment) => Promise<void> | void,
  config?: UnitTestConfig
): Promise<TestResult> {
  return runSingleTest('Plugin Component Test', async (env) => {
    const component = componentFactory(env);
    await test(component, env);
  }, config);
}

/**
 * Test vault operations
 */
export async function testVaultOperation(
  operation: (env: TestEnvironment) => Promise<void> | void,
  config?: UnitTestConfig
): Promise<TestResult> {
  return runSingleTest('Vault Operation Test', operation, {
    autoSetup: true,
    isolation: 'basic',
    ...config
  });
}

/**
 * Test with mocked time
 */
export async function testWithMockedTime(
  test: (env: TestEnvironment) => Promise<void> | void,
  config?: UnitTestConfig
): Promise<TestResult> {
  return runSingleTest('Mocked Time Test', test, {
    freezeTime: true,
    mockTimers: true,
    ...config
  });
}

/**
 * Test with mocked network
 */
export async function testWithMockedNetwork(
  test: (env: TestEnvironment) => Promise<void> | void,
  config?: UnitTestConfig
): Promise<TestResult> {
  return runSingleTest('Mocked Network Test', test, {
    mockNetwork: true,
    ...config
  });
}