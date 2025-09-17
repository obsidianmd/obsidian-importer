/**
 * Obsidian Testing Toolkit - Network Mocking Utilities
 *
 * Mock network requests, including Obsidian's requestUrl function and
 * other HTTP-related functionality for testing plugins.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

/**
 * HTTP methods supported by the mock
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * Request interceptor configuration
 */
export interface RequestInterceptor {
  url: string | RegExp;
  method?: HttpMethod | HttpMethod[];
  response?: NetworkResponse | ((request: MockRequest) => NetworkResponse | Promise<NetworkResponse>);
  delay?: number;
  times?: number; // Number of times this interceptor should be used
  persist?: boolean; // Whether to keep this interceptor active after use
}

/**
 * Network response configuration
 */
export interface NetworkResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  data?: any;
  json?: any;
  text?: string;
  arrayBuffer?: ArrayBuffer;
  error?: Error;
}

/**
 * Mock request object
 */
export interface MockRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: any;
  json?: any;
  timestamp: number;
}

/**
 * Network mocking configuration
 */
export interface NetworkMockConfig {
  baseUrl?: string;
  defaultDelay?: number;
  defaultHeaders?: Record<string, string>;
  logRequests?: boolean;
  throwOnUnmocked?: boolean;
}

/**
 * Network mock manager
 */
export class NetworkMock {
  private interceptors: RequestInterceptor[] = [];
  private requests: MockRequest[] = [];
  private config: NetworkMockConfig;
  private originalRequestUrl: any = null;
  private isEnabled: boolean = false;

  constructor(config: NetworkMockConfig = {}) {
    this.config = {
      defaultDelay: 0,
      defaultHeaders: {},
      logRequests: false,
      throwOnUnmocked: true,
      ...config
    };
  }

  /**
   * Enable network mocking
   */
  public enable(): void {
    if (this.isEnabled) {
      return;
    }

    // Mock Obsidian's requestUrl if available
    if (typeof global !== 'undefined' && (global as any).requestUrl) {
      this.originalRequestUrl = (global as any).requestUrl;
      (global as any).requestUrl = this.createRequestUrlMock();
    }

    // Mock fetch if available
    if (typeof global !== 'undefined' && global.fetch) {
      if (!(global as any)._originalFetch) {
        (global as any)._originalFetch = global.fetch;
      }
      global.fetch = this.createFetchMock();
    }

    this.isEnabled = true;
  }

  /**
   * Disable network mocking and restore original functions
   */
  public disable(): void {
    if (!this.isEnabled) {
      return;
    }

    // Restore original functions
    if (this.originalRequestUrl && typeof global !== 'undefined') {
      (global as any).requestUrl = this.originalRequestUrl;
      this.originalRequestUrl = null;
    }

    if (typeof global !== 'undefined' && (global as any)._originalFetch) {
      global.fetch = (global as any)._originalFetch;
    }

    this.isEnabled = false;
  }

  /**
   * Add a request interceptor
   */
  public intercept(interceptor: RequestInterceptor): void {
    this.interceptors.push({
      persist: true,
      times: Infinity,
      ...interceptor
    });
  }

  /**
   * Add a one-time request interceptor
   */
  public interceptOnce(interceptor: Omit<RequestInterceptor, 'times' | 'persist'>): void {
    this.intercept({
      ...interceptor,
      times: 1,
      persist: false
    });
  }

  /**
   * Mock a GET request
   */
  public get(url: string | RegExp, response: NetworkResponse | ((req: MockRequest) => NetworkResponse)): void {
    this.intercept({ url, method: 'GET', response });
  }

  /**
   * Mock a POST request
   */
  public post(url: string | RegExp, response: NetworkResponse | ((req: MockRequest) => NetworkResponse)): void {
    this.intercept({ url, method: 'POST', response });
  }

  /**
   * Mock a PUT request
   */
  public put(url: string | RegExp, response: NetworkResponse | ((req: MockRequest) => NetworkResponse)): void {
    this.intercept({ url, method: 'PUT', response });
  }

