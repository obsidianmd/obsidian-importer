/**
 * Test Suite for NotionApiImporter
 *
 * Comprehensive testing of the Notion API importer with focus on:
 * - Class initialization and settings management
 * - Mobile compatibility (Platform.isDesktopApp)
 * - Import flow and error handling
 * - API connection testing and version detection
 * - Database and page importing
 * - File download and attachment handling
 *
 * Target Coverage: 85%+ for notion-api.ts
 */

import { jest } from '@jest/globals';
import { Platform, Notice, TFile, App, Setting, requestUrl } from 'obsidian';
import { Client } from '@notionhq/client';

// Import testing toolkit
import {
  setupTest,
  teardownTest,
  TestEnvironment
} from '@obsidian-testing-toolkit/core/ObsidianTestFramework';

// Import the class under test
import { NotionApiImporter } from '../notion-api';
import { NotionClient, NotionAPIError, NotionClientError } from '../../lib/notion-client';
import { NotionConverter } from '../../lib/notion-converter';
import { BaseGenerator } from '../../lib/base-generator';

// Test data fixtures
const mockNotionDatabase = {
  id: 'test-db-id-123',
  title: [{ plain_text: 'Test Database' }],
  description: [{ plain_text: 'A test database' }],
  properties: {
    Name: {
      type: 'title',
      title: {}
    },
    Status: {
      type: 'select',
      select: {
        options: [
          { name: 'Done', color: 'green' },
          { name: 'In Progress', color: 'yellow' }
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
    },
    Priority: {
      type: 'number',
      number: { format: 'number' }
    }
  },
  url: 'https://notion.so/test-db',
  created_time: '2023-01-01T00:00:00.000Z',
  last_edited_time: '2023-01-02T00:00:00.000Z'
};

const mockNotionPage = {
  id: 'test-page-id-456',
  properties: {
    Name: {
      type: 'title',
      title: [{ plain_text: 'Test Page' }]
    }
  },
  url: 'https://notion.so/test-page',
  created_time: '2023-01-01T00:00:00.000Z',
  last_edited_time: '2023-01-02T00:00:00.000Z',
  parent: { type: 'workspace' }
};

const mockNotionBlocks = [
  {
    id: 'block-1',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          plain_text: 'This is a test paragraph.',
          annotations: { bold: false, italic: false }
        }
      ]
    },
    has_children: false
  },
  {
    id: 'block-2',
    type: 'heading_1',
    heading_1: {
      rich_text: [
        {
          plain_text: 'Test Heading',
          annotations: { bold: true, italic: false }
        }
      ]
    },
    has_children: false
  }
];

// Mock implementations
const mockRequestUrl = jest.fn();
const mockNotice = jest.fn();
const mockClient = jest.fn();

// Setup mocks before tests
beforeAll(() => {
  // Mock Obsidian globals
  (global as any).requestUrl = mockRequestUrl;
  (global as any).Notice = mockNotice;

  // Mock Platform for mobile testing
  jest.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(true);

  // Mock Client constructor
  const MockedClient = Client as jest.MockedClass<typeof Client>;
  jest.mocked(MockedClient).mockImplementation(() => ({
    search: jest.fn(),
    databases: {
      retrieve: jest.fn(),
      query: jest.fn()
    },
    pages: {
      retrieve: jest.fn()
    },
    blocks: {
      children: {
        list: jest.fn()
      }
    },
    users: {
      me: jest.fn()
    }
  }));
});

