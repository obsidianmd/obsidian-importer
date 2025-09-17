/**
 * Obsidian Testing Toolkit - Integration Test Runner
 *
 * Test runner for integration testing of Obsidian plugins.
 * Tests interactions between components and plugin integration with Obsidian.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { ObsidianTestFramework, TestEnvironment } from '../core/ObsidianTestFramework';
import { MockPlugin } from '../core/MockPlugin';
import { TestDataManager } from '../utils/TestDataManager';
import { waitFor, waitForEvent } from '../utils/AsyncTestHelpers';
import { createSnapshotTester } from '../utils/SnapshotTesting';

/**
 * Integration test configuration
 */
export interface IntegrationTestConfig {
  /** Test vault template to use */
  vaultTemplate?: string;
  /** Generate sample data */
  generateSampleData?: boolean;
  /** Number of sample files to create */
  sampleFileCount?: number;
  /** Enable plugin testing */
  enablePlugins?: boolean;
  /** Plugins to load for testing */
  plugins?: { id: string; manifest?: any; settings?: any }[];
  /** Test timeout in milliseconds */
  timeout?: number;
  /** Enable performance monitoring */
  monitorPerformance?: boolean;
  /** Mobile testing mode */
  mobileMode?: boolean;
  /** Network simulation */
  networkConditions?: 'fast' | 'slow' | 'offline';
}

/**
 * Integration test scenario
 */
export interface IntegrationScenario {
  name: string;
  description?: string;
  setup?: (env: TestEnvironment) => Promise<void> | void;
  teardown?: (env: TestEnvironment) => Promise<void> | void;
  steps: IntegrationStep[];
  config?: Partial<IntegrationTestConfig>;
}

/**
 * Integration test step
 */
export interface IntegrationStep {
  name: string;
  action: (env: TestEnvironment) => Promise<void> | void;
  verify?: (env: TestEnvironment) => Promise<void> | void;
  timeout?: number;
  waitFor?: {
    condition?: () => boolean | Promise<boolean>;
    event?: { emitter: any; event: string };
    element?: string;
  };
}

/**
 * Integration test result
 */
export interface IntegrationResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  steps: StepResult[];
  error?: Error;
  performance?: PerformanceMetrics;
  snapshots?: any[];
}

/**
 * Step execution result
 */
export interface StepResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: Error;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  setupTime: number;
  executionTime: number;
  teardownTime: number;
  memoryUsage?: number;
  fileOperations?: {
    reads: number;
    writes: number;
    creates: number;
    deletes: number;
  };
}

/**
 * Integration test runner for Obsidian plugins
 */
export class IntegrationTestRunner {
  private framework: ObsidianTestFramework;
  private config: IntegrationTestConfig;
  private scenarios: IntegrationScenario[] = [];
  private results: IntegrationResult[] = [];
  private snapshotTester = createSnapshotTester();

  constructor(config: IntegrationTestConfig = {}) {
    this.config = {
      generateSampleData: true,
      sampleFileCount: 10,
      enablePlugins: true,
      plugins: [],
      timeout: 30000,
      monitorPerformance: true,
      mobileMode: false,
      networkConditions: 'fast',
      ...config
    };

    this.framework = new ObsidianTestFramework({
      vault: {
        name: 'integration-test-vault',
        adapter: 'memory'
      },
      testData: {
        generateSampleVault: this.config.generateSampleData
      },
      mobile: {
        enabled: this.config.mobileMode
      },
      performance: {
        enableProfiling: this.config.monitorPerformance
      }
    });
  }

  /**
   * Add an integration test scenario
   */
  public scenario(name: string, definition: (scenario: IntegrationScenarioBuilder) => void): void {
    const builder = new IntegrationScenarioBuilder(name);
    definition(builder);
    this.scenarios.push(builder.build());
  }

  /**
   * Run all integration scenarios
   */
  public async run(): Promise<IntegrationResult[]> {
    this.results = [];

    console.log('🚀 Starting Integration Tests');

    for (const scenario of this.scenarios) {
      const result = await this.runScenario(scenario);
      this.results.push(result);
    }

    return this.results;
  }

