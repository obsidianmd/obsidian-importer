/**
 * Obsidian Testing Toolkit - End-to-End Test Runner
 *
 * End-to-end test runner for complete user journey testing.
 * Simulates real user interactions with the plugin in a full Obsidian environment.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { ObsidianTestFramework, TestEnvironment } from '../core/ObsidianTestFramework';
import { MockWorkspaceLeaf } from '../core/MockWorkspace';
import { MockTFile } from '../core/MockVault';
import { waitFor, waitForEvent } from '../utils/AsyncTestHelpers';
import { createSnapshotTester } from '../utils/SnapshotTesting';

/**
 * E2E test configuration
 */
export interface E2ETestConfig {
  /** Test environment setup */
  environment?: 'desktop' | 'mobile' | 'both';
  /** Vault template to use */
  vaultTemplate?: string;
  /** Enable screenshot capture */
  screenshots?: boolean;
  /** Enable video recording */
  videoRecording?: boolean;
  /** Test timeout in milliseconds */
  timeout?: number;
  /** User interaction speed */
  interactionSpeed?: 'fast' | 'normal' | 'slow';
  /** Wait for animations */
  waitForAnimations?: boolean;
  /** Plugins to test */
  plugins?: string[];
  /** Test data configuration */
  testData?: {
    generateSampleVault?: boolean;
    importFromFile?: string;
    customDataSet?: string;
  };
}

/**
 * User journey definition
 */
export interface UserJourney {
  name: string;
  description?: string;
  environment?: 'desktop' | 'mobile';
  setup?: (env: TestEnvironment) => Promise<void> | void;
  teardown?: (env: TestEnvironment) => Promise<void> | void;
  actions: UserAction[];
  assertions?: JourneyAssertion[];
}

/**
 * User action definition
 */
export interface UserAction {
  type: 'click' | 'type' | 'key' | 'hover' | 'drag' | 'wait' | 'navigate' | 'command' | 'custom';
  name: string;
  selector?: string;
  text?: string;
  key?: string;
  coordinates?: { x: number; y: number };
  command?: string;
  duration?: number;
  waitFor?: {
    condition?: () => boolean | Promise<boolean>;
    event?: { emitter: any; event: string };
    element?: string;
    timeout?: number;
  };
  custom?: (env: TestEnvironment) => Promise<void> | void;
}

/**
 * Journey assertion
 */
export interface JourneyAssertion {
  name: string;
  verify: (env: TestEnvironment) => Promise<void> | void;
  timeout?: number;
}

/**
 * User action result
 */
export interface ActionResult {
  name: string;
  type: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: Error;
  screenshot?: string;
}

/**
 * Journey test result
 */
export interface JourneyResult {
  name: string;
  environment: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  actions: ActionResult[];
  assertions: ActionResult[];
  error?: Error;
  screenshots?: string[];
  video?: string;
  performance?: E2EPerformanceMetrics;
}

/**
 * E2E performance metrics
 */
export interface E2EPerformanceMetrics {
  startupTime: number;
  firstInteraction: number;
  totalActions: number;
  avgActionTime: number;
  memoryUsage?: {
    initial: number;
    peak: number;
    final: number;
  };
}

/**
 * End-to-end test runner for Obsidian plugins
 */
export class E2ETestRunner {
  private framework: ObsidianTestFramework;
  private config: E2ETestConfig;
  private journeys: UserJourney[] = [];
  private results: JourneyResult[] = [];
  private snapshotTester = createSnapshotTester();
  private screenshotCounter = 0;

  constructor(config: E2ETestConfig = {}) {
    this.config = {
      environment: 'desktop',
      screenshots: false,
      videoRecording: false,
      timeout: 60000,
      interactionSpeed: 'normal',
      waitForAnimations: true,
      plugins: [],
      testData: {
        generateSampleVault: true
      },
      ...config
    };

    this.framework = new ObsidianTestFramework({
      vault: {
        name: 'e2e-test-vault',
        adapter: 'memory'
      },
      testData: this.config.testData,
      mobile: {
        enabled: this.config.environment === 'mobile'
      },
      performance: {
        enableProfiling: true,
        memoryTracking: true
      }
    });
  }

  /**
   * Add a user journey test
   */
  public journey(name: string, definition: (journey: UserJourneyBuilder) => void): void {
    const builder = new UserJourneyBuilder(name);
    definition(builder);
    this.journeys.push(builder.build());
  }

