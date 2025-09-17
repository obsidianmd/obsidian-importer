/**
 * Test Suite for NotionClient
 *
 * Comprehensive testing of the Notion API client with focus on:
 * - Client initialization and configuration
 * - Rate limiting (3 req/sec) and queue management
 * - API version detection and error handling
 * - Pagination for large datasets
 * - Network failure recovery and retry logic
 * - Mobile compatibility using requestUrl
 * - Authentication and permission errors
 * - File download capabilities
 *
 * Target Coverage: 90%+ for notion-client.ts
 */

import { jest } from '@jest/globals';
import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';

// Import testing toolkit
import {
  setupTest,
  teardownTest,
  TestEnvironment
} from '@obsidian-testing-toolkit/core/ObsidianTestFramework';

// Import the class under test
import {
  NotionClient,
  createNotionClient,
  extractNotionId,
  NotionClientError,
  NotionAPIError,
  NotionRateLimitError,
  NotionAuthError,
  NotionValidationError,
  NotionClientConfig,
  SearchOptions,
  DatabaseQueryOptions,
  PaginationOptions,
  FileDownloadResult,
  NotionTypes
} from '../notion-client';

// Test fixtures
const mockSearchResponse = {
  object: 'list',
  results: [
    {
      object: 'page',
      id: 'test-page-1',
      created_time: '2023-01-01T00:00:00.000Z',
      last_edited_time: '2023-01-02T00:00:00.000Z',
      properties: {
        title: {
          type: 'title',
          title: [{ plain_text: 'Test Page 1' }]
        }
      }
    },
    {
      object: 'database',
      id: 'test-db-1',
      title: [{ plain_text: 'Test Database' }],
      properties: {
        Name: { type: 'title' },
        Status: { type: 'select' }
      }
    }
  ],
  next_cursor: null,
  has_more: false
};

const mockDatabaseResponse = {
  object: 'database',
  id: 'test-db-1',
  title: [{ plain_text: 'Test Database' }],
  description: [{ plain_text: 'A test database for testing' }],
  properties: {
    Name: {
      type: 'title',
      title: {}
    },
    Status: {
      type: 'select',
      select: {
        options: [
          { name: 'Todo', color: 'red' },
          { name: 'In Progress', color: 'yellow' },
          { name: 'Done', color: 'green' }
        ]
      }
    },
    Tags: {
      type: 'multi_select',
      multi_select: {
        options: [
          { name: 'Important', color: 'red' },
          { name: 'Review', color: 'blue' }
        ]
      }
    },
    'Due Date': {
      type: 'date',
      date: {}
    }
  }
};

const mockUserResponse = {
  object: 'user',
  id: 'test-user-1',
  type: 'bot',
  name: 'Test Bot',
  avatar_url: null,
  bot: {
    owner: {
      type: 'workspace',
      workspace: true
    }
  }
};

const mockBlocksResponse = {
  object: 'list',
  results: [
    {
      object: 'block',
      id: 'block-1',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: 'Test paragraph content' },
            plain_text: 'Test paragraph content'
          }
        ]
      },
      has_children: false
    },
    {
      object: 'block',
      id: 'block-2',
      type: 'heading_1',
      heading_1: {
        rich_text: [
          {
            type: 'text',
            text: { content: 'Test Heading' },
            plain_text: 'Test Heading'
          }
        ]
      },
      has_children: false
    }
  ],
  next_cursor: null,
  has_more: false
};

// Mock requestUrl function
const mockRequestUrl = jest.fn<typeof requestUrl>();

// Setup mocks before tests
beforeAll(() => {
  // Mock Obsidian's requestUrl
  (global as any).requestUrl = mockRequestUrl;
});

