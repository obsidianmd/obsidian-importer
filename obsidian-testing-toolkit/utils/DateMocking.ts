/**
 * Obsidian Testing Toolkit - Date Mocking Utilities
 *
 * Utilities for mocking and controlling time and date in tests.
 * Essential for testing time-dependent functionality in Obsidian plugins.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

/**
 * Mock date configuration
 */
export interface MockDateConfig {
  /** Starting date for the mock */
  startDate?: Date | string | number;
  /** Whether to auto-advance time */
  autoAdvance?: boolean;
  /** Auto-advance interval in milliseconds */
  autoAdvanceInterval?: number;
  /** Mock specific date methods */
  mockMethods?: ('now' | 'getTime' | 'toISOString' | 'getDate' | 'getMonth' | 'getFullYear')[];
}

/**
 * Mock date implementation
 */
export class MockDate {
  private static originalDate: DateConstructor = Date;
  private static currentTime: number;
  private static autoAdvanceTimer: any = null;
  private static isMocked: boolean = false;
  private static config: MockDateConfig = {};

  /**
   * Enable date mocking
   */
  public static enable(config: MockDateConfig = {}): void {
    if (MockDate.isMocked) {
      MockDate.disable();
    }

    MockDate.config = {
      startDate: new Date(),
      autoAdvance: false,
      autoAdvanceInterval: 1000,
      mockMethods: ['now', 'getTime', 'toISOString'],
      ...config
    };

    MockDate.currentTime = new Date(MockDate.config.startDate!).getTime();
    MockDate.isMocked = true;

    // Replace global Date
    (global as any).Date = MockDate.createMockDateConstructor();

    // Setup auto-advance if enabled
    if (MockDate.config.autoAdvance) {
      MockDate.enableAutoAdvance();
    }
  }

  /**
   * Disable date mocking and restore original Date
   */
  public static disable(): void {
    if (!MockDate.isMocked) {
      return;
    }

    MockDate.disableAutoAdvance();
    (global as any).Date = MockDate.originalDate;
    MockDate.isMocked = false;
  }

  /**
   * Set the current mocked time
   */
  public static set(date: Date | string | number): void {
    if (!MockDate.isMocked) {
      throw new Error('MockDate is not enabled. Call MockDate.enable() first.');
    }

    MockDate.currentTime = new Date(date).getTime();
  }

  /**
   * Advance time by specified milliseconds
   */
  public static advance(ms: number): void {
    if (!MockDate.isMocked) {
      throw new Error('MockDate is not enabled. Call MockDate.enable() first.');
    }

    MockDate.currentTime += ms;
  }

  /**
   * Advance time by specified time units
   */
  public static advanceBy(amount: number, unit: 'ms' | 'seconds' | 'minutes' | 'hours' | 'days'): void {
    const multipliers = {
      ms: 1,
      seconds: 1000,
      minutes: 60 * 1000,
      hours: 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000
    };

    const ms = amount * multipliers[unit];
    MockDate.advance(ms);
  }

  /**
   * Get current mocked time
   */
  public static now(): number {
    if (!MockDate.isMocked) {
      return MockDate.originalDate.now();
    }

    return MockDate.currentTime;
  }

  /**
   * Reset to original start time
   */
  public static reset(): void {
    if (!MockDate.isMocked) {
      return;
    }

    MockDate.currentTime = new Date(MockDate.config.startDate!).getTime();
  }

  /**
   * Enable auto-advance functionality
   */
  private static enableAutoAdvance(): void {
    MockDate.disableAutoAdvance();

    MockDate.autoAdvanceTimer = setInterval(() => {
      MockDate.advance(MockDate.config.autoAdvanceInterval!);
    }, MockDate.config.autoAdvanceInterval);
  }

  /**
   * Disable auto-advance functionality
   */
  private static disableAutoAdvance(): void {
    if (MockDate.autoAdvanceTimer) {
      clearInterval(MockDate.autoAdvanceTimer);
      MockDate.autoAdvanceTimer = null;
    }
  }

