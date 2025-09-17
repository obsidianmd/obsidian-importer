/**
 * Notion API Client Wrapper
 *
 * A comprehensive, mobile-compatible Notion API client that uses Obsidian's requestUrl
 * for all HTTP requests instead of relying on @notionhq/client's built-in HTTP client.
 * This ensures compatibility across all platforms including mobile devices.
 *
 * Features:
 * - Mobile-compatible HTTP requests using Obsidian's requestUrl
 * - Rate limiting (3 requests/second max)
 * - Exponential backoff retry logic
 * - Support for multiple Notion API versions (2025-09, 2022-06)
 * - Automatic pagination handling
 * - Progress tracking callbacks
 * - Comprehensive error handling
 * - Request queuing to prevent rate limit violations
 * - File download capabilities
 * - Connection testing
 *
 * @author Notion API Importer Team
 * @version 1.0.0
 * @license MIT
 */

import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';

/**
 * Custom error classes for better error handling
 */
export class NotionClientError extends Error {
  public readonly code: string;
  public readonly status?: number;
  public readonly details?: any;

  constructor(message: string, code: string, status?: number, details?: any) {
    super(message);
    this.name = 'NotionClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotionAPIError extends NotionClientError {
  constructor(message: string, status?: number, details?: any) {
    super(message, 'NOTION_API_ERROR', status, details);
  }
}

export class NotionRateLimitError extends NotionClientError {
  constructor(retryAfter?: number) {
    super('Rate limit exceeded', 'RATE_LIMIT_ERROR', 429, { retryAfter });
  }
}

export class NotionAuthError extends NotionClientError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTH_ERROR', 401);
  }
}

export class NotionValidationError extends NotionClientError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

/**
 * Configuration options for the Notion client
 */
export interface NotionClientConfig {
  /** Notion Integration Token */
  auth: string;
  /** API version to use */
  notionVersion?: string;
  /** Base URL for Notion API */
  baseUrl?: string;
  /** Maximum number of retries for failed requests */
  maxRetries?: number;
  /** Initial retry delay in milliseconds */
  retryDelay?: number;
  /** Maximum retry delay in milliseconds */
  maxRetryDelay?: number;
  /** Rate limit: requests per second */
  rateLimit?: number;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<NotionClientConfig> = {
  auth: '',
  notionVersion: '2022-06-28',
  baseUrl: 'https://api.notion.com/v1',
  maxRetries: 3,
  retryDelay: 1000,
  maxRetryDelay: 8000,
  rateLimit: 3,
  timeout: 30000,
  debug: false
};

/**
 * Request queue item for rate limiting
 */
interface QueuedRequest<T = any> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Progress callback interface
 */
export interface ProgressCallback {
  (current: number, total: number, message?: string): void;
}

/**
 * Pagination options for API requests
 */
export interface PaginationOptions {
  /** Maximum number of items to retrieve */
  limit?: number;
  /** Page size for each request */
  pageSize?: number;
  /** Progress callback */
  onProgress?: ProgressCallback;
}

/**
 * Search options
 */
export interface SearchOptions extends PaginationOptions {
  /** Search query string */
  query?: string;
  /** Filter by object type */
  filter?: {
    value: 'page' | 'database';
    property: 'object';
  };
  /** Sort options */
  sort?: {
    direction: 'ascending' | 'descending';
    timestamp: 'last_edited_time';
  };
}

/**
 * Database query options
 */
export interface DatabaseQueryOptions extends PaginationOptions {
  /** Filter conditions */
  filter?: any;
  /** Sort conditions */
  sorts?: any[];
}

/**
 * File download result
 */
export interface FileDownloadResult {
  /** Downloaded file data as ArrayBuffer */
  data: ArrayBuffer;
  /** Original filename */
  filename?: string;
  /** Content type */
  contentType?: string;
  /** File size in bytes */
  size: number;
}

/**
 * Comprehensive Notion API Client with mobile compatibility
 */
export class NotionClient {
  private readonly config: Required<NotionClientConfig>;
  private readonly requestQueue: QueuedRequest[] = [];
  private processingQueue = false;
  private lastRequestTime = 0;

