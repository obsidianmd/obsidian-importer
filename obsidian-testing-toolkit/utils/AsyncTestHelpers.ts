/**
 * Obsidian Testing Toolkit - Async Test Helpers
 *
 * Utilities for testing asynchronous operations, event handling,
 * and time-dependent code in Obsidian plugins.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

/**
 * Wait for a specific condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeout?: number;
    interval?: number;
    timeoutMessage?: string;
  } = {}
): Promise<void> {
  const {
    timeout = 5000,
    interval = 100,
    timeoutMessage = 'Condition was not met within timeout'
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await sleep(interval);
  }

  throw new Error(timeoutMessage);
}

/**
 * Wait for an event to be emitted
 */
export async function waitForEvent(
  emitter: any,
  eventName: string,
  options: {
    timeout?: number;
    filter?: (data: any) => boolean;
  } = {}
): Promise<any> {
  const { timeout = 5000, filter } = options;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Event '${eventName}' was not emitted within ${timeout}ms`));
    }, timeout);

    const cleanup = () => {
      clearTimeout(timeoutId);
      emitter.removeListener(eventName, handler);
    };

    const handler = (data: any) => {
      if (!filter || filter(data)) {
        cleanup();
        resolve(data);
      }
    };

    emitter.on(eventName, handler);
  });
}

/**
 * Wait for multiple events in sequence
 */
export async function waitForEventSequence(
  emitter: any,
  eventNames: string[],
  options: {
    timeout?: number;
    timeoutPerEvent?: number;
  } = {}
): Promise<any[]> {
  const {
    timeout = 10000,
    timeoutPerEvent = timeout / eventNames.length
  } = options;

  const results: any[] = [];
  const startTime = Date.now();

  for (const eventName of eventNames) {
    const remainingTime = timeout - (Date.now() - startTime);
    if (remainingTime <= 0) {
      throw new Error(`Timeout waiting for event sequence at '${eventName}'`);
    }

    const eventTimeout = Math.min(timeoutPerEvent, remainingTime);
    const result = await waitForEvent(emitter, eventName, { timeout: eventTimeout });
    results.push(result);
  }

  return results;
}

/**
 * Wait for DOM element to appear (if running in browser environment)
 */
export async function waitForElement(
  selector: string,
  options: {
    timeout?: number;
    interval?: number;
    container?: Element;
  } = {}
): Promise<Element> {
  const {
    timeout = 5000,
    interval = 100,
    container = document
  } = options;

  return waitFor(
    () => {
      const element = container.querySelector(selector);
      return element !== null;
    },
    {
      timeout,
      interval,
      timeoutMessage: `Element '${selector}' was not found within ${timeout}ms`
    }
  ).then(() => container.querySelector(selector)!);
}

/**
 * Wait for element to be removed from DOM
 */
export async function waitForElementRemoval(
  selector: string,
  options: {
    timeout?: number;
    interval?: number;
    container?: Element;
  } = {}
): Promise<void> {
  const {
    timeout = 5000,
    interval = 100,
    container = document
  } = options;

  return waitFor(
    () => container.querySelector(selector) === null,
    {
      timeout,
      interval,
      timeoutMessage: `Element '${selector}' was not removed within ${timeout}ms`
    }
  );
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a promise that resolves after next tick
 */
export function nextTick(): Promise<void> {
  return new Promise(resolve => {
    if (typeof process !== 'undefined' && process.nextTick) {
      process.nextTick(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Debounce function for testing
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): T & { cancel: () => void; flush: () => void } {
  let timeoutId: any;
  let lastArgs: Parameters<T>;

  const debounced = (...args: Parameters<T>) => {
    lastArgs = args;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(null, args), delay);
  } as T & { cancel: () => void; flush: () => void };

  debounced.cancel = () => {
    clearTimeout(timeoutId);
  };

  debounced.flush = () => {
    clearTimeout(timeoutId);
    if (lastArgs) {
      func.apply(null, lastArgs);
    }
  };

  return debounced;
}

/**
 * Throttle function for testing
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): T & { cancel: () => void } {
  let lastCall = 0;
  let timeoutId: any;

  const throttled = (...args: Parameters<T>) => {
    const now = Date.now();

    if (now - lastCall >= delay) {
      lastCall = now;
      func.apply(null, args);
    } else {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        func.apply(null, args);
      }, delay - (now - lastCall));
    }
  } as T & { cancel: () => void };

  throttled.cancel = () => {
    clearTimeout(timeoutId);
  };

  return throttled;
}

/**
 * Create a deferred promise
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: resolve!,
    reject: reject!
  };
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    shouldRetry?: (error: any) => boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 100,
    maxDelay = 5000,
    backoffFactor = 2,
    shouldRetry = () => true
  } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt - 1), maxDelay);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Race multiple promises with timeout
 */
export async function raceWithTimeout<T>(
  promises: Promise<T>[],
  timeout: number,
  timeoutMessage?: string
): Promise<T> {
  const timeoutPromise = sleep(timeout).then(() => {
    throw new Error(timeoutMessage || `Operation timed out after ${timeout}ms`);
  });

  return Promise.race([...promises, timeoutPromise]);
}

/**
 * Execute promises in sequence (one after another)
 */
export async function sequence<T>(
  operations: (() => Promise<T>)[]
): Promise<T[]> {
  const results: T[] = [];

  for (const operation of operations) {
    const result = await operation();
    results.push(result);
  }

  return results;
}

/**
 * Execute promises with limited concurrency
 */
export async function concurrent<T>(
  operations: (() => Promise<T>)[],
  concurrency: number = 3
): Promise<T[]> {
  const results: T[] = new Array(operations.length);
  const executing: Promise<void>[] = [];

  for (let i = 0; i < operations.length; i++) {
    const promise = operations[i]().then(result => {
      results[i] = result;
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      const completedIndex = executing.findIndex(p =>
        p === promise || (p as any).isSettled
      );
      if (completedIndex !== -1) {
        executing.splice(completedIndex, 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Mock timer utilities
 */
export class MockTimer {
  private timers: Map<number, { callback: Function; timeout: number; interval?: boolean }> = new Map();
  private nextId: number = 1;
  private currentTime: number = 0;

  public setTimeout(callback: Function, timeout: number): number {
    const id = this.nextId++;
    this.timers.set(id, { callback, timeout: this.currentTime + timeout });
    return id;
  }

  public setInterval(callback: Function, interval: number): number {
    const id = this.nextId++;
    this.timers.set(id, {
      callback,
      timeout: this.currentTime + interval,
      interval: true
    });
    return id;
  }

  public clearTimeout(id: number): void {
    this.timers.delete(id);
  }

  public clearInterval(id: number): void {
    this.timers.delete(id);
  }

  public tick(ms: number): void {
    this.currentTime += ms;

    const toExecute: Array<{ id: number; timer: any }> = [];

    for (const [id, timer] of this.timers) {
      if (timer.timeout <= this.currentTime) {
        toExecute.push({ id, timer });
      }
    }

    for (const { id, timer } of toExecute) {
      timer.callback();

      if (timer.interval) {
        // Reschedule interval
        this.timers.set(id, {
          ...timer,
          timeout: this.currentTime + (timer.timeout - (this.currentTime - ms))
        });
      } else {
        // Remove one-time timeout
        this.timers.delete(id);
      }
    }
  }

  public getCurrentTime(): number {
    return this.currentTime;
  }

  public getPendingTimers(): number {
    return this.timers.size;
  }

  public clear(): void {
    this.timers.clear();
    this.currentTime = 0;
    this.nextId = 1;
  }
}

/**
 * Global mock timer instance
 */
let globalMockTimer: MockTimer | null = null;

/**
 * Enable mock timers
 */
export function enableMockTimers(): MockTimer {
  if (globalMockTimer) {
    return globalMockTimer;
  }

  globalMockTimer = new MockTimer();

  // Override global timer functions
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  global.setTimeout = ((callback: any, timeout: any) =>
    globalMockTimer!.setTimeout(callback, timeout)) as any;
  global.clearTimeout = (id: any) => globalMockTimer!.clearTimeout(id);
  global.setInterval = ((callback: any, interval: any) =>
    globalMockTimer!.setInterval(callback, interval)) as any;
  global.clearInterval = (id: any) => globalMockTimer!.clearInterval(id);

  // Store originals for restoration
  (globalMockTimer as any)._originals = {
    setTimeout: originalSetTimeout,
    clearTimeout: originalClearTimeout,
    setInterval: originalSetInterval,
    clearInterval: originalClearInterval
  };

  return globalMockTimer;
}

/**
 * Disable mock timers and restore originals
 */
export function disableMockTimers(): void {
  if (!globalMockTimer) {
    return;
  }

  const originals = (globalMockTimer as any)._originals;
  if (originals) {
    global.setTimeout = originals.setTimeout;
    global.clearTimeout = originals.clearTimeout;
    global.setInterval = originals.setInterval;
    global.clearInterval = originals.clearInterval;
  }

  globalMockTimer = null;
}

/**
 * Advance mock timers by specified time
 */
export function advanceTimers(ms: number): void {
  if (globalMockTimer) {
    globalMockTimer.tick(ms);
  }
}

/**
 * Run all pending timers
 */
export function runAllTimers(): void {
  if (globalMockTimer) {
    // Run timers in chunks to avoid infinite loops
    let iterations = 0;
    const maxIterations = 1000;

    while (globalMockTimer.getPendingTimers() > 0 && iterations < maxIterations) {
      globalMockTimer.tick(1);
      iterations++;
    }

    if (iterations >= maxIterations) {
      throw new Error('runAllTimers exceeded maximum iterations - possible infinite timer loop');
    }
  }
}

/**
 * Event emitter for testing async events
 */
export class TestEventEmitter {
  private listeners: Map<string, Function[]> = new Map();
  private onceListeners: Map<string, Function[]> = new Map();

  public on(event: string, listener: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  public once(event: string, listener: Function): void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, []);
    }
    this.onceListeners.get(event)!.push(listener);
  }

  public off(event: string, listener: Function): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }

    const onceListeners = this.onceListeners.get(event);
    if (onceListeners) {
      const index = onceListeners.indexOf(listener);
      if (index !== -1) {
        onceListeners.splice(index, 1);
      }
    }
  }

  public emit(event: string, ...args: any[]): void {
    // Regular listeners
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in event listener for '${event}':`, error);
        }
      });
    }

    // Once listeners
    const onceListeners = this.onceListeners.get(event);
    if (onceListeners) {
      const listenersToCall = [...onceListeners];
      this.onceListeners.set(event, []);

      listenersToCall.forEach(listener => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in once event listener for '${event}':`, error);
        }
      });
    }
  }

  public removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  public listenerCount(event: string): number {
    const regular = this.listeners.get(event)?.length || 0;
    const once = this.onceListeners.get(event)?.length || 0;
    return regular + once;
  }
}