describe('NotionClient', () => {
  let testEnv: TestEnvironment;
  let client: NotionClient;

  beforeEach(async () => {
    // Setup test environment
    testEnv = await setupTest({
      features: {
        vault: true,
        workspace: true,
        metadataCache: true,
        fileSystem: false
      }
    });

    // Create client with test configuration
    client = new NotionClient({
      auth: 'test-token',
      debug: true,
      rateLimit: 10, // Higher rate limit for testing
      maxRetries: 2,
      retryDelay: 100,
      timeout: 5000
    });

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await teardownTest();
    client.clearQueue();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with valid configuration', () => {
      const config: NotionClientConfig = {
        auth: 'test-token',
        notionVersion: '2022-06-28',
        baseUrl: 'https://api.notion.com/v1',
        maxRetries: 3,
        retryDelay: 1000,
        rateLimit: 3,
        debug: true
      };

      const testClient = new NotionClient(config);
      const clientConfig = testClient.getConfig();

      expect(clientConfig.auth).toBe('test-token');
      expect(clientConfig.notionVersion).toBe('2022-06-28');
      expect(clientConfig.maxRetries).toBe(3);
      expect(clientConfig.rateLimit).toBe(3);
    });

    it('should throw error for missing auth token', () => {
      expect(() => {
        new NotionClient({ auth: '' });
      }).toThrow(NotionValidationError);
    });

    it('should merge default configuration correctly', () => {
      const testClient = new NotionClient({ auth: 'test-token' });
      const config = testClient.getConfig();

      expect(config.notionVersion).toBe('2022-06-28');
      expect(config.baseUrl).toBe('https://api.notion.com/v1');
      expect(config.maxRetries).toBe(3);
      expect(config.rateLimit).toBe(3);
    });

    it('should allow configuration updates', () => {
      client.updateConfig({ rateLimit: 5, debug: false });
      const config = client.getConfig();

      expect(config.rateLimit).toBe(5);
      expect(config.debug).toBe(false);
    });
  });

  describe('Connection Testing', () => {
    it('should test connection successfully', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: mockUserResponse
      } as RequestUrlResponse);

      const result = await client.testConnection();

      expect(result).toBe(true);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://api.notion.com/v1/users/me',
        method: 'GET',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-token',
          'Notion-Version': '2022-06-28'
        }),
        throw: false
      });
    });

    it('should fail connection test for invalid token', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 401,
        text: 'Unauthorized'
      } as RequestUrlResponse);

      const result = await client.testConnection();

      expect(result).toBe(false);
    });

    it('should fail connection test for non-bot user', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { ...mockUserResponse, type: 'person' }
      } as RequestUrlResponse);

      const result = await client.testConnection();

      expect(result).toBe(false);
    });

    it('should handle network errors in connection test', async () => {
      mockRequestUrl.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('Search Operations', () => {
    it('should search with default options', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: mockSearchResponse
      } as RequestUrlResponse);

      const result = await client.search();

      expect(result.results).toHaveLength(2);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://api.notion.com/v1/search',
        method: 'POST',
        headers: expect.any(Object),
        body: JSON.stringify({
          query: '',
          page_size: 100
        }),
        throw: false
      });
    });

    it('should search with custom options', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: mockSearchResponse
      } as RequestUrlResponse);

      const options: SearchOptions = {
        query: 'test',
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'ascending', timestamp: 'last_edited_time' },
        limit: 50,
        pageSize: 25
      };

      const result = await client.search(options);

      expect(result.results).toHaveLength(2);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://api.notion.com/v1/search',
        method: 'POST',
        headers: expect.any(Object),
        body: JSON.stringify({
          query: 'test',
          filter: { property: 'object', value: 'page' },
          sort: { direction: 'ascending', timestamp: 'last_edited_time' },
          page_size: 25
        }),
        throw: false
      });
    });

    it('should handle pagination in search', async () => {
      // First page
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          ...mockSearchResponse,
          next_cursor: 'cursor-1',
          has_more: true
        }
      } as RequestUrlResponse);

      // Second page
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          ...mockSearchResponse,
          next_cursor: null,
          has_more: false
        }
      } as RequestUrlResponse);

      const result = await client.search({ limit: 4 });

      expect(result.results).toHaveLength(4);
      expect(mockRequestUrl).toHaveBeenCalledTimes(2);

      // Check that second call includes cursor
      expect(mockRequestUrl).toHaveBeenNthCalledWith(2, {
        url: 'https://api.notion.com/v1/search',
        method: 'POST',
        headers: expect.any(Object),
        body: JSON.stringify({
          query: '',
          page_size: 100,
          start_cursor: 'cursor-1'
        }),
        throw: false
      });
    });

    it('should call progress callback during pagination', async () => {
      const onProgress = jest.fn();

      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: mockSearchResponse
      } as RequestUrlResponse);

      await client.search({ onProgress });

      expect(onProgress).toHaveBeenCalledWith(
        2,
        2,
        'Retrieved 2 items'
      );
    });
  });

  describe('Database Operations', () => {
    it('should get database metadata', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: mockDatabaseResponse
      } as RequestUrlResponse);

      const result = await client.getDatabase('test-db-1');

      expect(result).toEqual(mockDatabaseResponse);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://api.notion.com/v1/databases/test-db-1',
        method: 'GET',
        headers: expect.any(Object),
        throw: false
      });
    });

    it('should validate database ID format', async () => {
      await expect(client.getDatabase('invalid-id')).rejects.toThrow(
        NotionValidationError
      );
    });

    it('should query database with filters and sorting', async () => {
      const queryResponse = {
        object: 'list',
        results: [mockSearchResponse.results[0]],
        next_cursor: null,
        has_more: false
      };

      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: queryResponse
      } as RequestUrlResponse);

      const options: DatabaseQueryOptions = {
        filter: {
          property: 'Status',
          select: { equals: 'Done' }
        },
        sorts: [
          {
            property: 'Due Date',
            direction: 'ascending'
          }
        ],
        limit: 10
      };

      const result = await client.queryDatabase('test-db-1', options);

      expect(result.results).toHaveLength(1);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://api.notion.com/v1/databases/test-db-1/query',
        method: 'POST',
        headers: expect.any(Object),
        body: JSON.stringify({
          filter: options.filter,
          sorts: options.sorts,
          page_size: 10
        }),
        throw: false
      });
    });
  });

  describe('Page Operations', () => {
    it('should get page content', async () => {
      const pageResponse = {
        object: 'page',
        id: 'test-page-1',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'Test Page' }]
          }
        }
      };

      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: pageResponse
      } as RequestUrlResponse);

      const result = await client.getPage('test-page-1');

      expect(result).toEqual(pageResponse);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://api.notion.com/v1/pages/test-page-1',
        method: 'GET',
        headers: expect.any(Object),
        throw: false
      });
    });
  });

  describe('Block Operations', () => {
    it('should get block content', async () => {
      const blockResponse = mockBlocksResponse.results[0];

      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: blockResponse
      } as RequestUrlResponse);

      const result = await client.getBlock('block-1');

      expect(result).toEqual(blockResponse);
    });

    it('should get block children with pagination', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: mockBlocksResponse
      } as RequestUrlResponse);

      const result = await client.getBlockChildren('parent-block-1');

      expect(result.results).toHaveLength(2);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://api.notion.com/v1/blocks/parent-block-1/children',
        method: 'GET',
        headers: expect.any(Object),
        throw: false
      });
    });

    it('should handle large block collections with pagination', async () => {
      // First page
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          ...mockBlocksResponse,
          next_cursor: 'cursor-1',
          has_more: true
        }
      } as RequestUrlResponse);

      // Second page
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          ...mockBlocksResponse,
          next_cursor: null,
          has_more: false
        }
      } as RequestUrlResponse);

      const result = await client.getBlockChildren('parent-block-1', { limit: 4 });

      expect(result.results).toHaveLength(4);
      expect(mockRequestUrl).toHaveBeenCalledTimes(2);
    });
  });

  describe('User Operations', () => {
    it('should get current user (me)', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: mockUserResponse
      } as RequestUrlResponse);

      const result = await client.getUser('me');

      expect(result).toEqual(mockUserResponse);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://api.notion.com/v1/users/me',
        method: 'GET',
        headers: expect.any(Object),
        throw: false
      });
    });

    it('should get specific user by ID', async () => {
      const userId = 'user-12345678-1234-1234-1234-123456789012';

      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: mockUserResponse
      } as RequestUrlResponse);

      const result = await client.getUser(userId);

      expect(result).toEqual(mockUserResponse);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: `https://api.notion.com/v1/users/${userId}`,
        method: 'GET',
        headers: expect.any(Object),
        throw: false
      });
    });

    it('should validate user ID format', async () => {
      await expect(client.getUser('invalid-user-id')).rejects.toThrow(
        NotionValidationError
      );
    });
  });

  describe('File Download Operations', () => {
    it('should download file successfully', async () => {
      const fileArrayBuffer = new ArrayBuffer(1024);
      const fileUrl = 'https://s3.amazonaws.com/notion-static/file.pdf';

      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        arrayBuffer: fileArrayBuffer,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="test-file.pdf"'
        }
      } as RequestUrlResponse);

      const result: FileDownloadResult = await client.downloadFile(fileUrl);

      expect(result.data).toBe(fileArrayBuffer);
      expect(result.filename).toBe('test-file.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(result.size).toBe(1024);
    });

    it('should extract filename from URL when header missing', async () => {
      const fileArrayBuffer = new ArrayBuffer(512);
      const fileUrl = 'https://s3.amazonaws.com/notion-static/document.pdf';

      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        arrayBuffer: fileArrayBuffer,
        headers: {
          'content-type': 'application/pdf'
        }
      } as RequestUrlResponse);

      const result = await client.downloadFile(fileUrl);

      expect(result.filename).toBe('document.pdf');
    });

    it('should handle download failures', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 404,
        text: 'File not found'
      } as RequestUrlResponse);

      await expect(client.downloadFile('https://example.com/missing.pdf'))
        .rejects.toThrow(NotionAPIError);
    });

    it('should validate file URL', async () => {
      await expect(client.downloadFile(''))
        .rejects.toThrow(NotionValidationError);
    });
  });

  describe('Error Handling', () => {
    it('should handle 401 authentication errors', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 401,
        text: 'Unauthorized'
      } as RequestUrlResponse);

      await expect(client.search()).rejects.toThrow(NotionAuthError);
    });

    it('should handle 403 permission errors', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 403,
        text: 'Forbidden'
      } as RequestUrlResponse);

      await expect(client.search()).rejects.toThrow(NotionAuthError);
    });

    it('should handle 404 not found errors', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 404,
        text: 'Not Found'
      } as RequestUrlResponse);

      await expect(client.search()).rejects.toThrow(NotionAPIError);
    });

    it('should handle 409 conflict errors', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 409,
        text: 'Conflict'
      } as RequestUrlResponse);

      await expect(client.search()).rejects.toThrow(NotionAPIError);
    });

    it('should handle 429 rate limit errors', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 429,
        headers: { 'retry-after': '30' },
        text: 'Too Many Requests'
      } as RequestUrlResponse);

      await expect(client.search()).rejects.toThrow(NotionRateLimitError);
    });

    it('should handle 500 server errors', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 500,
        text: 'Internal Server Error'
      } as RequestUrlResponse);

      await expect(client.search()).rejects.toThrow(NotionAPIError);
    });

    it('should handle network errors', async () => {
      mockRequestUrl.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(client.search()).rejects.toThrow(NotionAPIError);
    });

    it('should parse error messages from response', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 400,
        json: { message: 'Invalid request body' },
        text: 'Bad Request'
      } as RequestUrlResponse);

      await expect(client.search()).rejects.toThrow('Invalid request body');
    });
  });

  describe('Retry Logic', () => {
    it('should retry on server errors', async () => {
      // First call fails
      mockRequestUrl
        .mockResolvedValueOnce({
          status: 500,
          text: 'Server Error'
        } as RequestUrlResponse)
        // Second call succeeds
        .mockResolvedValueOnce({
          status: 200,
          json: mockSearchResponse
        } as RequestUrlResponse);

      const result = await client.search();

      expect(result.results).toHaveLength(2);
      expect(mockRequestUrl).toHaveBeenCalledTimes(2);
    });

    it('should not retry on authentication errors', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 401,
        text: 'Unauthorized'
      } as RequestUrlResponse);

      await expect(client.search()).rejects.toThrow(NotionAuthError);
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('should not retry on validation errors', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 400,
        json: { message: 'Invalid filter' }
      } as RequestUrlResponse);

      await expect(client.search()).rejects.toThrow(NotionAPIError);
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('should respect maximum retry attempts', async () => {
      // All calls fail
      mockRequestUrl
        .mockResolvedValueOnce({ status: 500, text: 'Error 1' } as RequestUrlResponse)
        .mockResolvedValueOnce({ status: 500, text: 'Error 2' } as RequestUrlResponse)
        .mockResolvedValueOnce({ status: 500, text: 'Error 3' } as RequestUrlResponse);

      await expect(client.search()).rejects.toThrow(NotionAPIError);

      // Should try initial call + 2 retries = 3 total calls
      expect(mockRequestUrl).toHaveBeenCalledTimes(3);
    });
  });

  describe('Rate Limiting and Queue Management', () => {
    it('should respect rate limiting', async () => {
      // Create client with very low rate limit for testing
      const rateLimitedClient = new NotionClient({
        auth: 'test-token',
        rateLimit: 1,
        debug: true
      });

      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: mockSearchResponse
      } as RequestUrlResponse);

      const start = Date.now();

      // Make multiple requests
      const promises = [
        rateLimitedClient.search(),
        rateLimitedClient.search(),
        rateLimitedClient.search()
      ];

      await Promise.all(promises);
      const elapsed = Date.now() - start;

      // Should take at least 2 seconds for 3 requests at 1 req/sec
      expect(elapsed).toBeGreaterThanOrEqual(1500);

      rateLimitedClient.clearQueue();
    });

    it('should process queue status correctly', () => {
      const status = client.getQueueStatus();

      expect(status).toHaveProperty('queueLength');
      expect(status).toHaveProperty('processing');
      expect(status).toHaveProperty('lastRequestTime');
    });

    it('should clear queue successfully', () => {
      client.clearQueue();
      const status = client.getQueueStatus();

      expect(status.queueLength).toBe(0);
      expect(status.processing).toBe(false);
    });
  });

  describe('ID Validation', () => {
    const validIds = [
      'aba65b8b-6b19-4f4b-8019-ff42ce4b38ef',
      'aba65b8b6b194f4b8019ff42ce4b38ef',
      'ABA65B8B-6B19-4F4B-8019-FF42CE4B38EF',
      'ABA65B8B6B194F4B8019FF42CE4B38EF'
    ];

    const invalidIds = [
      '',
      'invalid',
      'aba65b8b-6b19-4f4b-8019-ff42ce4b38e', // Too short
      'aba65b8b-6b19-4f4b-8019-ff42ce4b38efg', // Too long
      'gba65b8b-6b19-4f4b-8019-ff42ce4b38ef', // Invalid hex character
      null,
      undefined
    ];

    it.each(validIds)('should accept valid ID: %s', async (id) => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {}
      } as RequestUrlResponse);

      await expect(client.getPage(id)).resolves.toBeDefined();
    });

    it.each(invalidIds)('should reject invalid ID: %s', async (id) => {
      await expect(client.getPage(id as string)).rejects.toThrow(
        NotionValidationError
      );
    });
  });

  describe('Performance Monitoring', () => {
    it('should handle large datasets efficiently', async () => {
      // Create large mock dataset
      const largeResults = Array(500).fill(null).map((_, i) => ({
        object: 'page',
        id: `page-${i.toString().padStart(32, '0')}`,
        properties: { title: { type: 'title', title: [{ plain_text: `Page ${i}` }] } }
      }));

      // Mock paginated responses
      for (let i = 0; i < 5; i++) {
        const isLast = i === 4;
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: {
            object: 'list',
            results: largeResults.slice(i * 100, (i + 1) * 100),
            next_cursor: isLast ? null : `cursor-${i + 1}`,
            has_more: !isLast
          }
        } as RequestUrlResponse);
      }

      const start = Date.now();
      const result = await client.search({ limit: 500 });
      const elapsed = Date.now() - start;

      expect(result.results).toHaveLength(500);
      expect(elapsed).toBeLessThan(10000); // Should complete within 10 seconds
    });

    it('should handle concurrent requests properly', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: mockSearchResponse
      } as RequestUrlResponse);

      const concurrentRequests = Array(10).fill(null).map(() =>
        client.search({ query: 'test' })
      );

      const results = await Promise.all(concurrentRequests);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.results).toHaveLength(2);
      });
    });
  });
});