  /**
   * Create a new Notion client instance
   * @param config Client configuration
   */
  constructor(config: NotionClientConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.auth) {
      throw new NotionValidationError('Authentication token is required');
    }

    this.log('Notion client initialized', { version: this.config.notionVersion });
  }

  /**
   * Test connection to Notion API
   * @returns Promise resolving to true if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      const user = await this.getUser('me');
      this.log('Connection test successful', { userId: user.id, type: user.type });
      return user.type === 'bot';
    } catch (error) {
      this.log('Connection test failed', { error });
      return false;
    }
  }

  /**
   * Search workspace for pages and databases
   * @param options Search options
   * @returns Promise resolving to search results
   */
  async search(options: SearchOptions = {}): Promise<any> {
    const {
      query = '',
      filter,
      sort,
      limit,
      pageSize = 100,
      onProgress
    } = options;

    const body: any = {
      query,
      page_size: Math.min(pageSize, 100)
    };

    if (filter) {
      body.filter = filter;
    }

    if (sort) {
      body.sort = sort;
    }

    return this.paginatedRequest(
      'search',
      { method: 'POST', body },
      { limit, onProgress }
    );
  }

  /**
   * Get database metadata
   * @param databaseId Database ID
   * @returns Promise resolving to database object
   */
  async getDatabase(databaseId: string): Promise<any> {
    this.validateId(databaseId, 'database');
    return this.makeRequest(`databases/${databaseId}`);
  }

  /**
   * Query database with filters and sorting
   * @param databaseId Database ID
   * @param options Query options
   * @returns Promise resolving to query results
   */
  async queryDatabase(databaseId: string, options: DatabaseQueryOptions = {}): Promise<any> {
    this.validateId(databaseId, 'database');

    const {
      filter,
      sorts,
      limit,
      pageSize = 100,
      onProgress
    } = options;

    const body: any = {
      page_size: Math.min(pageSize, 100)
    };

    if (filter) {
      body.filter = filter;
    }

    if (sorts) {
      body.sorts = sorts;
    }

    return this.paginatedRequest(
      `databases/${databaseId}/query`,
      { method: 'POST', body },
      { limit, onProgress }
    );
  }

  /**
   * Get page content
   * @param pageId Page ID
   * @returns Promise resolving to page object
   */
  async getPage(pageId: string): Promise<any> {
    this.validateId(pageId, 'page');
    return this.makeRequest(`pages/${pageId}`);
  }

  /**
   * Get block content
   * @param blockId Block ID
   * @returns Promise resolving to block object
   */
  async getBlock(blockId: string): Promise<any> {
    this.validateId(blockId, 'block');
    return this.makeRequest(`blocks/${blockId}`);
  }

  /**
   * Get child blocks with pagination
   * @param blockId Parent block ID
   * @param options Pagination options
   * @returns Promise resolving to child blocks
   */
  async getBlockChildren(blockId: string, options: PaginationOptions = {}): Promise<any> {
    this.validateId(blockId, 'block');

    const {
      limit,
      pageSize = 100,
      onProgress
    } = options;

    return this.paginatedRequest(
      `blocks/${blockId}/children`,
      { method: 'GET' },
      { limit, onProgress, pageSize }
    );
  }

  /**
   * Get user information
   * @param userId User ID or 'me' for current user
   * @returns Promise resolving to user object
   */
  async getUser(userId: string = 'me'): Promise<any> {
    if (userId !== 'me') {
      this.validateId(userId, 'user');
    }
    return this.makeRequest(`users/${userId}`);
  }

  /**
   * Download file from Notion
   * @param url File URL (from Notion API)
   * @returns Promise resolving to file download result
   */
  async downloadFile(url: string): Promise<FileDownloadResult> {
    if (!url) {
      throw new NotionValidationError('File URL is required');
    }

    try {
      this.log('Downloading file', { url });

      const response = await this.executeRequest({
        url,
        method: 'GET',
        throw: false
      });

      if (response.status !== 200) {
        throw new NotionAPIError(
          `Failed to download file: ${response.status}`,
          response.status
        );
      }

      // Extract filename from URL or headers
      let filename: string | undefined;
      const urlParts = new URL(url);
      filename = urlParts.pathname.split('/').pop() || undefined;

      const contentDisposition = response.headers['content-disposition'];
      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match) {
          filename = match[1].replace(/['"]/g, '');
        }
      }

      return {
        data: response.arrayBuffer,
        filename,
        contentType: response.headers['content-type'],
        size: response.arrayBuffer.byteLength
      };
    } catch (error) {
      this.log('File download failed', { url, error });
      throw error instanceof NotionClientError ? error :
        new NotionAPIError(`File download failed: ${error.message}`);
    }
  }