  /**
   * Create mock Date constructor
   */
  private static createMockDateConstructor(): DateConstructor {
    const MockDateConstructor = function(...args: any[]) {
      if (args.length === 0) {
        return new MockDate.originalDate(MockDate.currentTime);
      }
      return new MockDate.originalDate(...args);
    } as any;

    // Copy static methods from original Date
    Object.setPrototypeOf(MockDateConstructor, MockDate.originalDate);
    Object.getOwnPropertyNames(MockDate.originalDate).forEach(name => {
      if (name !== 'prototype' && name !== 'length' && name !== 'name') {
        MockDateConstructor[name] = MockDate.originalDate[name as keyof DateConstructor];
      }
    });

    // Override specific methods based on config
    if (MockDate.config.mockMethods?.includes('now')) {
      MockDateConstructor.now = () => MockDate.currentTime;
    }

    MockDateConstructor.prototype = MockDate.originalDate.prototype;

    return MockDateConstructor;
  }
}

/**
 * Utility functions for common date operations
 */
export class DateTestUtils {
  /**
   * Create a date in the past
   */
  public static daysAgo(days: number, fromDate: Date = new Date()): Date {
    const date = new Date(fromDate);
    date.setDate(date.getDate() - days);
    return date;
  }

  /**
   * Create a date in the future
   */
  public static daysFromNow(days: number, fromDate: Date = new Date()): Date {
    const date = new Date(fromDate);
    date.setDate(date.getDate() + days);
    return date;
  }