  /**
   * Run all user journeys
   */
  public async run(): Promise<JourneyResult[]> {
    this.results = [];

    console.log('🚀 Starting End-to-End Tests');

    // Test on different environments if configured
    const environments = this.config.environment === 'both' ? ['desktop', 'mobile'] : [this.config.environment!];

    for (const environment of environments) {
      for (const journey of this.journeys) {
        if (journey.environment && journey.environment !== environment) {
          continue; // Skip if journey is environment-specific
        }

        const result = await this.runJourney(journey, environment);
        this.results.push(result);
      }
    }

    return this.results;
  }

  /**
   * Run a specific user journey
   */
  public async runJourney(journey: UserJourney, environment: string = 'desktop'): Promise<JourneyResult> {
    const startTime = Date.now();
    const actionResults: ActionResult[] = [];
    const assertionResults: ActionResult[] = [];
    let screenshots: string[] = [];

    console.log(`\n🎭 Running journey: ${journey.name} (${environment})`);
    if (journey.description) {
      console.log(`   ${journey.description}`);
    }

    let testEnvironment: TestEnvironment | null = null;
    let performance: E2EPerformanceMetrics | null = null;

    try {
      // Setup environment
      const setupStart = Date.now();
      testEnvironment = await this.setupEnvironment(environment);
      const startupTime = Date.now() - setupStart;

      // Run journey setup
      if (journey.setup) {
        await journey.setup(testEnvironment);
      }

      // Initialize performance tracking
      this.framework.startProfiling('journey-execution');
      const firstInteractionStart = Date.now();

      // Take initial screenshot
      if (this.config.screenshots) {
        const screenshot = await this.takeScreenshot(testEnvironment, 'initial');
        screenshots.push(screenshot);
      }

      // Execute all actions
      let firstInteraction = 0;
      for (let i = 0; i < journey.actions.length; i++) {
        const action = journey.actions[i];
        const actionResult = await this.executeAction(action, testEnvironment);
        actionResults.push(actionResult);

        if (i === 0) {
          firstInteraction = Date.now() - firstInteractionStart;
        }

        // Take screenshot after each action if enabled
        if (this.config.screenshots && actionResult.status === 'passed') {
          const screenshot = await this.takeScreenshot(testEnvironment, `action-${i + 1}-${action.name}`);
          screenshots.push(screenshot);
          actionResult.screenshot = screenshot;
        }

        if (actionResult.status === 'failed') {
          break; // Stop on first failure
        }
      }

      // Run assertions
      if (journey.assertions) {
        for (const assertion of journey.assertions) {
          const assertionResult = await this.runAssertion(assertion, testEnvironment);
          assertionResults.push(assertionResult);
        }
      }

      // Run journey teardown
      if (journey.teardown) {
        await journey.teardown(testEnvironment);
      }

      // Calculate performance metrics
      if (this.config.environment !== 'mobile') { // Performance metrics may not be available in mobile mode
        const totalActions = actionResults.length;
        const totalActionTime = actionResults.reduce((sum, action) => sum + action.duration, 0);

        performance = {
          startupTime,
          firstInteraction,
          totalActions,
          avgActionTime: totalActions > 0 ? totalActionTime / totalActions : 0
        };
      }

      const status = [...actionResults, ...assertionResults].some(r => r.status === 'failed') ? 'failed' : 'passed';

      return {
        name: journey.name,
        environment,
        status,
        duration: Date.now() - startTime,
        actions: actionResults,
        assertions: assertionResults,
        screenshots,
        performance
      };

    } catch (error) {
      // Ensure cleanup on failure
      if (testEnvironment) {
        await this.teardownEnvironment();
      }

      return {
        name: journey.name,
        environment,
        status: 'failed',
        duration: Date.now() - startTime,
        actions: actionResults,
        assertions: assertionResults,
        error: error as Error,
        screenshots,
        performance
      };
    } finally {
      if (testEnvironment) {
        await this.teardownEnvironment();
      }
    }
  }