  /**
   * Make a paginated request to the Notion API
   * @param endpoint API endpoint
   * @param requestOptions Request options
   * @param paginationOptions Pagination options
   * @returns Promise resolving to combined results
   */
  private async paginatedRequest(
    endpoint: string,
    requestOptions: Partial<RequestUrlParam> = {},
    paginationOptions: PaginationOptions = {}
  ): Promise<any> {
    const {
      limit,
      pageSize = 100,
      onProgress
    } = paginationOptions;

    const results: any[] = [];
    let hasMore = true;
    let nextCursor: string | undefined;
    let currentCount = 0;

    while (hasMore && (!limit || currentCount < limit)) {
      const body = requestOptions.body ? { ...(requestOptions.body as Record<string, any>) } : {};

      if (nextCursor) {
        body.start_cursor = nextCursor;
      }

      // Adjust page size if we're near the limit
      if (limit) {
        const remaining = limit - currentCount;
        body.page_size = Math.min(pageSize, remaining, 100);
      } else {
        body.page_size = Math.min(pageSize, 100);
      }

      const response = await this.makeRequest(endpoint, {
        ...requestOptions,
        body: requestOptions.method === 'POST' ? JSON.stringify(body) : undefined
      });

      if (response.results) {
        results.push(...response.results);
        currentCount += response.results.length;
      }

      hasMore = response.has_more;
      nextCursor = response.next_cursor;

      // Call progress callback
      if (onProgress) {
        const total = limit || (hasMore ? currentCount + 1 : currentCount);
        onProgress(currentCount, total, `Retrieved ${currentCount} items`);
      }

      // Break if we've reached the limit
      if (limit && currentCount >= limit) {
        break;
      }
    }

    return {
      results: results.slice(0, limit),
      has_more: hasMore,
      next_cursor: nextCursor,
      total_count: currentCount
    };
  }