  /**
   * Run a specific integration scenario
   */
  public async runScenario(scenario: IntegrationScenario): Promise<IntegrationResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    const config = { ...this.config, ...scenario.config };

    console.log(`\n🎬 Running scenario: ${scenario.name}`);
    if (scenario.description) {
      console.log(`   ${scenario.description}`);
    }

    let environment: TestEnvironment | null = null;
    let performance: PerformanceMetrics | null = null;

    try {
      // Setup environment
      const setupStart = Date.now();
      environment = await this.setupEnvironment(config);
      const setupTime = Date.now() - setupStart;

      // Run scenario setup
      if (scenario.setup) {
        await scenario.setup(environment);
      }

      // Setup performance monitoring
      if (config.monitorPerformance) {
        this.framework.startProfiling('scenario-execution');
      }

      const executionStart = Date.now();

      // Run each step
      for (const step of scenario.steps) {
        const stepResult = await this.runStep(step, environment, config);
        stepResults.push(stepResult);

        if (stepResult.status === 'failed') {
          break; // Stop on first failure
        }
      }

      const executionTime = Date.now() - executionStart;

      // Run scenario teardown
      if (scenario.teardown) {
        await scenario.teardown(environment);
      }

      // Collect performance metrics
      if (config.monitorPerformance) {
        const teardownStart = Date.now();
        await this.teardownEnvironment();
        const teardownTime = Date.now() - teardownStart;

        performance = {
          setupTime,
          executionTime,
          teardownTime: teardownTime,
          ...this.framework.getPerformanceMetrics()
        };
      }

      const status = stepResults.some(s => s.status === 'failed') ? 'failed' : 'passed';

      return {
        name: scenario.name,
        status,
        duration: Date.now() - startTime,
        steps: stepResults,
        performance
      };

    } catch (error) {
      // Ensure cleanup on failure
      if (environment) {
        await this.teardownEnvironment();
      }

      return {
        name: scenario.name,
        status: 'failed',
        duration: Date.now() - startTime,
        steps: stepResults,
        error: error as Error,
        performance
      };
    }
  }

  /**
   * Run a single integration step
   */
  private async runStep(
    step: IntegrationStep,
    environment: TestEnvironment,
    config: IntegrationTestConfig
  ): Promise<StepResult> {
    const startTime = Date.now();
    const timeout = step.timeout || config.timeout!;

    console.log(`  🔧 ${step.name}`);

    try {
      // Run step action with timeout
      await this.runWithTimeout(async () => {
        await step.action(environment);

        // Handle wait conditions
        if (step.waitFor) {
          await this.handleWaitCondition(step.waitFor, timeout);
        }

        // Run verification if provided
        if (step.verify) {
          await step.verify(environment);
        }
      }, timeout);

      const duration = Date.now() - startTime;
      console.log(`     ✅ Completed in ${duration}ms`);

      return {
        name: step.name,
        status: 'passed',
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`     ❌ Failed after ${duration}ms: ${(error as Error).message}`);

      return {
        name: step.name,
        status: 'failed',
        duration,
        error: error as Error
      };
    }
  }

  /**
   * Setup test environment
   */
  private async setupEnvironment(config: IntegrationTestConfig): Promise<TestEnvironment> {
    const environment = await this.framework.setup();

    // Generate test data if configured
    if (config.generateSampleData) {
      if (config.vaultTemplate) {
        await environment.testData.generateVaultFromTemplate(config.vaultTemplate);
      } else {
        // Create default sample structure
        await this.createDefaultSampleData(environment, config.sampleFileCount!);
      }
    }

    // Load plugins if configured
    if (config.enablePlugins && config.plugins) {
      for (const pluginConfig of config.plugins) {
        environment.app.loadPlugin(pluginConfig.id, pluginConfig.manifest);
        if (pluginConfig.settings) {
          // Set plugin settings
          const plugin = environment.app.plugins.getPlugin(pluginConfig.id);
          if (plugin) {
            plugin.settings = { ...plugin.settings, ...pluginConfig.settings };
          }
        }
      }
    }

    // Configure mobile mode
    if (config.mobileMode) {
      environment.app.setMobileMode(true);
    }

    // Configure network conditions
    this.configureNetworkConditions(config.networkConditions!);

    return environment;
  }

  /**
   * Teardown test environment
   */
  private async teardownEnvironment(): Promise<void> {
    await this.framework.teardown();
  }

  /**
   * Create default sample data
   */
  private async createDefaultSampleData(environment: TestEnvironment, fileCount: number): Promise<void> {
    // Create basic folder structure
    await environment.vault.createFolder('Daily Notes');
    await environment.vault.createFolder('Projects');
    await environment.vault.createFolder('Archive');

    // Create sample files
    for (let i = 0; i < fileCount; i++) {
      const fileName = `Sample Note ${i + 1}.md`;
      const content = environment.testData.generateRandomMarkdown(3, true, true, true);
      await environment.vault.create(fileName, content);
    }

    // Create some project files
    await environment.testData.createProjectStructure('Test Project');

    // Create daily notes
    await environment.testData.createDailyNotesStructure(new Date(), 7);
  }

  /**
   * Configure network conditions for testing
   */
  private configureNetworkConditions(condition: 'fast' | 'slow' | 'offline'): void {
    // This would integrate with network mocking utilities
    switch (condition) {
      case 'slow':
        // Add artificial delays to network requests
        break;
      case 'offline':
        // Block all network requests
        break;
      case 'fast':
      default:
        // Normal network conditions
        break;
    }
  }

  /**
   * Handle wait conditions
   */
  private async handleWaitCondition(waitFor: IntegrationStep['waitFor'], timeout: number): Promise<void> {
    if (!waitFor) return;

    if (waitFor.condition) {
      await waitFor(waitFor.condition, { timeout });
    }

    if (waitFor.event) {
      await waitForEvent(waitFor.event.emitter, waitFor.event.event, { timeout });
    }

    if (waitFor.element && typeof document !== 'undefined') {
      // Wait for DOM element (if running in browser-like environment)
      await waitFor(() => {
        return document.querySelector(waitFor.element!) !== null;
      }, { timeout });
    }
  }

  /**
   * Run function with timeout
   */
  private async runWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
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
   * Get test results summary
   */
  public getSummary(): {
    totalScenarios: number;
    totalSteps: number;
    passed: number;
    failed: number;
    duration: number;
    avgStepDuration: number;
  } {
    const totalScenarios = this.results.length;
    let totalSteps = 0;
    let passed = 0;
    let failed = 0;
    let duration = 0;

    for (const result of this.results) {
      totalSteps += result.steps.length;
      passed += result.steps.filter(s => s.status === 'passed').length;
      failed += result.steps.filter(s => s.status === 'failed').length;
      duration += result.duration;
    }

    return {
      totalScenarios,
      totalSteps,
      passed,
      failed,
      duration,
      avgStepDuration: totalSteps > 0 ? duration / totalSteps : 0
    };
  }

  /**
   * Print test results
   */
  public printResults(): void {
    const summary = this.getSummary();

    console.log('\n📊 Integration Test Results:');
    console.log(`Scenarios: ${summary.totalScenarios}`);
    console.log(`Steps:     ${summary.totalSteps}`);
    console.log(`✅ Passed: ${summary.passed}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`⏱️  Duration: ${summary.duration}ms`);
    console.log(`📈 Avg Step Duration: ${Math.round(summary.avgStepDuration)}ms`);

    // Print performance metrics if available
    const performanceResults = this.results.filter(r => r.performance);
    if (performanceResults.length > 0) {
      console.log('\n📈 Performance Metrics:');
      const avgSetup = performanceResults.reduce((sum, r) => sum + r.performance!.setupTime, 0) / performanceResults.length;
      const avgExecution = performanceResults.reduce((sum, r) => sum + r.performance!.executionTime, 0) / performanceResults.length;
      const avgTeardown = performanceResults.reduce((sum, r) => sum + r.performance!.teardownTime, 0) / performanceResults.length;

      console.log(`⚙️  Avg Setup: ${Math.round(avgSetup)}ms`);
      console.log(`🏃 Avg Execution: ${Math.round(avgExecution)}ms`);
      console.log(`🧹 Avg Teardown: ${Math.round(avgTeardown)}ms`);
    }

    if (summary.failed > 0) {
      console.log('\n❌ Failed Scenarios:');
      for (const result of this.results) {
        if (result.status === 'failed') {
          console.log(`  ${result.name}`);
          for (const step of result.steps) {
            if (step.status === 'failed') {
              console.log(`    > ${step.name}: ${step.error?.message}`);
            }
          }
        }
      }
    }
  }
}

/**
 * Integration scenario builder for fluent API
 */
export class IntegrationScenarioBuilder {
  private scenario: Partial<IntegrationScenario>;

  constructor(name: string) {
    this.scenario = {
      name,
      steps: []
    };
  }

  /**
   * Set scenario description
   */
  public description(desc: string): this {
    this.scenario.description = desc;
    return this;
  }

  /**
   * Add setup hook
   */
  public setup(fn: (env: TestEnvironment) => Promise<void> | void): this {
    this.scenario.setup = fn;
    return this;
  }

  /**
   * Add teardown hook
   */
  public teardown(fn: (env: TestEnvironment) => Promise<void> | void): this {
    this.scenario.teardown = fn;
    return this;
  }

  /**
   * Add a test step
   */
  public step(name: string, action: (env: TestEnvironment) => Promise<void> | void): this {
    this.scenario.steps!.push({ name, action });
    return this;
  }

  /**
   * Add a step with verification
   */
  public stepWithVerify(
    name: string,
    action: (env: TestEnvironment) => Promise<void> | void,
    verify: (env: TestEnvironment) => Promise<void> | void
  ): this {
    this.scenario.steps!.push({ name, action, verify });
    return this;
  }

  /**
   * Add a step that waits for a condition
   */
  public stepAndWait(
    name: string,
    action: (env: TestEnvironment) => Promise<void> | void,
    waitFor: IntegrationStep['waitFor']
  ): this {
    this.scenario.steps!.push({ name, action, waitFor });
    return this;
  }

  /**
   * Set scenario configuration
   */
  public config(config: Partial<IntegrationTestConfig>): this {
    this.scenario.config = config;
    return this;
  }

  /**
   * Build the scenario
   */
  public build(): IntegrationScenario {
    return this.scenario as IntegrationScenario;
  }
}

/**
 * Convenience functions for integration testing
 */

/**
 * Create an integration test runner with default configuration
 */
export function createIntegrationTestRunner(config?: IntegrationTestConfig): IntegrationTestRunner {
  return new IntegrationTestRunner(config);
}

/**
 * Test a complete plugin workflow
 */
export async function testPluginWorkflow(
  name: string,
  workflow: (env: TestEnvironment) => Promise<void>,
  config?: IntegrationTestConfig
): Promise<IntegrationResult> {
  const runner = createIntegrationTestRunner(config);

  runner.scenario(name, scenario => {
    scenario.step('Execute Workflow', workflow);
  });

  const results = await runner.run();
  return results[0];
}

/**
 * Test plugin interaction with vault
 */
export async function testPluginVaultInteraction(
  pluginId: string,
  interaction: (plugin: MockPlugin, env: TestEnvironment) => Promise<void>,
  config?: IntegrationTestConfig
): Promise<IntegrationResult> {
  const testConfig = {
    enablePlugins: true,
    plugins: [{ id: pluginId }],
    ...config
  };

  return testPluginWorkflow('Plugin Vault Interaction', async (env) => {
    const plugin = env.app.plugins.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not loaded`);
    }
    await interaction(plugin, env);
  }, testConfig);
}

/**
 * Test multi-step user workflow
 */
export async function testUserWorkflow(
  name: string,
  steps: Array<{
    name: string;
    action: (env: TestEnvironment) => Promise<void>;
    verify?: (env: TestEnvironment) => Promise<void>;
  }>,
  config?: IntegrationTestConfig
): Promise<IntegrationResult> {
  const runner = createIntegrationTestRunner(config);

  runner.scenario(name, scenario => {
    for (const step of steps) {
      if (step.verify) {
        scenario.stepWithVerify(step.name, step.action, step.verify);
      } else {
        scenario.step(step.name, step.action);
      }
    }
  });

  const results = await runner.run();
  return results[0];
}