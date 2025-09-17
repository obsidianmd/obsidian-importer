/**
 * Mock implementation of @notionhq/client for testing
 */

export interface NotionClientConfig {
  auth?: string;
  baseUrl?: string;
  timeoutMs?: number;
  notionVersion?: string;
}

export interface NotionDatabase {
  id: string;
  title: Array<{ plain_text: string }>;
  description?: Array<{ plain_text: string }>;
  properties: Record<string, any>;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  url: string;
  public_url?: string;
}

export interface NotionPage {
  id: string;
  properties: Record<string, any>;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  url: string;
  public_url?: string;
  parent: {
    type: 'database_id';
    database_id: string;
  };
}

export interface QueryDatabaseResponse {
  results: NotionPage[];
  next_cursor?: string;
  has_more: boolean;
}

export interface ListDatabasesResponse {
  results: NotionDatabase[];
  next_cursor?: string;
  has_more: boolean;
}

export class Client {
  auth: string;

  constructor(options: NotionClientConfig = {}) {
    this.auth = options.auth || 'mock-auth-token';
  }

  databases = {
    list: jest.fn(async (): Promise<ListDatabasesResponse> => ({
      results: [
        {
          id: 'test-database-1',
          title: [{ plain_text: 'Test Database' }],
          properties: {
            'Name': {
              type: 'title',
              title: {},
              name: 'Name'
            },
            'Status': {
              type: 'select',
              select: {
                options: [
                  { name: 'Todo', color: 'red' },
                  { name: 'Done', color: 'green' }
                ]
              },
              name: 'Status'
            }
          },
          created_time: '2023-01-01T00:00:00.000Z',
          last_edited_time: '2023-01-01T00:00:00.000Z',
          archived: false,
          url: 'https://notion.so/test-database-1',
        }
      ],
      has_more: false,
    })),

    retrieve: jest.fn(async (params: { database_id: string }): Promise<NotionDatabase> => ({
      id: params.database_id,
      title: [{ plain_text: 'Test Database' }],
      properties: {
        'Name': {
          type: 'title',
          title: {},
          name: 'Name'
        },
        'Status': {
          type: 'select',
          select: {
            options: [
              { name: 'Todo', color: 'red' },
              { name: 'Done', color: 'green' }
            ]
          },
          name: 'Status'
        }
      },
      created_time: '2023-01-01T00:00:00.000Z',
      last_edited_time: '2023-01-01T00:00:00.000Z',
      archived: false,
      url: 'https://notion.so/test-database-1',
    })),

    query: jest.fn(async (params: {
      database_id: string;
      start_cursor?: string;
      page_size?: number;
    }): Promise<QueryDatabaseResponse> => ({
      results: [
        {
          id: 'test-page-1',
          properties: {
            'Name': {
              type: 'title',
              title: [{ plain_text: 'Test Page 1' }]
            },
            'Status': {
              type: 'select',
              select: { name: 'Todo', color: 'red' }
            }
          },
          created_time: '2023-01-01T00:00:00.000Z',
          last_edited_time: '2023-01-01T00:00:00.000Z',
          archived: false,
          url: 'https://notion.so/test-page-1',
          parent: {
            type: 'database_id',
            database_id: params.database_id
          }
        }
      ],
      has_more: false,
    })),
  };

  pages = {
    retrieve: jest.fn(async (params: { page_id: string }) => ({
      id: params.page_id,
      properties: {
        'Name': {
          type: 'title',
          title: [{ plain_text: 'Test Page' }]
        }
      },
      created_time: '2023-01-01T00:00:00.000Z',
      last_edited_time: '2023-01-01T00:00:00.000Z',
      archived: false,
      url: 'https://notion.so/test-page',
      parent: {
        type: 'database_id',
        database_id: 'test-database-1'
      }
    })),
  };

  blocks = {
    children: {
      list: jest.fn(async (params: { block_id: string }) => ({
        results: [
          {
            id: 'block-1',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ plain_text: 'Test content' }]
            }
          }
        ],
        has_more: false,
      })),
    },
  };

  search = jest.fn(async (params: any) => ({
    results: [],
    has_more: false,
  }));
}

// Error classes
export class APIErrorCode {
  static readonly UNAUTHORIZED = 'unauthorized';
  static readonly FORBIDDEN = 'forbidden';
  static readonly NOT_FOUND = 'object_not_found';
  static readonly RATE_LIMITED = 'rate_limited';
  static readonly INTERNAL_SERVER_ERROR = 'internal_server_error';
  static readonly SERVICE_UNAVAILABLE = 'service_unavailable';
}

export class APIResponseError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'APIResponseError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

// Helper function to create mock client
export function createMockNotionClient(overrides: Partial<NotionClientConfig> = {}): Client {
  return new Client({
    auth: 'mock-token',
    ...overrides,
  });
}

// Export as default for CJS compatibility
export default {
  Client,
  APIErrorCode,
  APIResponseError,
  RequestTimeoutError,
};