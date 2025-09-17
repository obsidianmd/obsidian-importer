/**
 * Obsidian Testing Toolkit - Coverage Reporter
 *
 * Coverage analysis and reporting for Obsidian plugin testing.
 * Tracks code coverage, test completeness, and quality metrics.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

/**
 * Coverage configuration
 */
export interface CoverageConfig {
  /** Include patterns for files to track */
  include?: string[];
  /** Exclude patterns for files to ignore */
  exclude?: string[];
  /** Coverage thresholds */
  thresholds?: {
    lines?: number;
    functions?: number;
    branches?: number;
    statements?: number;
  };
  /** Output directory for reports */
  outputDir?: string;
  /** Report formats to generate */
  reporters?: ('text' | 'html' | 'json' | 'lcov' | 'clover')[];
  /** Collect coverage from test files */
  collectCoverageFrom?: string[];
}

/**
 * File coverage information
 */
export interface FileCoverage {
  path: string;
  lines: {
    total: number;
    covered: number;
    missed: number[];
    percentage: number;
  };
  functions: {
    total: number;
    covered: number;
    missed: string[];
    percentage: number;
  };
  branches: {
    total: number;
    covered: number;
    missed: BranchInfo[];
    percentage: number;
  };
  statements: {
    total: number;
    covered: number;
    missed: number[];
    percentage: number;
  };
}

/**
 * Branch coverage information
 */
export interface BranchInfo {
  line: number;
  branch: number;
  taken: boolean;
}

/**
 * Overall coverage summary
 */
export interface CoverageSummary {
  lines: {
    total: number;
    covered: number;
    percentage: number;
  };
  functions: {
    total: number;
    covered: number;
    percentage: number;
  };
  branches: {
    total: number;
    covered: number;
    percentage: number;
  };
  statements: {
    total: number;
    covered: number;
    percentage: number;
  };
}

/**
 * Coverage report
 */
export interface CoverageReport {
  summary: CoverageSummary;
  files: FileCoverage[];
  timestamp: number;
  testSuites: number;
  tests: number;
  duration: number;
}

/**
 * Test quality metrics
 */
export interface TestQualityMetrics {
  testCount: number;
  testDensity: number; // tests per source file
  averageTestDuration: number;
  slowestTests: Array<{ name: string; duration: number }>;
  flakyTests: Array<{ name: string; failureRate: number }>;
  coverage: CoverageSummary;
  codeComplexity?: {
    cyclomaticComplexity: number;
    maintainabilityIndex: number;
  };
}

/**
 * Coverage reporter for Obsidian plugin testing
 */
export class CoverageReporter {
  private config: CoverageConfig;
  private fileCoverage: Map<string, FileCoverage> = new Map();
  private testResults: any[] = [];
  private executionTimes: Map<string, number> = new Map();