  /**
   * Mock a DELETE request
   */
  public delete(url: string | RegExp, response: NetworkResponse | ((req: MockRequest) => NetworkResponse)): void {
    this.intercept({ url, method: 'DELETE', response });
  }

  /**
   * Clear all interceptors
   */
  public clearInterceptors(): void {
    this.interceptors = [];
  }

  /**
   * Clear request history
   */
  public clearHistory(): void {
    this.requests = [];
  }

  /**
   * Get all intercepted requests
   */
  public getRequests(): MockRequest[] {
    return [...this.requests];
  }

  /**
   * Get requests matching criteria
   */
  public getRequestsMatching(criteria: {
    url?: string | RegExp;
    method?: HttpMethod;
  }): MockRequest[] {
    return this.requests.filter(request => {
      if (criteria.url) {
        if (typeof criteria.url === 'string') {
          if (!request.url.includes(criteria.url)) return false;
        } else {
          if (!criteria.url.test(request.url)) return false;
        }
      }

      if (criteria.method && request.method !== criteria.method) {
        return false;
      }

      return true;
    });
  }

  /**
   * Wait for a specific request to be made
   */
  public async waitForRequest(
    criteria: { url?: string | RegExp; method?: HttpMethod },
    timeout: number = 5000
  ): Promise<MockRequest> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const matching = this.getRequestsMatching(criteria);
      if (matching.length > 0) {
        return matching[matching.length - 1]; // Return the most recent match
      }