describe('Utility Functions', () => {
  describe('createNotionClient', () => {
    it('should create client with factory function', () => {
      const config: NotionClientConfig = {
        auth: 'test-token',
        debug: true
      };

      const client = createNotionClient(config);

      expect(client).toBeInstanceOf(NotionClient);
      expect(client.getConfig().auth).toBe('test-token');
      expect(client.getConfig().debug).toBe(true);
    });
  });

  describe('extractNotionId', () => {
    const testCases = [
      {
        url: 'https://www.notion.so/myworkspace/Test-Page-abc123def456789012345678901234567890',
        expected: 'abc123de-f456-7890-1234-567890123456'
      },
      {
        url: 'https://notion.so/abc123def456789012345678901234567890',
        expected: 'abc123de-f456-7890-1234-567890123456'
      },
      {
        url: 'https://www.notion.so/abc123de-f456-7890-1234-567890123456',
        expected: 'abc123de-f456-7890-1234-567890123456'
      },
      {
        url: 'invalid-url',
        expected: null
      },
      {
        url: 'https://example.com/no-notion-id',
        expected: null
      }
    ];

    it.each(testCases)('should extract ID from URL: $url', ({ url, expected }) => {
      const result = extractNotionId(url);
      expect(result).toBe(expected);
    });

    it('should handle malformed URLs gracefully', () => {
      const result = extractNotionId('not-a-url');
      expect(result).toBeNull();
    });
  });
});