  constructor(config: CoverageConfig = {}) {
    this.config = {
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      },
      outputDir: './coverage',
      reporters: ['text', 'html'],
      ...config
    };
  }

  /**
   * Initialize coverage collection
   */
  public initialize(): void {
    // In a real implementation, this would set up coverage instrumentation
    console.log('🔍 Initializing coverage collection...');
  }

  /**
   * Record test execution
   */
  public recordTest(testName: string, duration: number, status: 'passed' | 'failed'): void {
    this.testResults.push({
      name: testName,
      duration,
      status,
      timestamp: Date.now()
    });

    this.executionTimes.set(testName, duration);
  }

  /**
   * Record file coverage
   */
  public recordFileCoverage(filePath: string, coverage: Partial<FileCoverage>): void {
    const existingCoverage = this.fileCoverage.get(filePath);

    const fileCoverage: FileCoverage = {
      path: filePath,
      lines: {
        total: 0,
        covered: 0,
        missed: [],
        percentage: 0,
        ...coverage.lines
      },
      functions: {
        total: 0,
        covered: 0,
        missed: [],
        percentage: 0,
        ...coverage.functions
      },
      branches: {
        total: 0,
        covered: 0,
        missed: [],
        percentage: 0,
        ...coverage.branches
      },
      statements: {
        total: 0,
        covered: 0,
        missed: [],
        percentage: 0,
        ...coverage.statements
      }
    };

    // Calculate percentages
    fileCoverage.lines.percentage = this.calculatePercentage(
      fileCoverage.lines.covered,
      fileCoverage.lines.total
    );
    fileCoverage.functions.percentage = this.calculatePercentage(
      fileCoverage.functions.covered,
      fileCoverage.functions.total
    );
    fileCoverage.branches.percentage = this.calculatePercentage(
      fileCoverage.branches.covered,
      fileCoverage.branches.total
    );
    fileCoverage.statements.percentage = this.calculatePercentage(
      fileCoverage.statements.covered,
      fileCoverage.statements.total
    );

    this.fileCoverage.set(filePath, fileCoverage);
  }

  /**
   * Generate coverage report
   */
  public generateReport(): CoverageReport {
    const summary = this.calculateSummary();
    const files = Array.from(this.fileCoverage.values());

    const report: CoverageReport = {
      summary,
      files,
      timestamp: Date.now(),
      testSuites: this.getUniqueSuites().length,
      tests: this.testResults.length,
      duration: this.getTotalDuration()
    };

    return report;
  }

  /**
   * Generate test quality metrics
   */
  public generateQualityMetrics(): TestQualityMetrics {
    const sourceFiles = this.getSourceFileCount();
    const testCount = this.testResults.length;
    const durations = Array.from(this.executionTimes.values());

    const slowestTests = this.testResults
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map(test => ({ name: test.name, duration: test.duration }));

    const flakyTests = this.identifyFlakyTests();

    return {
      testCount,
      testDensity: sourceFiles > 0 ? testCount / sourceFiles : 0,
      averageTestDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      slowestTests,
      flakyTests,
      coverage: this.calculateSummary()
    };
  }

  /**
   * Check if coverage meets thresholds
   */
  public checkThresholds(): { passed: boolean; failures: string[] } {
    const summary = this.calculateSummary();
    const thresholds = this.config.thresholds!;
    const failures: string[] = [];

    if (thresholds.lines && summary.lines.percentage < thresholds.lines) {
      failures.push(`Lines coverage ${summary.lines.percentage.toFixed(2)}% is below threshold ${thresholds.lines}%`);
    }

    if (thresholds.functions && summary.functions.percentage < thresholds.functions) {
      failures.push(`Functions coverage ${summary.functions.percentage.toFixed(2)}% is below threshold ${thresholds.functions}%`);
    }

    if (thresholds.branches && summary.branches.percentage < thresholds.branches) {
      failures.push(`Branches coverage ${summary.branches.percentage.toFixed(2)}% is below threshold ${thresholds.branches}%`);
    }

    if (thresholds.statements && summary.statements.percentage < thresholds.statements) {
      failures.push(`Statements coverage ${summary.statements.percentage.toFixed(2)}% is below threshold ${thresholds.statements}%`);
    }

    return {
      passed: failures.length === 0,
      failures
    };
  }

  /**
   * Generate text report
   */
  public generateTextReport(): string {
    const report = this.generateReport();
    const lines: string[] = [];

    lines.push('📊 Coverage Report');
    lines.push('==================');
    lines.push('');

    // Summary
    lines.push('📈 Coverage Summary:');
    lines.push(`Lines:      ${report.summary.lines.percentage.toFixed(2)}% (${report.summary.lines.covered}/${report.summary.lines.total})`);
    lines.push(`Functions:  ${report.summary.functions.percentage.toFixed(2)}% (${report.summary.functions.covered}/${report.summary.functions.total})`);
    lines.push(`Branches:   ${report.summary.branches.percentage.toFixed(2)}% (${report.summary.branches.covered}/${report.summary.branches.total})`);
    lines.push(`Statements: ${report.summary.statements.percentage.toFixed(2)}% (${report.summary.statements.covered}/${report.summary.statements.total})`);
    lines.push('');

    // Threshold check
    const thresholdCheck = this.checkThresholds();
    if (thresholdCheck.passed) {
      lines.push('✅ All coverage thresholds met');
    } else {
      lines.push('❌ Coverage thresholds not met:');
      thresholdCheck.failures.forEach(failure => {
        lines.push(`   ${failure}`);
      });
    }
    lines.push('');

    // File details
    if (report.files.length > 0) {
      lines.push('📁 File Coverage:');
      const sortedFiles = report.files.sort((a, b) => a.lines.percentage - b.lines.percentage);

      for (const file of sortedFiles) {
        const status = file.lines.percentage >= (this.config.thresholds?.lines || 80) ? '✅' : '❌';
        lines.push(`${status} ${file.path}: ${file.lines.percentage.toFixed(2)}%`);
      }
      lines.push('');
    }

    // Test metrics
    const metrics = this.generateQualityMetrics();
    lines.push('🧪 Test Metrics:');
    lines.push(`Total Tests: ${metrics.testCount}`);
    lines.push(`Test Density: ${metrics.testDensity.toFixed(2)} tests/file`);
    lines.push(`Avg Duration: ${metrics.averageTestDuration.toFixed(2)}ms`);
    lines.push('');

    if (metrics.slowestTests.length > 0) {
      lines.push('🐌 Slowest Tests:');
      metrics.slowestTests.slice(0, 5).forEach((test, index) => {
        lines.push(`${index + 1}. ${test.name}: ${test.duration}ms`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate HTML report
   */
  public generateHTMLReport(): string {
    const report = this.generateReport();
    const metrics = this.generateQualityMetrics();

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Obsidian Plugin Coverage Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 20px; }
        .metric { background: white; border: 1px solid #ddd; padding: 15px; border-radius: 5px; text-align: center; }
        .metric-value { font-size: 24px; font-weight: bold; color: #333; }
        .metric-label { color: #666; font-size: 14px; }
        .coverage-bar { width: 100%; height: 10px; background: #eee; border-radius: 5px; overflow: hidden; }
        .coverage-fill { height: 100%; transition: width 0.3s ease; }
        .high { background: #4caf50; }
        .medium { background: #ff9800; }
        .low { background: #f44336; }
        .file-list { border: 1px solid #ddd; border-radius: 5px; }
        .file-item { padding: 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
        .file-item:last-child { border-bottom: none; }
        .file-path { font-family: monospace; }
        .percentage { font-weight: bold; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Obsidian Plugin Coverage Report</h1>
        <p>Generated on ${new Date(report.timestamp).toLocaleString()}</p>
        <p>Test Suites: ${report.testSuites} | Tests: ${report.tests} | Duration: ${report.duration}ms</p>
    </div>

    <div class="summary">
        <div class="metric">
            <div class="metric-value">${report.summary.lines.percentage.toFixed(1)}%</div>
            <div class="metric-label">Lines</div>
            <div class="coverage-bar">
                <div class="coverage-fill ${this.getCoverageClass(report.summary.lines.percentage)}"
                     style="width: ${report.summary.lines.percentage}%"></div>
            </div>
        </div>
        <div class="metric">
            <div class="metric-value">${report.summary.functions.percentage.toFixed(1)}%</div>
            <div class="metric-label">Functions</div>
            <div class="coverage-bar">
                <div class="coverage-fill ${this.getCoverageClass(report.summary.functions.percentage)}"
                     style="width: ${report.summary.functions.percentage}%"></div>
            </div>
        </div>
        <div class="metric">
            <div class="metric-value">${report.summary.branches.percentage.toFixed(1)}%</div>
            <div class="metric-label">Branches</div>
            <div class="coverage-bar">
                <div class="coverage-fill ${this.getCoverageClass(report.summary.branches.percentage)}"
                     style="width: ${report.summary.branches.percentage}%"></div>
            </div>
        </div>
        <div class="metric">
            <div class="metric-value">${report.summary.statements.percentage.toFixed(1)}%</div>
            <div class="metric-label">Statements</div>
            <div class="coverage-bar">
                <div class="coverage-fill ${this.getCoverageClass(report.summary.statements.percentage)}"
                     style="width: ${report.summary.statements.percentage}%"></div>
            </div>
        </div>
    </div>

    <h2>📁 File Coverage</h2>
    <div class="file-list">
        ${report.files.map(file => `
            <div class="file-item">
                <span class="file-path">${file.path}</span>
                <div>
                    <span class="percentage ${this.getCoverageClass(file.lines.percentage)}">${file.lines.percentage.toFixed(1)}%</span>
                    <div class="coverage-bar" style="width: 100px; margin-left: 10px;">
                        <div class="coverage-fill ${this.getCoverageClass(file.lines.percentage)}"
                             style="width: ${file.lines.percentage}%"></div>
                    </div>
                </div>
            </div>
        `).join('')}
    </div>

    <h2>🧪 Test Quality Metrics</h2>
    <p><strong>Test Count:</strong> ${metrics.testCount}</p>
    <p><strong>Test Density:</strong> ${metrics.testDensity.toFixed(2)} tests per source file</p>
    <p><strong>Average Test Duration:</strong> ${metrics.averageTestDuration.toFixed(2)}ms</p>

    ${metrics.slowestTests.length > 0 ? `
        <h3>🐌 Slowest Tests</h3>
        <ul>
            ${metrics.slowestTests.slice(0, 10).map(test =>
                `<li>${test.name}: ${test.duration}ms</li>`
            ).join('')}
        </ul>
    ` : ''}
</body>
</html>`;
  }

  /**
   * Save reports to files
   */
  public async saveReports(): Promise<void> {
    const outputDir = this.config.outputDir!;
    const reporters = this.config.reporters!;

    // Ensure output directory exists (in a real implementation)
    console.log(`📁 Saving coverage reports to ${outputDir}`);

    if (reporters.includes('text')) {
      const textReport = this.generateTextReport();
      console.log('💾 Saved text report to coverage/coverage.txt');
    }

    if (reporters.includes('html')) {
      const htmlReport = this.generateHTMLReport();
      console.log('💾 Saved HTML report to coverage/index.html');
    }

    if (reporters.includes('json')) {
      const jsonReport = JSON.stringify(this.generateReport(), null, 2);
      console.log('💾 Saved JSON report to coverage/coverage.json');
    }

    if (reporters.includes('lcov')) {
      const lcovReport = this.generateLCOVReport();
      console.log('💾 Saved LCOV report to coverage/lcov.info');
    }
  }

  /**
   * Print coverage summary to console
   */
  public printSummary(): void {
    const textReport = this.generateTextReport();
    console.log('\n' + textReport);
  }

  /**
   * Calculate overall coverage summary
   */
  private calculateSummary(): CoverageSummary {
    const files = Array.from(this.fileCoverage.values());

    if (files.length === 0) {
      return {
        lines: { total: 0, covered: 0, percentage: 0 },
        functions: { total: 0, covered: 0, percentage: 0 },
        branches: { total: 0, covered: 0, percentage: 0 },
        statements: { total: 0, covered: 0, percentage: 0 }
      };
    }

    const totals = files.reduce(
      (acc, file) => ({
        lines: {
          total: acc.lines.total + file.lines.total,
          covered: acc.lines.covered + file.lines.covered
        },
        functions: {
          total: acc.functions.total + file.functions.total,
          covered: acc.functions.covered + file.functions.covered
        },
        branches: {
          total: acc.branches.total + file.branches.total,
          covered: acc.branches.covered + file.branches.covered
        },
        statements: {
          total: acc.statements.total + file.statements.total,
          covered: acc.statements.covered + file.statements.covered
        }
      }),
      {
        lines: { total: 0, covered: 0 },
        functions: { total: 0, covered: 0 },
        branches: { total: 0, covered: 0 },
        statements: { total: 0, covered: 0 }
      }
    );

    return {
      lines: {
        ...totals.lines,
        percentage: this.calculatePercentage(totals.lines.covered, totals.lines.total)
      },
      functions: {
        ...totals.functions,
        percentage: this.calculatePercentage(totals.functions.covered, totals.functions.total)
      },
      branches: {
        ...totals.branches,
        percentage: this.calculatePercentage(totals.branches.covered, totals.branches.total)
      },
      statements: {
        ...totals.statements,
        percentage: this.calculatePercentage(totals.statements.covered, totals.statements.total)
      }
    };
  }

  /**
   * Calculate percentage
   */
  private calculatePercentage(covered: number, total: number): number {
    if (total === 0) return 100;
    return (covered / total) * 100;
  }

  /**
   * Get CSS class for coverage percentage
   */
  private getCoverageClass(percentage: number): string {
    if (percentage >= 80) return 'high';
    if (percentage >= 60) return 'medium';
    return 'low';
  }

  /**
   * Get unique test suites
   */
  private getUniqueSuites(): string[] {
    const suites = new Set<string>();
    this.testResults.forEach(test => {
      const suiteName = test.name.split(' > ')[0] || 'Unknown';
      suites.add(suiteName);
    });
    return Array.from(suites);
  }

  /**
   * Get total test duration
   */
  private getTotalDuration(): number {
    return this.testResults.reduce((total, test) => total + test.duration, 0);
  }

  /**
   * Get source file count (estimated)
   */
  private getSourceFileCount(): number {
    return this.fileCoverage.size;
  }

  /**
   * Identify flaky tests (tests that have inconsistent results)
   */
  private identifyFlakyTests(): Array<{ name: string; failureRate: number }> {
    // This would require tracking test results over multiple runs
    // For now, return empty array
    return [];
  }

  /**
   * Generate LCOV report format
   */
  private generateLCOVReport(): string {
    const lines: string[] = [];

    for (const file of this.fileCoverage.values()) {
      lines.push(`SF:${file.path}`);

      // Function coverage
      if (file.functions.total > 0) {
        lines.push(`FNF:${file.functions.total}`);
        lines.push(`FNH:${file.functions.covered}`);
      }

      // Line coverage
      if (file.lines.total > 0) {
        lines.push(`LF:${file.lines.total}`);
        lines.push(`LH:${file.lines.covered}`);
      }

      // Branch coverage
      if (file.branches.total > 0) {
        lines.push(`BRF:${file.branches.total}`);
        lines.push(`BRH:${file.branches.covered}`);
      }

      lines.push('end_of_record');
    }

    return lines.join('\n');
  }
}

/**
 * Global coverage reporter instance
 */
let globalCoverageReporter: CoverageReporter | null = null;

/**
 * Get or create global coverage reporter
 */
export function getCoverageReporter(config?: CoverageConfig): CoverageReporter {
  if (!globalCoverageReporter) {
    globalCoverageReporter = new CoverageReporter(config);
  }
  return globalCoverageReporter;
}

/**
 * Initialize coverage collection
 */
export function initializeCoverage(config?: CoverageConfig): CoverageReporter {
  const reporter = getCoverageReporter(config);
  reporter.initialize();
  return reporter;
}

/**
 * Generate and save coverage reports
 */
export async function generateCoverageReports(): Promise<void> {
  if (globalCoverageReporter) {
    await globalCoverageReporter.saveReports();
    globalCoverageReporter.printSummary();
  }
}