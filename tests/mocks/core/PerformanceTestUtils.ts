// Performance testing utilities

export interface PerformanceMetrics {
  executionTime: number;
  memoryUsage: number;
  peakMemory: number;
  operationsPerSecond: number;
}

export class PerformanceTimer {
  private startTime: number = 0;
  private startMemory: number = 0;
  private peakMemory: number = 0;

  start(): void {
    this.startTime = performance.now();
    this.startMemory = this.getMemoryUsage();
    this.peakMemory = this.startMemory;
  }

  stop(): PerformanceMetrics {
    const endTime = performance.now();
    const endMemory = this.getMemoryUsage();
    const executionTime = endTime - this.startTime;

    return {
      executionTime,
      memoryUsage: endMemory - this.startMemory,
      peakMemory: this.peakMemory - this.startMemory,
      operationsPerSecond: 1000 / executionTime,
    };
  }

  updatePeakMemory(): void {
    const currentMemory = this.getMemoryUsage();
    if (currentMemory > this.peakMemory) {
      this.peakMemory = currentMemory;
    }
  }

  private getMemoryUsage(): number {
    // Mock memory usage - in real Node.js this would use process.memoryUsage()
    return Math.random() * 1024 * 1024; // Random MB value for testing
  }
}

export function generateLargeDataset(size: number): any[] {
  const dataset = [];
  for (let i = 0; i < size; i++) {
    dataset.push({
      id: `item-${i}`,
      title: `Test Item ${i}`,
      content: `This is test content for item ${i}`.repeat(10),
      properties: {
        index: i,
        category: `Category ${i % 10}`,
        status: i % 2 === 0 ? 'active' : 'inactive',
      },
    });
  }
  return dataset;
}

export function measureAsyncOperation<T>(
  operation: () => Promise<T>
): Promise<{ result: T; metrics: PerformanceMetrics }> {
  return new Promise(async (resolve) => {
    const timer = new PerformanceTimer();
    timer.start();

    try {
      const result = await operation();
      timer.updatePeakMemory();
      const metrics = timer.stop();
      resolve({ result, metrics });
    } catch (error) {
      const metrics = timer.stop();
      throw { error, metrics };
    }
  });
}

export function expectPerformance(metrics: PerformanceMetrics, thresholds: {
  maxExecutionTime?: number;
  maxMemoryUsage?: number;
  minOperationsPerSecond?: number;
}): void {
  if (thresholds.maxExecutionTime && metrics.executionTime > thresholds.maxExecutionTime) {
    throw new Error(`Execution time ${metrics.executionTime}ms exceeds threshold ${thresholds.maxExecutionTime}ms`);
  }

  if (thresholds.maxMemoryUsage && metrics.memoryUsage > thresholds.maxMemoryUsage) {
    throw new Error(`Memory usage ${metrics.memoryUsage}MB exceeds threshold ${thresholds.maxMemoryUsage}MB`);
  }

  if (thresholds.minOperationsPerSecond && metrics.operationsPerSecond < thresholds.minOperationsPerSecond) {
    throw new Error(`Operations per second ${metrics.operationsPerSecond} below threshold ${thresholds.minOperationsPerSecond}`);
  }
}

export function createMemoryPressure(sizeMB: number): ArrayBuffer {
  // Create memory pressure for testing
  return new ArrayBuffer(sizeMB * 1024 * 1024);
}

export function simulateNetworkLatency(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}