  /**
   * Make a request to the Notion API with rate limiting and retries
   * @param endpoint API endpoint
   * @param options Request options
   * @returns Promise resolving to API response
   */
  private async makeRequest(endpoint: string, options: Partial<RequestUrlParam> = {}): Promise<any> {
    const url = `${this.config.baseUrl}/${endpoint}`;

    const requestOptions: RequestUrlParam = {
      url,
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.auth}`,
        'Notion-Version': this.config.notionVersion,
        'Content-Type': 'application/json',
        'User-Agent': 'Obsidian-Notion-Importer/1.0.0',
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      throw: false
    };

    return this.executeWithRetry(requestOptions);
  }

  /**
   * Execute request with exponential backoff retry logic
   * @param requestOptions Request options
   * @returns Promise resolving to API response
   */
  private async executeWithRetry(requestOptions: RequestUrlParam): Promise<any> {
    let lastError: Error = new NotionClientError('Unknown error occurred', 'UNKNOWN_ERROR');

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Add to rate-limited queue
        const response = await this.addToQueue(() => this.executeRequest(requestOptions));
        return response;
      } catch (error) {
        lastError = error;

        // Don't retry on certain errors
        if (error instanceof NotionAuthError ||
            error instanceof NotionValidationError ||
            (error instanceof NotionAPIError && error.status && error.status < 500)) {
          throw error;
        }

        // Calculate exponential backoff delay
        if (attempt < this.config.maxRetries) {
          const delay = Math.min(
            this.config.retryDelay * Math.pow(2, attempt),
            this.config.maxRetryDelay
          );

          this.log('Request failed, retrying', {
            attempt: attempt + 1,
            delay,
            error: error.message
          });

          await this.delay(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute HTTP request using Obsidian's requestUrl
   * @param requestOptions Request options
   * @returns Promise resolving to response data
   */
  private async executeRequest(requestOptions: RequestUrlParam): Promise<any> {
    this.log('Making request', {
      method: requestOptions.method,
      url: requestOptions.url
    });

    try {
      const response: RequestUrlResponse = await requestUrl(requestOptions);

      // Handle different response statuses
      if (response.status >= 200 && response.status < 300) {
        return response.json;
      }

      // Handle specific error statuses
      if (response.status === 401) {
        throw new NotionAuthError('Invalid or expired authentication token');
      }

      if (response.status === 403) {
        throw new NotionAuthError('Insufficient permissions for this resource');
      }

      if (response.status === 404) {
        throw new NotionAPIError('Resource not found', response.status);
      }

      if (response.status === 409) {
        throw new NotionAPIError('Conflict - resource has been modified', response.status);
      }

      if (response.status === 429) {
        const retryAfter = response.headers['retry-after'] ?
          parseInt(response.headers['retry-after']) : undefined;
        throw new NotionRateLimitError(retryAfter);
      }

      if (response.status >= 500) {
        throw new NotionAPIError(`Server error: ${response.status}`, response.status);
      }

      // Generic error for other status codes
      let errorMessage = 'Request failed';
      try {
        const errorData = response.json;
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        errorMessage = response.text || errorMessage;
      }

      throw new NotionAPIError(errorMessage, response.status);

    } catch (error) {
      if (error instanceof NotionClientError) {
        throw error;
      }

      // Handle network errors
      throw new NotionAPIError(`Network error: ${error.message}`);
    }
  }

  /**
   * Add request to rate-limited queue
   * @param requestFunction Function that executes the request
   * @returns Promise resolving to request result
   */
  private async addToQueue<T>(requestFunction: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const queueItem: QueuedRequest<T> = {
        execute: requestFunction,
        resolve,
        reject,
        timestamp: Date.now()
      };

      this.requestQueue.push(queueItem);

      if (!this.processingQueue) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the request queue with rate limiting
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }

    this.processingQueue = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      const minInterval = 1000 / this.config.rateLimit;

      // Ensure minimum interval between requests
      if (timeSinceLastRequest < minInterval) {
        await this.delay(minInterval - timeSinceLastRequest);
      }

      // Process batch of requests (respect rate limit)
      const batchSize = Math.min(this.config.rateLimit, this.requestQueue.length);
      const batch = this.requestQueue.splice(0, batchSize);

      this.lastRequestTime = Date.now();

      // Execute batch concurrently
      const promises = batch.map(async (item) => {
        try {
          const result = await item.execute();
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
      });

      await Promise.allSettled(promises);

      // Wait before processing next batch
      if (this.requestQueue.length > 0) {
        await this.delay(1000 / this.config.rateLimit);
      }
    }

    this.processingQueue = false;
  }

  /**
   * Validate ID format (UUID or Notion ID)
   * @param id ID to validate
   * @param type Type of resource for error messages
   */
  private validateId(id: string, type: string): void {
    if (!id || typeof id !== 'string') {
      throw new NotionValidationError(`Invalid ${type} ID: must be a non-empty string`);
    }

    // Remove hyphens for validation
    const cleanId = id.replace(/-/g, '');

    // Check if it's a valid UUID format (32 hex characters)
    if (!/^[0-9a-f]{32}$/i.test(cleanId)) {
      throw new NotionValidationError(`Invalid ${type} ID format: must be a valid UUID`);
    }
  }

  /**
   * Log debug information if debug mode is enabled
   * @param message Log message
   * @param data Additional data to log
   */
  private log(message: string, data?: any): void {
    if (this.config.debug) {
      console.log(`[NotionClient] ${message}`, data || '');
    }
  }

  /**
   * Sleep for specified milliseconds
   * @param ms Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update client configuration
   * @param config New configuration options
   */
  public updateConfig(config: Partial<NotionClientConfig>): void {
    Object.assign(this.config, config);
    this.log('Configuration updated', config);
  }

  /**
   * Get current configuration
   * @returns Current client configuration
   */
  public getConfig(): Required<NotionClientConfig> {
    return { ...this.config };
  }

  /**
   * Clear the request queue (useful for cleanup)
   */
  public clearQueue(): void {
    const queueLength = this.requestQueue.length;
    this.requestQueue.length = 0;
    this.processingQueue = false;
    this.log('Request queue cleared', { clearedRequests: queueLength });
  }

  /**
   * Get queue status information
   * @returns Queue status information
   */
  public getQueueStatus(): {
    queueLength: number;
    processing: boolean;
    lastRequestTime: number;
  } {
    return {
      queueLength: this.requestQueue.length,
      processing: this.processingQueue,
      lastRequestTime: this.lastRequestTime
    };
  }
}

/**
 * Factory function to create a new Notion client
 * @param config Client configuration
 * @returns New Notion client instance
 */
export function createNotionClient(config: NotionClientConfig): NotionClient {
  return new NotionClient(config);
}

/**
 * Utility function to extract Notion ID from URL
 * @param url Notion URL
 * @returns Extracted Notion ID
 */
export function extractNotionId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Extract ID from various Notion URL formats
    const idMatch = pathname.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);

    if (idMatch) {
      // Convert to standard UUID format if needed
      const id = idMatch[1].replace(/-/g, '');
      return `${id.substring(0, 8)}-${id.substring(8, 12)}-${id.substring(12, 16)}-${id.substring(16, 20)}-${id.substring(20)}`;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Type definitions for common Notion API responses
 */
export namespace NotionTypes {
  export interface User {
    object: 'user';
    id: string;
    type: 'person' | 'bot';
    name?: string;
    avatar_url?: string;
    person?: {
      email: string;
    };
    bot?: {
      owner: {
        type: 'user' | 'workspace';
        user?: User;
      };
      workspace_name?: string;
    };
  }

  export interface Database {
    object: 'database';
    id: string;
    created_time: string;
    created_by: User;
    last_edited_time: string;
    last_edited_by: User;
    title: RichText[];
    description: RichText[];
    icon?: Icon;
    cover?: Cover;
    properties: Record<string, Property>;
    parent: Parent;
    url: string;
    archived: boolean;
    is_inline: boolean;
    public_url?: string;
  }

  export interface Page {
    object: 'page';
    id: string;
    created_time: string;
    created_by: User;
    last_edited_time: string;
    last_edited_by: User;
    archived: boolean;
    icon?: Icon;
    cover?: Cover;
    properties: Record<string, Property>;
    parent: Parent;
    url: string;
    public_url?: string;
  }

  export interface Block {
    object: 'block';
    id: string;
    parent: Parent;
    created_time: string;
    created_by: User;
    last_edited_time: string;
    last_edited_by: User;
    archived: boolean;
    has_children: boolean;
    type: string;
    [key: string]: any; // Block-specific properties
  }

  export interface RichText {
    type: 'text' | 'mention' | 'equation';
    text?: {
      content: string;
      link?: {
        url: string;
      };
    };
    mention?: any;
    equation?: {
      expression: string;
    };
    annotations: {
      bold: boolean;
      italic: boolean;
      strikethrough: boolean;
      underline: boolean;
      code: boolean;
      color: string;
    };
    plain_text: string;
    href?: string;
  }

  export interface Property {
    id: string;
    type: string;
    name?: string;
    [key: string]: any; // Property-specific fields
  }

  export interface Parent {
    type: 'database_id' | 'page_id' | 'workspace' | 'block_id';
    database_id?: string;
    page_id?: string;
    block_id?: string;
    workspace?: boolean;
  }

  export interface Icon {
    type: 'emoji' | 'external' | 'file';
    emoji?: string;
    external?: {
      url: string;
    };
    file?: {
      url: string;
      expiry_time: string;
    };
  }

  export interface Cover {
    type: 'external' | 'file';
    external?: {
      url: string;
    };
    file?: {
      url: string;
      expiry_time: string;
    };
  }

  export interface SearchResults {
    object: 'list';
    results: (Page | Database)[];
    next_cursor?: string;
    has_more: boolean;
    type: 'page_or_database';
    page_or_database: {};
  }

  export interface QueryResults {
    object: 'list';
    results: Page[];
    next_cursor?: string;
    has_more: boolean;
    type: 'page';
    page: {};
  }

  export interface BlockResults {
    object: 'list';
    results: Block[];
    next_cursor?: string;
    has_more: boolean;
    type: 'block';
    block: {};
  }
}

// Re-export everything for convenience
export default NotionClient;