      await new Promise(resolve => setTimeout(resolve, 10));
    }

    throw new Error(`Request matching criteria not found within ${timeout}ms`);
  }

  /**
   * Assert that a request was made
   */
  public expectRequest(criteria: {
    url?: string | RegExp;
    method?: HttpMethod;
    times?: number;
  }): void {
    const matching = this.getRequestsMatching(criteria);

    if (criteria.times !== undefined) {
      if (matching.length !== criteria.times) {
        throw new Error(
          `Expected ${criteria.times} requests matching criteria, but found ${matching.length}`
        );
      }
    } else if (matching.length === 0) {
      throw new Error('Expected at least one request matching criteria, but found none');
    }
  }

  /**
   * Create mock requestUrl function
   */
  private createRequestUrlMock() {
    return async (options: any) => {
      const url = typeof options === 'string' ? options : options.url;
      const method = (options.method || 'GET').toUpperCase() as HttpMethod;
      const headers = { ...this.config.defaultHeaders, ...(options.headers || {}) };

      const request: MockRequest = {
        url,
        method,
        headers,
        body: options.body,
        json: options.json,
        timestamp: Date.now()
      };

      this.requests.push(request);

      if (this.config.logRequests) {
        console.log(`[NetworkMock] ${method} ${url}`);
      }

      const interceptor = this.findMatchingInterceptor(request);

      if (!interceptor) {
        if (this.config.throwOnUnmocked) {
          throw new Error(`Unmocked request: ${method} ${url}`);
        } else {
          return this.createDefaultResponse();
        }
      }

      // Apply delay if specified
      const delay = interceptor.delay || this.config.defaultDelay || 0;
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Get response
      let response: NetworkResponse;
      if (typeof interceptor.response === 'function') {
        response = await interceptor.response(request);
      } else {
        response = interceptor.response || {};
      }

      // Update interceptor usage
      if (interceptor.times !== undefined && interceptor.times !== Infinity) {
        interceptor.times--;
        if (interceptor.times <= 0 && !interceptor.persist) {
          const index = this.interceptors.indexOf(interceptor);
          if (index !== -1) {
            this.interceptors.splice(index, 1);
          }
        }
      }

      // Handle error response
      if (response.error) {
        throw response.error;
      }

      // Create response object similar to Obsidian's requestUrl
      return {
        status: response.status || 200,
        statusText: response.statusText || 'OK',
        headers: response.headers || {},
        json: response.json || response.data,
        text: response.text || (response.data ? JSON.stringify(response.data) : ''),
        arrayBuffer: response.arrayBuffer || new ArrayBuffer(0)
      };
    };
  }

  /**
   * Create mock fetch function
   */
  private createFetchMock() {
    return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init?.method || 'GET').toUpperCase() as HttpMethod;
      const headers: Record<string, string> = {};

      // Parse headers
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([key, value]) => {
            headers[key] = value;
          });
        } else {
          Object.assign(headers, init.headers);
        }
      }

      const request: MockRequest = {
        url,
        method,
        headers: { ...this.config.defaultHeaders, ...headers },
        body: init?.body,
        timestamp: Date.now()
      };

      this.requests.push(request);

      if (this.config.logRequests) {
        console.log(`[NetworkMock] ${method} ${url}`);
      }

      const interceptor = this.findMatchingInterceptor(request);

      if (!interceptor) {
        if (this.config.throwOnUnmocked) {
          throw new Error(`Unmocked request: ${method} ${url}`);
        } else {
          return new Response('', { status: 200 });
        }
      }

      // Apply delay if specified
      const delay = interceptor.delay || this.config.defaultDelay || 0;
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Get response
      let response: NetworkResponse;
      if (typeof interceptor.response === 'function') {
        response = await interceptor.response(request);
      } else {
        response = interceptor.response || {};
      }

      // Update interceptor usage
      if (interceptor.times !== undefined && interceptor.times !== Infinity) {
        interceptor.times--;
        if (interceptor.times <= 0 && !interceptor.persist) {
          const index = this.interceptors.indexOf(interceptor);
          if (index !== -1) {
            this.interceptors.splice(index, 1);
          }
        }
      }

      // Handle error response
      if (response.error) {
        throw response.error;
      }

      // Create Response object
      const body = response.text ||
                  (response.json ? JSON.stringify(response.json) : '') ||
                  (response.data ? JSON.stringify(response.data) : '') ||
                  response.arrayBuffer;

      return new Response(body, {
        status: response.status || 200,
        statusText: response.statusText || 'OK',
        headers: response.headers || {}
      });
    };
  }

  /**
   * Find matching interceptor for request
   */
  private findMatchingInterceptor(request: MockRequest): RequestInterceptor | null {
    for (const interceptor of this.interceptors) {
      // Check if interceptor is still active
      if (interceptor.times !== undefined && interceptor.times <= 0) {
        continue;
      }

      // Check URL match
      if (typeof interceptor.url === 'string') {
        if (!request.url.includes(interceptor.url)) continue;
      } else {
        if (!interceptor.url.test(request.url)) continue;
      }

      // Check method match
      if (interceptor.method) {
        const methods = Array.isArray(interceptor.method) ? interceptor.method : [interceptor.method];
        if (!methods.includes(request.method)) continue;
      }

      return interceptor;
    }

    return null;
  }

  /**
   * Create default response for unmocked requests
   */
  private createDefaultResponse(): any {
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      json: {},
      text: '',
      arrayBuffer: new ArrayBuffer(0)
    };
  }
}

/**
 * Global network mock instance
 */
let globalNetworkMock: NetworkMock | null = null;

/**
 * Get or create global network mock
 */
export function getNetworkMock(config?: NetworkMockConfig): NetworkMock {
  if (!globalNetworkMock) {
    globalNetworkMock = new NetworkMock(config);
  }
  return globalNetworkMock;
}

/**
 * Enable network mocking with default configuration
 */
export function enableNetworkMocking(config?: NetworkMockConfig): NetworkMock {
  const mock = getNetworkMock(config);
  mock.enable();
  return mock;
}

/**
 * Disable network mocking
 */
export function disableNetworkMocking(): void {
  if (globalNetworkMock) {
    globalNetworkMock.disable();
  }
}

/**
 * Reset network mock (clear interceptors and history)
 */