  /**
   * Execute a user action
   */
  private async executeAction(action: UserAction, environment: TestEnvironment): Promise<ActionResult> {
    const startTime = Date.now();

    console.log(`  🎯 ${action.name}`);

    try {
      // Apply interaction speed delay
      await this.applyInteractionDelay();

      // Execute the action based on type
      switch (action.type) {
        case 'click':
          await this.executeClickAction(action, environment);
          break;
        case 'type':
          await this.executeTypeAction(action, environment);
          break;
        case 'key':
          await this.executeKeyAction(action, environment);
          break;
        case 'hover':
          await this.executeHoverAction(action, environment);
          break;
        case 'drag':
          await this.executeDragAction(action, environment);
          break;
        case 'wait':
          await this.executeWaitAction(action, environment);
          break;
        case 'navigate':
          await this.executeNavigateAction(action, environment);
          break;
        case 'command':
          await this.executeCommandAction(action, environment);
          break;
        case 'custom':
          if (action.custom) {
            await action.custom(environment);
          }
          break;
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      // Handle wait conditions
      if (action.waitFor) {
        await this.handleWaitCondition(action.waitFor);
      }

      // Wait for animations if configured
      if (this.config.waitForAnimations) {
        await this.waitForAnimations();
      }

      const duration = Date.now() - startTime;
      console.log(`     ✅ Completed in ${duration}ms`);

      return {
        name: action.name,
        type: action.type,
        status: 'passed',
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`     ❌ Failed after ${duration}ms: ${(error as Error).message}`);

      return {
        name: action.name,
        type: action.type,
        status: 'failed',
        duration,
        error: error as Error
      };
    }
  }

  /**
   * Execute click action
   */
  private async executeClickAction(action: UserAction, environment: TestEnvironment): Promise<void> {
    if (action.selector) {
      // Simulate clicking on an element by selector
      this.simulateElementClick(action.selector);
    } else if (action.coordinates) {
      // Simulate clicking at coordinates
      this.simulateCoordinateClick(action.coordinates);
    } else {
      throw new Error('Click action requires either selector or coordinates');
    }
  }

  /**
   * Execute type action
   */
  private async executeTypeAction(action: UserAction, environment: TestEnvironment): Promise<void> {
    if (!action.text) {
      throw new Error('Type action requires text');
    }

    // Get active editor or create one
    const activeLeaf = environment.workspace.getActiveLeaf();
    if (activeLeaf && activeLeaf.view && activeLeaf.view.editor) {
      const editor = activeLeaf.view.editor;

      // Simulate typing character by character
      for (const char of action.text) {
        editor.insert(char);
        await this.applyTypingDelay();
      }
    } else {
      throw new Error('No active editor found for typing');
    }
  }

  /**
   * Execute key action
   */
  private async executeKeyAction(action: UserAction, environment: TestEnvironment): Promise<void> {
    if (!action.key) {
      throw new Error('Key action requires key specification');
    }

    // Simulate key press
    this.simulateKeyPress(action.key);
  }

  /**
   * Execute command action
   */
  private async executeCommandAction(action: UserAction, environment: TestEnvironment): Promise<void> {
    if (!action.command) {
      throw new Error('Command action requires command ID');
    }

    const success = environment.app.commands.executeCommandById(action.command);
    if (!success) {
      throw new Error(`Command not found or failed: ${action.command}`);
    }
  }

  /**
   * Execute navigate action
   */
  private async executeNavigateAction(action: UserAction, environment: TestEnvironment): Promise<void> {
    if (!action.text) {
      throw new Error('Navigate action requires file path');
    }

    const file = environment.vault.getFileByPath(action.text);
    if (!file) {
      throw new Error(`File not found: ${action.text}`);
    }

    const leaf = environment.workspace.getActiveLeaf() || environment.workspace.createLeafBySplit();
    await leaf.openFile(file);
  }

  /**
   * Execute wait action
   */
  private async executeWaitAction(action: UserAction, environment: TestEnvironment): Promise<void> {
    const duration = action.duration || 1000;
    await new Promise(resolve => setTimeout(resolve, duration));
  }

  /**
   * Execute hover action (simulated)
   */
  private async executeHoverAction(action: UserAction, environment: TestEnvironment): Promise<void> {
    // Hover actions are simulated since we don't have real DOM
    console.log(`Simulating hover on ${action.selector || 'coordinates'}`);
  }

  /**
   * Execute drag action (simulated)
   */
  private async executeDragAction(action: UserAction, environment: TestEnvironment): Promise<void> {
    // Drag actions are simulated since we don't have real DOM
    console.log(`Simulating drag action`);
  }

  /**
   * Run journey assertion
   */
  private async runAssertion(assertion: JourneyAssertion, environment: TestEnvironment): Promise<ActionResult> {
    const startTime = Date.now();
    const timeout = assertion.timeout || this.config.timeout!;

    console.log(`  🔍 ${assertion.name}`);

    try {
      await this.runWithTimeout(async () => {
        await assertion.verify(environment);
      }, timeout);

      const duration = Date.now() - startTime;
      console.log(`     ✅ Assertion passed in ${duration}ms`);

      return {
        name: assertion.name,
        type: 'assertion',
        status: 'passed',
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`     ❌ Assertion failed after ${duration}ms: ${(error as Error).message}`);

      return {
        name: assertion.name,
        type: 'assertion',
        status: 'failed',
        duration,
        error: error as Error
      };
    }
  }

  /**
   * Setup test environment
   */
  private async setupEnvironment(environment: string): Promise<TestEnvironment> {
    // Configure for mobile or desktop
    const isMobile = environment === 'mobile';

    const testEnv = await this.framework.setup();

    if (isMobile) {
      testEnv.app.setMobileMode(true);
    }

    // Load plugins if specified
    if (this.config.plugins) {
      for (const pluginId of this.config.plugins) {
        testEnv.app.loadPlugin(pluginId);
      }
    }

    // Generate test data if configured
    if (this.config.testData?.generateSampleVault) {
      if (this.config.vaultTemplate) {
        await testEnv.testData.generateVaultFromTemplate(this.config.vaultTemplate);
      } else {
        await this.generateDefaultTestData(testEnv);
      }
    }

    // Trigger layout ready
    testEnv.workspace.triggerLayoutReady();

    return testEnv;
  }

  /**
   * Teardown test environment
   */
  private async teardownEnvironment(): Promise<void> {
    await this.framework.teardown();
  }

  /**
   * Generate default test data
   */
  private async generateDefaultTestData(environment: TestEnvironment): Promise<void> {
    // Create sample structure for E2E testing
    await environment.testData.createProjectStructure('E2E Test Project');
    await environment.testData.createDailyNotesStructure(new Date(), 5);
    await environment.testData.createKnowledgeBase(['Testing', 'Documentation', 'Automation']);
  }

  /**
   * Simulate element click
   */
  private simulateElementClick(selector: string): void {
    // In a real E2E environment, this would interact with actual DOM elements
    console.log(`Simulating click on element: ${selector}`);

    // Emit a mock click event for testing purposes
    if (typeof document !== 'undefined') {
      const element = document.querySelector(selector);
      if (element) {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }
  }

  /**
   * Simulate coordinate click
   */
  private simulateCoordinateClick(coordinates: { x: number; y: number }): void {
    console.log(`Simulating click at coordinates: ${coordinates.x}, ${coordinates.y}`);
  }

  /**
   * Simulate key press
   */
  private simulateKeyPress(key: string): void {
    console.log(`Simulating key press: ${key}`);

    if (typeof document !== 'undefined') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
  }

  /**
   * Take screenshot (mocked)
   */
  private async takeScreenshot(environment: TestEnvironment, name: string): Promise<string> {
    const filename = `screenshot-${++this.screenshotCounter}-${name.replace(/\s+/g, '-')}.png`;
    console.log(`📸 Taking screenshot: ${filename}`);

    // In a real environment, this would capture actual screenshots
    return filename;
  }

  /**
   * Handle wait conditions
   */
  private async handleWaitCondition(waitFor: UserAction['waitFor']): Promise<void> {
    if (!waitFor) return;

    const timeout = waitFor.timeout || 5000;

    if (waitFor.condition) {
      await waitFor(waitFor.condition, { timeout });
    }

    if (waitFor.event) {
      await waitForEvent(waitFor.event.emitter, waitFor.event.event, { timeout });
    }

    if (waitFor.element && typeof document !== 'undefined') {
      await waitFor(() => {
        return document.querySelector(waitFor.element!) !== null;
      }, { timeout });
    }
  }

  /**
   * Apply interaction speed delay
   */
  private async applyInteractionDelay(): Promise<void> {
    const delays = {
      fast: 50,
      normal: 100,
      slow: 200
    };

    const delay = delays[this.config.interactionSpeed!];
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Apply typing delay between characters
   */
  private async applyTypingDelay(): Promise<void> {
    const delay = this.config.interactionSpeed === 'fast' ? 10 :
                 this.config.interactionSpeed === 'slow' ? 50 : 25;

    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Wait for animations to complete
   */
  private async waitForAnimations(): Promise<void> {
    // Default animation duration in Obsidian
    await new Promise(resolve => setTimeout(resolve, 300));
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
    totalJourneys: number;
    totalActions: number;
    passed: number;
    failed: number;
    duration: number;
    avgJourneyDuration: number;
  } {
    const totalJourneys = this.results.length;
    let totalActions = 0;
    let passed = 0;
    let failed = 0;
    let duration = 0;

    for (const result of this.results) {
      totalActions += result.actions.length + result.assertions.length;
      passed += [...result.actions, ...result.assertions].filter(a => a.status === 'passed').length;
      failed += [...result.actions, ...result.assertions].filter(a => a.status === 'failed').length;
      duration += result.duration;
    }

    return {
      totalJourneys,
      totalActions,
      passed,
      failed,
      duration,
      avgJourneyDuration: totalJourneys > 0 ? duration / totalJourneys : 0
    };
  }

  /**
   * Print test results
   */
  public printResults(): void {
    const summary = this.getSummary();

    console.log('\n🎯 End-to-End Test Results:');
    console.log(`Journeys: ${summary.totalJourneys}`);
    console.log(`Actions:  ${summary.totalActions}`);
    console.log(`✅ Passed: ${summary.passed}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`⏱️  Duration: ${summary.duration}ms`);
    console.log(`📈 Avg Journey Duration: ${Math.round(summary.avgJourneyDuration)}ms`);

    if (this.config.screenshots) {
      const totalScreenshots = this.results.reduce((sum, r) => sum + (r.screenshots?.length || 0), 0);
      console.log(`📸 Screenshots captured: ${totalScreenshots}`);
    }

    if (summary.failed > 0) {
      console.log('\n❌ Failed Journeys:');
      for (const result of this.results) {
        if (result.status === 'failed') {
          console.log(`  ${result.name} (${result.environment})`);
          const failedActions = [...result.actions, ...result.assertions].filter(a => a.status === 'failed');
          for (const action of failedActions) {
            console.log(`    > ${action.name}: ${action.error?.message}`);
          }
        }
      }
    }
  }
}

/**
 * User journey builder for fluent API
 */
export class UserJourneyBuilder {
  private journey: Partial<UserJourney>;

  constructor(name: string) {
    this.journey = {
      name,
      actions: [],
      assertions: []
    };
  }

  /**
   * Set journey description
   */
  public description(desc: string): this {
    this.journey.description = desc;
    return this;
  }

  /**
   * Set environment requirement
   */
  public environment(env: 'desktop' | 'mobile'): this {
    this.journey.environment = env;
    return this;
  }

  /**
   * Add setup hook
   */
  public setup(fn: (env: TestEnvironment) => Promise<void> | void): this {
    this.journey.setup = fn;
    return this;
  }

  /**
   * Add teardown hook
   */
  public teardown(fn: (env: TestEnvironment) => Promise<void> | void): this {
    this.journey.teardown = fn;
    return this;
  }

  /**
   * Add click action
   */
  public click(name: string, selector: string): this {
    this.journey.actions!.push({ type: 'click', name, selector });
    return this;
  }

  /**
   * Add type action
   */
  public type(name: string, text: string): this {
    this.journey.actions!.push({ type: 'type', name, text });
    return this;
  }

  /**
   * Add key action
   */
  public key(name: string, key: string): this {
    this.journey.actions!.push({ type: 'key', name, key });
    return this;
  }

  /**
   * Add command action
   */
  public command(name: string, command: string): this {
    this.journey.actions!.push({ type: 'command', name, command });
    return this;
  }

  /**
   * Add navigation action
   */
  public navigate(name: string, filePath: string): this {
    this.journey.actions!.push({ type: 'navigate', name, text: filePath });
    return this;
  }

  /**
   * Add wait action
   */
  public wait(name: string, duration: number): this {
    this.journey.actions!.push({ type: 'wait', name, duration });
    return this;
  }

  /**
   * Add custom action
   */
  public custom(name: string, action: (env: TestEnvironment) => Promise<void> | void): this {
    this.journey.actions!.push({ type: 'custom', name, custom: action });
    return this;
  }

  /**
   * Add assertion
   */
  public assert(name: string, verify: (env: TestEnvironment) => Promise<void> | void): this {
    this.journey.assertions!.push({ name, verify });
    return this;
  }

  /**
   * Build the journey
   */
  public build(): UserJourney {
    return this.journey as UserJourney;
  }
}

/**
 * Convenience functions for E2E testing
 */

/**
 * Create an E2E test runner with default configuration
 */
export function createE2ETestRunner(config?: E2ETestConfig): E2ETestRunner {
  return new E2ETestRunner(config);
}

/**
 * Test a simple user workflow
 */
export async function testUserWorkflow(
  name: string,
  workflow: (journey: UserJourneyBuilder) => void,
  config?: E2ETestConfig
): Promise<JourneyResult> {
  const runner = createE2ETestRunner(config);

  runner.journey(name, workflow);

  const results = await runner.run();
  return results[0];
}

/**
 * Test plugin installation and activation
 */
export async function testPluginActivation(
  pluginId: string,
  config?: E2ETestConfig
): Promise<JourneyResult> {
  return testUserWorkflow('Plugin Activation', journey => {
    journey
      .custom('Load Plugin', async (env) => {
        env.app.loadPlugin(pluginId);
      })
      .assert('Plugin is Active', async (env) => {
        if (!env.app.isPluginLoaded(pluginId)) {
          throw new Error(`Plugin ${pluginId} is not loaded`);
        }
      });
  }, config);
}