describe('Custom Error Classes', () => {
  describe('NotionClientError', () => {
    it('should create error with details', () => {
      const error = new NotionClientError('Test error', 'TEST_CODE', 400, { detail: 'test' });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.status).toBe(400);
      expect(error.details).toEqual({ detail: 'test' });
      expect(error.name).toBe('NotionClientError');
    });
  });

  describe('NotionAPIError', () => {
    it('should create API error', () => {
      const error = new NotionAPIError('API failed', 500, { request: 'test' });

      expect(error.message).toBe('API failed');
      expect(error.code).toBe('NOTION_API_ERROR');
      expect(error.status).toBe(500);
    });
  });

  describe('NotionRateLimitError', () => {
    it('should create rate limit error', () => {
      const error = new NotionRateLimitError(30);

      expect(error.message).toBe('Rate limit exceeded');
      expect(error.code).toBe('RATE_LIMIT_ERROR');
      expect(error.status).toBe(429);
      expect(error.details).toEqual({ retryAfter: 30 });
    });
  });

  describe('NotionAuthError', () => {
    it('should create auth error', () => {
      const error = new NotionAuthError('Invalid token');

      expect(error.message).toBe('Invalid token');
      expect(error.code).toBe('AUTH_ERROR');
      expect(error.status).toBe(401);
    });
  });

  describe('NotionValidationError', () => {
    it('should create validation error', () => {
      const error = new NotionValidationError('Invalid input', { field: 'id' });

      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.status).toBe(400);
      expect(error.details).toEqual({ field: 'id' });
    });
  });
});

// Test data exports for integration tests
export {
  mockSearchResponse,
  mockDatabaseResponse,
  mockUserResponse,
  mockBlocksResponse
};