export function resetNetworkMock(): void {
  if (globalNetworkMock) {
    globalNetworkMock.clearInterceptors();
    globalNetworkMock.clearHistory();
  }
}

/**
 * Convenience functions for common scenarios
 */

/**
 * Mock successful JSON response
 */
export function mockJsonResponse(url: string | RegExp, data: any, status: number = 200): void {
  getNetworkMock().intercept({
    url,
    response: { status, json: data }
  });
}

/**
 * Mock error response
 */
export function mockErrorResponse(url: string | RegExp, status: number = 500, message: string = 'Server Error'): void {
  getNetworkMock().intercept({
    url,
    response: { status, statusText: message, text: message }
  });
}

/**
 * Mock network timeout
 */
export function mockTimeout(url: string | RegExp, delay: number = 5000): void {
  getNetworkMock().intercept({
    url,
    delay,
    response: { error: new Error('Network timeout') }
  });
}

/**
 * Mock slow response
 */
export function mockSlowResponse(url: string | RegExp, delay: number, response: NetworkResponse): void {
  getNetworkMock().intercept({
    url,
    delay,
    response
  });
}

/**
 * Pre-configured mocks for common APIs
 */
export const CommonMocks = {
  /**
   * Mock GitHub API responses
   */
  github: {
    user: (username: string, userData?: any) => mockJsonResponse(
      new RegExp(`api\\.github\\.com/users/${username}`),
      userData || { login: username, id: 123, type: 'User' }
    ),

    repo: (owner: string, repo: string, repoData?: any) => mockJsonResponse(
      new RegExp(`api\\.github\\.com/repos/${owner}/${repo}`),
      repoData || { name: repo, owner: { login: owner }, private: false }
    )
  },

  /**
   * Mock common HTTP status codes
   */
  http: {
    notFound: (url: string | RegExp) => mockErrorResponse(url, 404, 'Not Found'),
    unauthorized: (url: string | RegExp) => mockErrorResponse(url, 401, 'Unauthorized'),
    forbidden: (url: string | RegExp) => mockErrorResponse(url, 403, 'Forbidden'),
    serverError: (url: string | RegExp) => mockErrorResponse(url, 500, 'Internal Server Error'),
    badRequest: (url: string | RegExp) => mockErrorResponse(url, 400, 'Bad Request')
  },

  /**
   * Mock file download
   */
  fileDownload: (url: string | RegExp, content: string | ArrayBuffer) => {
    getNetworkMock().intercept({
      url,
      response: {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        arrayBuffer: content instanceof ArrayBuffer ? content : new TextEncoder().encode(content).buffer
      }
    });
  }
};

/**
 * Assertion helpers for network testing
 */
export const NetworkAssertions = {
  /**
   * Assert that a request was made to a specific URL
   */
  expectRequestTo(url: string | RegExp): void {
    getNetworkMock().expectRequest({ url });
  },

  /**
   * Assert that a specific number of requests were made
   */
  expectRequestCount(count: number, criteria?: { url?: string | RegExp; method?: HttpMethod }): void {
    getNetworkMock().expectRequest({ ...criteria, times: count });
  },

  /**
   * Assert that no requests were made
   */
  expectNoRequests(): void {
    const requests = getNetworkMock().getRequests();
    if (requests.length > 0) {
      throw new Error(`Expected no requests, but found ${requests.length}`);
    }
  },

  /**
   * Assert request body contains specific data
   */
  expectRequestBody(criteria: { url?: string | RegExp; method?: HttpMethod }, expectedBody: any): void {
    const requests = getNetworkMock().getRequestsMatching(criteria);
    if (requests.length === 0) {
      throw new Error('No requests found matching criteria');
    }

    const request = requests[requests.length - 1];
    const actualBody = request.body || request.json;

    if (JSON.stringify(actualBody) !== JSON.stringify(expectedBody)) {
      throw new Error(`Request body mismatch. Expected: ${JSON.stringify(expectedBody)}, Actual: ${JSON.stringify(actualBody)}`);
    }
  }
};