  /**
   * Create a date at the start of the day
   */
  public static startOfDay(date: Date = new Date()): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Create a date at the end of the day
   */
  public static endOfDay(date: Date = new Date()): Date {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  /**
   * Create a date at the start of the month
   */
  public static startOfMonth(date: Date = new Date()): Date {
    const result = new Date(date);
    result.setDate(1);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Create a date at the end of the month
   */
  public static endOfMonth(date: Date = new Date()): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + 1, 0);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  /**
   * Generate a series of dates
   */
  public static generateDateSeries(
    start: Date,
    end: Date,
    interval: { amount: number; unit: 'days' | 'hours' | 'minutes' }
  ): Date[] {
    const dates: Date[] = [];
    const current = new Date(start);

    const multipliers = {
      days: 24 * 60 * 60 * 1000,
      hours: 60 * 60 * 1000,
      minutes: 60 * 1000
    };

    const step = interval.amount * multipliers[interval.unit];

    while (current <= end) {
      dates.push(new Date(current));
      current.setTime(current.getTime() + step);
    }

    return dates;
  }

  /**
   * Format date for Obsidian daily notes
   */
  public static formatForDailyNote(date: Date, format: string = 'YYYY-MM-DD'): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day);
  }

  /**
   * Parse date from Obsidian daily note filename
   */
  public static parseFromDailyNote(filename: string): Date | null {
    const patterns = [
      /^(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
      /^(\d{2})-(\d{2})-(\d{4})/, // MM-DD-YYYY
      /^(\d{4})(\d{2})(\d{2})/, // YYYYMMDD
    ];

    for (const pattern of patterns) {
      const match = filename.match(pattern);
      if (match) {
        const [, part1, part2, part3] = match;

        // Try different date formats
        const formats = [
          [part1, part2, part3], // YYYY-MM-DD
          [part3, part1, part2], // MM-DD-YYYY
        ];

        for (const [year, month, day] of formats) {
          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }
    }

    return null;
  }
}

/**
 * Time zone utilities for testing
 */
export class TimeZoneTestUtils {
  private static originalTimezone: string | undefined;

  /**
   * Mock a specific timezone
   */
  public static setTimezone(timezone: string): void {
    TimeZoneTestUtils.originalTimezone = process.env.TZ;
    process.env.TZ = timezone;
  }

  /**
   * Restore original timezone
   */
  public static restoreTimezone(): void {
    if (TimeZoneTestUtils.originalTimezone !== undefined) {
      process.env.TZ = TimeZoneTestUtils.originalTimezone;
      TimeZoneTestUtils.originalTimezone = undefined;
    } else {
      delete process.env.TZ;
    }
  }

  /**
   * Test with different timezones
   */
  public static async withTimezone<T>(timezone: string, callback: () => Promise<T>): Promise<T> {
    TimeZoneTestUtils.setTimezone(timezone);
    try {
      return await callback();
    } finally {
      TimeZoneTestUtils.restoreTimezone();
    }
  }
}

/**
 * Convenience functions for testing
 */

/**
 * Mock date for the duration of a test
 */
export async function withMockedDate<T>(
  date: Date | string | number,
  callback: () => Promise<T>
): Promise<T> {
  MockDate.enable({ startDate: date });
  try {
    return await callback();
  } finally {
    MockDate.disable();
  }
}

/**
 * Test with auto-advancing time
 */
export async function withAutoAdvancingTime<T>(
  config: MockDateConfig,
  callback: () => Promise<T>
): Promise<T> {
  MockDate.enable({ autoAdvance: true, ...config });
  try {
    return await callback();
  } finally {
    MockDate.disable();
  }
}

/**
 * Freeze time for testing
 */
export function freezeTime(date?: Date | string | number): void {
  MockDate.enable({
    startDate: date || new Date(),
    autoAdvance: false
  });
}

/**
 * Unfreeze time
 */
export function unfreezeTime(): void {
  MockDate.disable();
}

/**
 * Travel through time (advance by specified amount)
 */
export function timeTravel(amount: number, unit: 'ms' | 'seconds' | 'minutes' | 'hours' | 'days'): void {
  MockDate.advanceBy(amount, unit);
}

/**
 * Jump to specific date
 */
export function travelTo(date: Date | string | number): void {
  MockDate.set(date);
}

/**
 * Common date constants for testing
 */
export const TestDates = {
  // Common test dates
  NEW_YEAR_2023: new Date('2023-01-01T00:00:00.000Z'),
  NEW_YEAR_2024: new Date('2024-01-01T00:00:00.000Z'),
  CHRISTMAS_2023: new Date('2023-12-25T00:00:00.000Z'),

  // Time boundaries
  UNIX_EPOCH: new Date('1970-01-01T00:00:00.000Z'),

  // Common formats
  ISO_STRING: '2023-01-01T00:00:00.000Z',
  DATE_ONLY: '2023-01-01',

  // Edge cases
  LEAP_YEAR_DAY: new Date('2024-02-29T00:00:00.000Z'),
  DST_CHANGE: new Date('2023-03-12T02:00:00.000Z'), // US DST change

  // Relative helpers
  today: () => DateTestUtils.startOfDay(),
  yesterday: () => DateTestUtils.daysAgo(1),
  tomorrow: () => DateTestUtils.daysFromNow(1),
  lastWeek: () => DateTestUtils.daysAgo(7),
  nextWeek: () => DateTestUtils.daysFromNow(7),
  lastMonth: () => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date;
  },
  nextMonth: () => {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return date;
  }
};

/**
 * Date assertion helpers
 */
export const DateAssertions = {
  /**
   * Assert that two dates are the same day
   */
  isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  },

  /**
   * Assert that date is within a range
   */
  isWithinRange(date: Date, start: Date, end: Date): boolean {
    return date >= start && date <= end;
  },

  /**
   * Assert that date is approximately equal (within tolerance)
   */
  isApproximately(date1: Date, date2: Date, toleranceMs: number = 1000): boolean {
    return Math.abs(date1.getTime() - date2.getTime()) <= toleranceMs;
  },

  /**
   * Assert that date is in the past
   */
  isInPast(date: Date, referenceDate: Date = new Date()): boolean {
    return date < referenceDate;
  },

  /**
   * Assert that date is in the future
   */
  isInFuture(date: Date, referenceDate: Date = new Date()): boolean {
    return date > referenceDate;
  }
};