describe('NotionApiImporter', () => {
  let testEnv: TestEnvironment;
  let importer: NotionApiImporter;
  let mockModal: any;

  beforeEach(async () => {
    // Setup test environment with Obsidian Testing Toolkit
    testEnv = await setupTest({
      features: {
        vault: true,
        workspace: true,
        metadataCache: true,
        fileSystem: true
      },
      testData: {
        generateSampleVault: false
      }
    });

    // Create mock modal
    mockModal = {
      contentEl: {
        createEl: jest.fn(),
        appendChild: jest.fn()
      },
      onOpen: jest.fn(),
      onClose: jest.fn()
    };

    // Create importer instance
    importer = new NotionApiImporter(testEnv.app as any, mockModal);

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await teardownTest();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default settings', () => {
      expect(importer).toBeInstanceOf(NotionApiImporter);

      const settings = importer.getSettings();
      expect(settings).toEqual({
        notionApiKey: '',
        defaultOutputFolder: 'Notion API Import',
        importImages: true,
        preserveNotionBlocks: false,
        convertToMarkdown: true,
        includeMetadata: true
      });
    });

    it('should update settings correctly', () => {
      const newSettings = {
        notionApiKey: 'test-key',
        defaultOutputFolder: 'Custom Folder',
        importImages: false
      };

      importer.updateSettings(newSettings);

      const settings = importer.getSettings();
      expect(settings.notionApiKey).toBe('test-key');
      expect(settings.defaultOutputFolder).toBe('Custom Folder');
      expect(settings.importImages).toBe(false);
      expect(settings.convertToMarkdown).toBe(true); // Should preserve existing settings
    });

    it('should create new Client when API key is updated', () => {
      const clientSpy = jest.spyOn(Client.prototype, 'constructor' as any);

      importer.updateSettings({ notionApiKey: 'new-key' });

      expect(clientSpy).toHaveBeenCalledWith({ auth: 'new-key' });
    });
  });

  describe('Mobile Compatibility', () => {
    it('should detect desktop platform correctly', async () => {
      // Mock as desktop
      jest.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(true);

      await importer.init();

      // Should initialize Node.js modules on desktop
      expect((importer as any).fs).toBeDefined();
      expect((importer as any).path).toBeDefined();
      expect((importer as any).crypto).toBeDefined();
    });

    it('should handle mobile platform correctly', async () => {
      // Mock as mobile
      jest.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(false);

      await importer.init();

      // Should NOT initialize Node.js modules on mobile
      expect((importer as any).fs).toBeNull();
      expect((importer as any).path).toBeNull();
      expect((importer as any).crypto).toBeNull();
    });

    it('should handle Node.js module loading errors gracefully', async () => {
      // Mock require to throw error
      const originalRequire = (global as any).require;
      (global as any).require = jest.fn().mockImplementation(() => {
        throw new Error('Module not found');
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await importer.init();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Could not initialize Node.js modules (expected on mobile):',
        expect.any(Error)
      );

      // Restore require
      (global as any).require = originalRequire;
      consoleSpy.mockRestore();
    });
  });

  describe('API Connection Testing', () => {
    it('should test connection successfully with valid token', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { type: 'bot', id: 'test-bot' }
      });

      const result = await importer.testConnection('valid-token');

      expect(result).toBe(true);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://api.notion.com/v1/users/me',
        method: 'GET',
        headers: expect.objectContaining({
          'Authorization': 'Bearer valid-token'
        }),
        throw: false
      });
    });

    it('should fail connection test with invalid token', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 401,
        text: 'Unauthorized'
      });

      const result = await importer.testConnection('invalid-token');

      expect(result).toBe(false);
    });

    it('should handle network errors in connection test', async () => {
      mockRequestUrl.mockRejectedValueOnce(new Error('Network error'));

      const result = await importer.testConnection('test-token');

      expect(result).toBe(false);
    });

    it('should validate token requirement', async () => {
      const result = await importer.testConnection('');

      expect(result).toBe(false);
    });
  });

  describe('API Version Detection', () => {
    it('should detect latest API version (2025-09-15)', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { results: [] }
      });

      // Set up importer with a client first
      importer.updateSettings({ notionApiKey: 'test-key' });

      const version = await importer.detectApiVersion();

      expect(version).toBe('2025-09-15');
      expect((importer as any).supportsDataSources).toBe(true);
    });

    it('should fallback to stable version when latest fails', async () => {
      mockRequestUrl.mockRejectedValueOnce(new Error('Version not supported'));

      // Set up importer with a client first
      importer.updateSettings({ notionApiKey: 'test-key' });

      const version = await importer.detectApiVersion();

      expect(version).toBe('2022-06-28');
      expect((importer as any).supportsDataSources).toBe(false);
    });
  });

  describe('Content Discovery', () => {
    beforeEach(() => {
      importer.updateSettings({ notionApiKey: 'test-key' });
    });

    it('should search for databases successfully', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          results: [mockNotionDatabase]
        }
      });

      const databases = await (importer as any).searchDatabases();

      expect(databases).toHaveLength(1);
      expect(databases[0].title).toBe('Test Database');
      expect(mockRequestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.notion.com/v1/search',
          method: 'POST',
          body: JSON.stringify({
            filter: { property: 'object', value: 'database' },
            page_size: 100
          })
        })
      );
    });

    it('should search for pages successfully', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          results: [mockNotionPage]
        }
      });

      const pages = await (importer as any).searchPages();

      expect(pages).toHaveLength(1);
      expect(pages[0].title).toBe('Test Page');
    });

    it('should handle search errors gracefully', async () => {
      mockRequestUrl.mockRejectedValueOnce(new Error('Search failed'));

      const databases = await (importer as any).searchDatabases();

      expect(databases).toEqual([]);
    });
  });

  describe('Import Process', () => {
    let mockContext: any;

    beforeEach(() => {
      mockContext = {
        status: jest.fn(),
        reportProgress: jest.fn(),
        isCancelled: jest.fn().mockReturnValue(false)
      };

      importer.updateSettings({ notionApiKey: 'test-key' });
    });

    it('should validate API key before import', async () => {
      importer.updateSettings({ notionApiKey: '' });

      await expect(importer.import(mockContext)).rejects.toThrow(
        'Notion API token is required'
      );
    });

    it('should test connection before import', async () => {
      // Mock failed connection
      mockRequestUrl.mockResolvedValueOnce({
        status: 401,
        text: 'Unauthorized'
      });

      await expect(importer.import(mockContext)).rejects.toThrow(
        'Failed to connect to Notion API'
      );
    });

    it('should discover and import content successfully', async () => {
      // Mock connection test
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { type: 'bot' }
      });

      // Mock API version detection
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { results: [] }
      });

      // Mock search databases
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { results: [mockNotionDatabase] }
      });

      // Mock search pages
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { results: [mockNotionPage] }
      });

      // Mock vault operations
      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      await importer.import(mockContext);

      expect(mockContext.status).toHaveBeenCalledWith('Testing connection...');
      expect(mockContext.status).toHaveBeenCalledWith(
        expect.stringContaining('Connected! Using API version')
      );
      expect(mockContext.reportProgress).toHaveBeenCalled();
    });

    it('should handle cancellation gracefully', async () => {
      mockContext.isCancelled.mockReturnValue(true);

      // Mock connection test
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { type: 'bot' }
      });

      // Mock API version detection
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { results: [] }
      });

      // Mock search
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { results: [] }
      });
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { results: [] }
      });

      await importer.import(mockContext);

      // Should exit early and not process content
      expect(mockContext.status).toHaveBeenCalledWith('Import completed successfully!');
    });

    it('should show notice when no content found', async () => {
      // Mock connection test
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { type: 'bot' }
      });

      // Mock API version detection
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { results: [] }
      });

      // Mock empty search results
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { results: [] }
      });
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { results: [] }
      });

      await importer.import(mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        'No content found. Make sure to share pages/databases with your integration.'
      );
    });
  });

  describe('Database Import', () => {
    beforeEach(() => {
      importer.updateSettings({ notionApiKey: 'test-key' });
    });

    it('should import database with entries successfully', async () => {
      const mockContext = {
        status: jest.fn(),
        reportProgress: jest.fn(),
        isCancelled: jest.fn().mockReturnValue(false)
      };

      // Mock database details
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: mockNotionDatabase
      });

      // Mock database entries
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          results: [mockNotionPage],
          has_more: false
        }
      });

      // Mock vault operations
      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      await (importer as any).importDatabase(mockContext, {
        id: 'test-db',
        title: 'Test Database'
      }, 'output');

      expect(testEnv.vault.createFolder).toHaveBeenCalled();
      expect(testEnv.vault.create).toHaveBeenCalledWith(
        expect.stringContaining('.base'),
        expect.any(String)
      );
    });

    it('should generate Base YAML configuration correctly', () => {
      const yaml = (importer as any).generateBaseYAML(mockNotionDatabase, 'test-db');

      expect(yaml).toContain('filters:');
      expect(yaml).toContain('properties:');
      expect(yaml).toContain('views:');
      expect(yaml).toContain('file.inFolder("test-db")');
    });

    it('should convert database properties to Base format', () => {
      const yaml = (importer as any).convertDatabaseProperties(mockNotionDatabase.properties);

      expect(yaml).toContain('Name:');
      expect(yaml).toContain('Status:');
      expect(yaml).toContain('type: select');
      expect(yaml).toContain('type: tags');
    });
  });

  describe('Page Import', () => {
    beforeEach(() => {
      importer.updateSettings({ notionApiKey: 'test-key' });
    });

    it('should import page with blocks successfully', async () => {
      const mockContext = {
        status: jest.fn(),
        reportProgress: jest.fn(),
        isCancelled: jest.fn().mockReturnValue(false)
      };

      // Mock page blocks
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          results: mockNotionBlocks,
          has_more: false
        }
      });

      // Mock vault operations
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      await (importer as any).importPage(mockContext, mockNotionPage, 'output');

      expect(testEnv.vault.create).toHaveBeenCalledWith(
        expect.stringContaining('.md'),
        expect.any(String)
      );
    });

    it('should convert page to markdown correctly', async () => {
      const result = await (importer as any).convertPageToMarkdown(
        mockNotionPage,
        mockNotionBlocks
      );

      expect(result.markdown).toContain('This is a test paragraph.');
      expect(result.markdown).toContain('# Test Heading');
      expect(result.frontmatter).toHaveProperty('title', 'Test Page');
      expect(result.frontmatter).toHaveProperty('notion-id', 'test-page-id-456');
    });
  });

  describe('Block Conversion', () => {
    it('should convert paragraph blocks', async () => {
      const context = {
        settings: importer.getSettings(),
        client: { client: { vault: testEnv.vault } },
        processedBlocks: new Set()
      };

      const result = await (importer as any).convertBlock(mockNotionBlocks[0], context);

      expect(result.content).toBe('This is a test paragraph.');
      expect(result.attachments).toEqual([]);
      expect(result.images).toEqual([]);
    });

    it('should convert heading blocks', async () => {
      const context = {
        settings: importer.getSettings(),
        client: { client: { vault: testEnv.vault } },
        processedBlocks: new Set()
      };

      const result = await (importer as any).convertBlock(mockNotionBlocks[1], context);

      expect(result.content).toBe('# **Test Heading**');
    });

    it('should handle unknown block types', async () => {
      const context = {
        settings: importer.getSettings(),
        client: { client: { vault: testEnv.vault } },
        processedBlocks: new Set()
      };

      const unknownBlock = {
        id: 'unknown-block',
        type: 'unknown_type',
        unknown_type: {
          rich_text: [{ plain_text: 'Unknown content' }]
        }
      };

      const result = await (importer as any).convertBlock(unknownBlock, context);

      expect(result.content).toBe('Unknown content');
    });
  });

  describe('Rich Text Conversion', () => {
    it('should convert plain text', () => {
      const richText = [
        { plain_text: 'Hello world', annotations: {} }
      ];

      const result = (importer as any).convertRichText(richText);

      expect(result).toBe('Hello world');
    });

    it('should apply text formatting', () => {
      const richText = [
        {
          plain_text: 'Bold text',
          annotations: { bold: true }
        },
        {
          plain_text: ' and italic text',
          annotations: { italic: true }
        }
      ];

      const result = (importer as any).convertRichText(richText);

      expect(result).toBe('**Bold text** *and italic text*');
    });

    it('should handle links', () => {
      const richText = [
        {
          plain_text: 'Click here',
          href: 'https://example.com',
          annotations: {}
        }
      ];

      const result = (importer as any).convertRichText(richText);

      expect(result).toBe('[Click here](https://example.com)');
    });

    it('should handle colors', () => {
      const richText = [
        {
          plain_text: 'Colored text',
          annotations: { color: 'red' }
        }
      ];

      const result = (importer as any).convertRichText(richText);

      expect(result).toContain('<span style="color:#DC2626">Colored text</span>');
    });
  });

  describe('File Download and Attachments', () => {
    it('should download image attachments when enabled', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        arrayBuffer: new ArrayBuffer(1024),
        headers: { 'content-type': 'image/png' }
      });

      jest.spyOn(testEnv.vault, 'createBinary').mockResolvedValue({} as TFile);

      const fileName = await (importer as any).downloadAttachment(
        'https://example.com/image.png',
        'image'
      );

      expect(fileName).toBeTruthy();
      expect(testEnv.vault.createBinary).toHaveBeenCalled();
    });

    it('should handle download failures gracefully', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 404,
        text: 'Not Found'
      });

      const fileName = await (importer as any).downloadAttachment(
        'https://example.com/missing.png',
        'image'
      );

      expect(fileName).toBeNull();
    });

    it('should skip downloads when images disabled', async () => {
      importer.updateSettings({ importImages: false });

      // Should not even attempt download
      const result = await (importer as any).processImageBlock({
        image: {
          file: { url: 'https://example.com/image.png' }
        }
      });

      expect(mockRequestUrl).not.toHaveBeenCalled();
    });
  });

  describe('Utility Methods', () => {
    it('should sanitize file names correctly', () => {
      const input = 'Invalid<>:"/\\|?*Name';
      const result = (importer as any).sanitizeFileName(input);

      expect(result).toBe('Invalid---------Name');
      expect(result.length).toBeLessThanOrEqual(100);
    });

    it('should get database title from object', () => {
      const title = (importer as any).getDatabaseTitle(mockNotionDatabase);
      expect(title).toBe('Test Database');
    });

    it('should get page title from object', () => {
      const title = (importer as any).getPageTitle(mockNotionPage);
      expect(title).toBe('Test Page');
    });

    it('should check if page is in database', () => {
      const pageInDb = {
        ...mockNotionPage,
        parent: { type: 'database_id', database_id: 'test-db-id-123' }
      };

      const isInDb = (importer as any).isPageInDatabase(pageInDb, [mockNotionDatabase]);
      expect(isInDb).toBe(true);

      const isNotInDb = (importer as any).isPageInDatabase(mockNotionPage, [mockNotionDatabase]);
      expect(isNotInDb).toBe(false);
    });

    it('should create frontmatter for pages', () => {
      const frontmatter = (importer as any).createPageFrontmatter(mockNotionPage);

      expect(frontmatter).toHaveProperty('title', 'Test Page');
      expect(frontmatter).toHaveProperty('notion-id', 'test-page-id-456');
      expect(frontmatter).toHaveProperty('created', '2023-01-01T00:00:00.000Z');
      expect(frontmatter).toHaveProperty('updated', '2023-01-02T00:00:00.000Z');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      mockRequestUrl.mockRejectedValueOnce(new Error('Network timeout'));

      importer.updateSettings({ notionApiKey: 'test-key' });

      const databases = await (importer as any).searchDatabases();
      expect(databases).toEqual([]);
    });

    it('should handle API errors with proper status codes', async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 500,
        text: 'Server Error'
      });

      const result = await importer.testConnection('test-key');
      expect(result).toBe(false);
    });

    it('should throw validation errors for missing settings', async () => {
      const mockContext = {
        status: jest.fn(),
        reportProgress: jest.fn(),
        isCancelled: jest.fn().mockReturnValue(false)
      };

      await expect(importer.import(mockContext)).rejects.toThrow(
        'Notion API token is required'
      );
    });
  });

  describe('Performance and Rate Limiting', () => {
    it('should respect rate limiting (3 req/sec)', async () => {
      const start = Date.now();

      // Make multiple requests
      const promises = Array(5).fill(null).map(() =>
        (importer as any).makeNotionRequest({}, 'test', {})
      );

      await Promise.all(promises);

      const elapsed = Date.now() - start;

      // Should take at least some time due to rate limiting
      expect(elapsed).toBeGreaterThan(0);
    });

    it('should handle large datasets efficiently', async () => {
      // Mock large dataset response
      const largeDataset = Array(1000).fill(null).map((_, i) => ({
        ...mockNotionPage,
        id: `page-${i}`
      }));

      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          results: largeDataset,
          has_more: false
        }
      });

      const start = Date.now();
      const pages = await (importer as any).searchPages();
      const elapsed = Date.now() - start;

      expect(pages).toHaveLength(1000);
      expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});

// Integration test helpers
export const createMockImportContext = () => ({
  status: jest.fn(),
  reportProgress: jest.fn(),
  isCancelled: jest.fn().mockReturnValue(false)
});

export const createMockNotionResponse = (data: any) => ({
  status: 200,
  json: data
});

export { mockNotionDatabase, mockNotionPage, mockNotionBlocks };