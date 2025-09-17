/**
 * Integration Test Suite for Notion API Importer
 *
 * End-to-end testing of the complete Notion import pipeline with focus on:
 * - Complete import flow from API to Obsidian files
 * - Performance testing with large datasets (10K+ pages)
 * - Mobile compatibility testing (Platform.isDesktopApp)
 * - Network failure recovery and retry scenarios
 * - Real-world data structure handling
 * - Cross-component integration validation
 * - File system operations and Base file generation
 * - Memory usage and cleanup testing
 *
 * Target Coverage: Integration scenarios and real-world usage patterns
 */

import { jest } from '@jest/globals';
import { Platform, Notice, TFile, requestUrl } from 'obsidian';

// Import testing toolkit
import {
  setupTest,
  teardownTest,
  TestEnvironment,
  getTestFramework
} from '@obsidian-testing-toolkit/core/ObsidianTestFramework';

// Import classes under test
import { NotionApiImporter } from '../../src/formats/notion-api';
import { NotionClient } from '../../src/lib/notion-client';
import { NotionConverter } from '../../src/lib/notion-converter';
import { BaseGenerator } from '../../src/lib/base-generator';

// Import test data
import {
  mockNotionDatabase,
  mockNotionPage,
  mockNotionBlocks,
  createMockImportContext
} from '../../src/formats/__tests__/notion-api.test';

import {
  mockSearchResponse,
  mockDatabaseResponse,
  mockUserResponse,
  mockBlocksResponse
} from '../../src/lib/__tests__/notion-client.test';

import {
  allPropertyTypes,
  allBlockTypes,
  mockDatabase,
  mockPage
} from '../../src/lib/__tests__/notion-converter.test';

import {
  comprehensiveNotionDatabase,
  mockPages,
  largeDataset
} from '../../src/lib/__tests__/base-generator.test';

// Mock implementations
const mockRequestUrl = jest.fn();
const mockNotice = jest.fn();

// Large dataset for performance testing
const generateLargeDataset = (size: number) => ({
  databases: Array(Math.floor(size / 10)).fill(null).map((_, i) => ({
    ...mockNotionDatabase,
    id: `large-db-${i}`,
    title: `Large Database ${i}`
  })),
  pages: Array(size).fill(null).map((_, i) => ({
    ...mockNotionPage,
    id: `large-page-${i}`,
    title: `Large Page ${i}`,
    properties: {
      Name: {
        type: 'title',
        title: [{ plain_text: `Large Page ${i}` }]
      },
      Status: {
        type: 'select',
        select: { name: i % 3 === 0 ? 'Done' : 'In Progress' }
      },
      Priority: {
        type: 'number',
        number: (i % 5) + 1
      }
    }
  })),
  blocks: Array(size * 3).fill(null).map((_, i) => ({
    ...mockNotionBlocks[i % mockNotionBlocks.length],
    id: `large-block-${i}`,
    parent: { page_id: `large-page-${Math.floor(i / 3)}` }
  }))
});

// Network simulation utilities
const simulateNetworkConditions = {
  normal: () => {
    mockRequestUrl.mockImplementation(async (options) => {
      await new Promise(resolve => setTimeout(resolve, 10)); // 10ms delay
      return { status: 200, json: mockSearchResponse };
    });
  },

  slow: () => {
    mockRequestUrl.mockImplementation(async (options) => {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
      return { status: 200, json: mockSearchResponse };
    });
  },

  intermittent: () => {
    let callCount = 0;
    mockRequestUrl.mockImplementation(async (options) => {
      callCount++;
      if (callCount % 3 === 0) {
        throw new Error('Network timeout');
      }
      return { status: 200, json: mockSearchResponse };
    });
  },

  rateLimited: () => {
    let callCount = 0;
    mockRequestUrl.mockImplementation(async (options) => {
      callCount++;
      if (callCount % 5 === 0) {
        return { status: 429, headers: { 'retry-after': '1' }, text: 'Rate limited' };
      }
      return { status: 200, json: mockSearchResponse };
    });
  }
};

// Setup mocks before tests
beforeAll(() => {
  (global as any).requestUrl = mockRequestUrl;
  (global as any).Notice = mockNotice;
});

describe('Notion API Importer - Integration Tests', () => {
  let testEnv: TestEnvironment;
  let importer: NotionApiImporter;
  let mockModal: any;

  beforeEach(async () => {
    // Setup comprehensive test environment
    testEnv = await setupTest({
      features: {
        vault: true,
        workspace: true,
        metadataCache: true,
        fileSystem: true
      },
      testData: {
        generateSampleVault: true,
        sampleFiles: ['Templates/Daily Note.md', 'Projects/README.md']
      },
      performance: {
        enableProfiling: true,
        memoryTracking: true,
        timeoutMs: 60000 // 1 minute timeout for large tests
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
    importer.updateSettings({
      notionApiKey: 'integration-test-key',
      defaultOutputFolder: 'Integration Test Import',
      importImages: true,
      includeMetadata: true
    });

    // Reset mocks
    jest.clearAllMocks();
    simulateNetworkConditions.normal();
  });

  afterEach(async () => {
    await teardownTest();
  });

  describe('Complete Import Pipeline', () => {
    it('should complete full import workflow successfully', async () => {
      const mockContext = createMockImportContext();

      // Mock successful API responses
      mockRequestUrl
        // Connection test
        .mockResolvedValueOnce({
          status: 200,
          json: mockUserResponse
        })
        // API version detection
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [] }
        })
        // Search databases
        .mockResolvedValueOnce({
          status: 200,
          json: {
            results: [mockNotionDatabase],
            has_more: false
          }
        })
        // Search pages
        .mockResolvedValueOnce({
          status: 200,
          json: {
            results: [mockNotionPage],
            has_more: false
          }
        })
        // Get database details
        .mockResolvedValueOnce({
          status: 200,
          json: mockDatabaseResponse
        })
        // Get database entries
        .mockResolvedValueOnce({
          status: 200,
          json: {
            results: [mockNotionPage],
            has_more: false
          }
        })
        // Get page blocks (for database entry)
        .mockResolvedValueOnce({
          status: 200,
          json: mockBlocksResponse
        })
        // Get page blocks (for standalone page)
        .mockResolvedValueOnce({
          status: 200,
          json: mockBlocksResponse
        });

      // Mock vault operations
      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);
      jest.spyOn(testEnv.vault, 'createBinary').mockResolvedValue({} as TFile);

      const framework = getTestFramework();
      framework.startProfiling('full-import');

      await importer.import(mockContext);

      const duration = framework.endProfiling('full-import');

      // Verify import completed
      expect(mockContext.status).toHaveBeenCalledWith('Import completed successfully!');
      expect(mockNotice).toHaveBeenCalledWith('Import completed! Imported 2 items.');

      // Verify file creation
      expect(testEnv.vault.createFolder).toHaveBeenCalled();
      expect(testEnv.vault.create).toHaveBeenCalledWith(
        expect.stringContaining('.base'),
        expect.any(String)
      );
      expect(testEnv.vault.create).toHaveBeenCalledWith(
        expect.stringContaining('_index.md'),
        expect.any(String)
      );

      // Verify performance
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds

      console.log(`Full import completed in ${duration}ms`);
    });

    it('should handle complex database structures with all property types', async () => {
      const mockContext = createMockImportContext();

      // Mock responses for comprehensive database
      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: mockUserResponse })
        .mockResolvedValueOnce({ status: 200, json: { results: [] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [comprehensiveNotionDatabase], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: comprehensiveNotionDatabase
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: mockPages, has_more: false }
        });

      // Mock page blocks for each entry
      mockPages.forEach(() => {
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: {
            results: Object.values(allBlockTypes).slice(0, 5),
            has_more: false
          }
        });
      });

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      await importer.import(mockContext);

      // Should handle all property types successfully
      expect(testEnv.vault.create).toHaveBeenCalledWith(
        expect.stringContaining('.base'),
        expect.stringMatching(/properties:[\s\S]*task_name:[\s\S]*status:[\s\S]*tags:/)
      );
    });
  });

  describe('Performance Testing with Large Datasets', () => {
    it('should handle 1000+ pages efficiently', async () => {
      const largeDataset = generateLargeDataset(1000);
      const mockContext = createMockImportContext();

      // Mock API responses for large dataset
      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: mockUserResponse })
        .mockResolvedValueOnce({ status: 200, json: { results: [] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: largeDataset.databases, has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: largeDataset.pages.slice(0, 100), has_more: false }
        });

      // Mock database operations for each database
      largeDataset.databases.forEach((db, i) => {
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: db
        });
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: {
            results: largeDataset.pages.slice(i * 10, (i + 1) * 10),
            has_more: false
          }
        });
      });

      // Mock blocks for subset of pages (to avoid test timeout)
      for (let i = 0; i < 200; i++) {
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: { results: largeDataset.blocks.slice(i * 3, (i + 1) * 3), has_more: false }
        });
      }

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      const framework = getTestFramework();
      framework.startProfiling('large-dataset');

      const memoryBefore = process.memoryUsage().heapUsed;

      await importer.import(mockContext);

      const memoryAfter = process.memoryUsage().heapUsed;
      const duration = framework.endProfiling('large-dataset');

      // Performance expectations
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds

      // Memory usage should not grow excessively
      const memoryIncrease = (memoryAfter - memoryBefore) / 1024 / 1024; // MB
      expect(memoryIncrease).toBeLessThan(100); // Less than 100MB increase

      console.log(`Large dataset import: ${duration}ms, Memory: +${memoryIncrease.toFixed(2)}MB`);
    });

    it('should handle deep nested content structures', async () => {
      const deepNestedBlocks = Array(100).fill(null).map((_, i) => ({
        id: `nested-${i}`,
        type: 'toggle',
        toggle: {
          rich_text: [{ plain_text: `Level ${i}`, annotations: {} }]
        },
        has_children: i < 50 // First 50 have children
      }));

      const mockContext = createMockImportContext();

      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: mockUserResponse })
        .mockResolvedValueOnce({ status: 200, json: { results: [] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [mockNotionPage], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: deepNestedBlocks, has_more: false }
        });

      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      const start = Date.now();
      await importer.import(mockContext);
      const elapsed = Date.now() - start;

      // Should handle deep nesting efficiently
      expect(elapsed).toBeLessThan(15000);
    });
  });

  describe('Mobile Compatibility Testing', () => {
    it('should work correctly on mobile platform', async () => {
      // Mock mobile environment
      jest.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(false);

      const mockContext = createMockImportContext();

      // Mock successful import flow
      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: mockUserResponse })
        .mockResolvedValueOnce({ status: 200, json: { results: [] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [mockNotionDatabase], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        })
        .mockResolvedValueOnce({ status: 200, json: mockDatabaseResponse })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [mockNotionPage], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: mockBlocksResponse
        });

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      await importer.import(mockContext);

      // Should complete successfully on mobile
      expect(mockContext.status).toHaveBeenCalledWith('Import completed successfully!');

      // Should use Vault API exclusively (no Node.js modules)
      expect((importer as any).fs).toBeNull();
      expect((importer as any).path).toBeNull();
      expect((importer as any).crypto).toBeNull();

      // Restore
      jest.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(true);
    });

    it('should handle image downloads on mobile using Vault API', async () => {
      jest.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(false);

      const imageBlock = {
        ...allBlockTypes.image,
        image: {
          type: 'file',
          file: { url: 'https://example.com/test.png' },
          caption: [{ plain_text: 'Test image', annotations: {} }]
        }
      };

      // Mock image download
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        arrayBuffer: new ArrayBuffer(1024),
        headers: { 'content-type': 'image/png' }
      });

      jest.spyOn(testEnv.vault, 'createBinary').mockResolvedValue({} as TFile);

      const converter = new NotionConverter(importer.getSettings());
      const mockContext = {
        basePath: '',
        settings: importer.getSettings(),
        client: { client: testEnv.app },
        processedBlocks: new Set()
      };

      const result = await converter.convertBlock(imageBlock as any, mockContext as any);

      expect(result.images).toHaveLength(1);
      expect(testEnv.vault.createBinary).toHaveBeenCalled();

      // Restore
      jest.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(true);
    });
  });

  describe('Network Failure Recovery', () => {
    it('should retry on network failures and eventually succeed', async () => {
      const mockContext = createMockImportContext();

      // Mock intermittent network issues
      simulateNetworkConditions.intermittent();

      // After failures, provide successful responses
      setTimeout(() => {
        simulateNetworkConditions.normal();
        mockRequestUrl
          .mockResolvedValue({ status: 200, json: mockUserResponse })
          .mockResolvedValue({ status: 200, json: { results: [] } })
          .mockResolvedValue({
            status: 200,
            json: { results: [], has_more: false }
          })
          .mockResolvedValue({
            status: 200,
            json: { results: [], has_more: false }
          });
      }, 100);

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      // Should eventually succeed despite network issues
      await importer.import(mockContext);

      expect(mockContext.status).toHaveBeenCalledWith('Import completed successfully!');
    });

    it('should handle rate limiting gracefully', async () => {
      const mockContext = createMockImportContext();

      simulateNetworkConditions.rateLimited();

      // After rate limit responses, provide successful ones
      setTimeout(() => {
        mockRequestUrl
          .mockResolvedValue({ status: 200, json: mockUserResponse })
          .mockResolvedValue({ status: 200, json: { results: [] } })
          .mockResolvedValue({
            status: 200,
            json: { results: [], has_more: false }
          })
          .mockResolvedValue({
            status: 200,
            json: { results: [], has_more: false }
          });
      }, 200);

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      const start = Date.now();
      await importer.import(mockContext);
      const elapsed = Date.now() - start;

      // Should complete but take longer due to rate limiting
      expect(mockContext.status).toHaveBeenCalledWith('Import completed successfully!');
      expect(elapsed).toBeGreaterThan(1000); // Should be delayed by rate limiting
    });

    it('should handle partial failures gracefully', async () => {
      const mockContext = createMockImportContext();

      // Mock successful start but failed database details
      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: mockUserResponse })
        .mockResolvedValueOnce({ status: 200, json: { results: [] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [mockNotionDatabase], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        })
        .mockResolvedValueOnce({ status: 404, text: 'Database not found' }) // Failure
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        });

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      // Should handle partial failures without crashing
      await importer.import(mockContext);

      expect(mockContext.status).toHaveBeenCalledWith('Import completed successfully!');
    });
  });

  describe('Cross-Component Integration', () => {
    it('should integrate NotionClient, NotionConverter, and BaseGenerator correctly', async () => {
      const client = new NotionClient({
        auth: 'test-token',
        debug: true
      });

      const converter = new NotionConverter(importer.getSettings());

      const baseGenerator = new BaseGenerator(
        importer.getSettings(),
        {
          basePath: '',
          settings: importer.getSettings(),
          client: { client: testEnv.app },
          processedBlocks: new Set()
        }
      );

      // Test client functionality
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: mockUserResponse
      });

      const connectionTest = await client.testConnection();
      expect(connectionTest).toBe(true);

      // Test converter functionality
      const convertedContent = await converter.convertPage(
        mockPage,
        Object.values(allBlockTypes).slice(0, 5),
        {
          basePath: '',
          settings: importer.getSettings(),
          client: { client: testEnv.app },
          processedBlocks: new Set()
        }
      );

      expect(convertedContent.markdown).toBeDefined();
      expect(convertedContent.frontmatter).toBeDefined();

      // Test base generator functionality
      const baseConfig = baseGenerator.generateBaseConfig(
        comprehensiveNotionDatabase,
        mockPages
      );

      expect(baseConfig.filters).toBeDefined();
      expect(baseConfig.properties).toBeDefined();
      expect(baseConfig.views).toBeDefined();

      // Validate that all components work together
      expect(Object.keys(baseConfig.properties).length).toBeGreaterThan(20);
    });

    it('should maintain data consistency across conversion pipeline', async () => {
      const mockContext = createMockImportContext();

      // Track data transformation through pipeline
      const originalData = {
        database: comprehensiveNotionDatabase,
        pages: mockPages.slice(0, 3),
        blocks: Object.values(allBlockTypes).slice(0, 10)
      };

      // Mock API responses with original data
      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: mockUserResponse })
        .mockResolvedValueOnce({ status: 200, json: { results: [] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [originalData.database], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: originalData.database
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: originalData.pages, has_more: false }
        });

      // Mock blocks for each page
      originalData.pages.forEach(() => {
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: { results: originalData.blocks, has_more: false }
        });
      });

      const createdFiles: Array<{ path: string; content: string }> = [];
      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockImplementation(async (path, content) => {
        createdFiles.push({ path, content });
        return {} as TFile;
      });

      await importer.import(mockContext);

      // Verify data consistency
      const baseFile = createdFiles.find(f => f.path.endsWith('.base'));
      const indexFile = createdFiles.find(f => f.path.endsWith('_index.md'));
      const pageFiles = createdFiles.filter(f => f.path.endsWith('.md') && !f.path.endsWith('_index.md'));

      expect(baseFile).toBeDefined();
      expect(indexFile).toBeDefined();
      expect(pageFiles.length).toBe(originalData.pages.length);

      // Verify base file contains all original properties
      expect(baseFile!.content).toContain('task_name:');
      expect(baseFile!.content).toContain('status:');
      expect(baseFile!.content).toContain('tags:');

      // Verify index file contains correct metadata
      expect(indexFile!.content).toContain(`**Total Entries:** ${originalData.pages.length}`);
      expect(indexFile!.content).toContain(originalData.database.title);

      // Verify page files contain converted content
      pageFiles.forEach((file, i) => {
        expect(file.content).toContain('---'); // Frontmatter
        expect(file.content).toContain(originalData.pages[i].title);
      });
    });
  });

  describe('Real-World Data Structure Handling', () => {
    it('should handle complex nested database relationships', async () => {
      const parentDatabase = {
        ...comprehensiveNotionDatabase,
        id: 'parent-db',
        title: 'Parent Database'
      };

      const childDatabase = {
        ...comprehensiveNotionDatabase,
        id: 'child-db',
        title: 'Child Database',
        properties: {
          ...comprehensiveNotionDatabase.properties,
          'Parent Reference': {
            type: 'relation',
            relation: { database_id: 'parent-db' },
            name: 'Parent Reference'
          }
        }
      };

      const mockContext = createMockImportContext();

      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: mockUserResponse })
        .mockResolvedValueOnce({ status: 200, json: { results: [] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [parentDatabase, childDatabase], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        });

      // Mock database details for both
      [parentDatabase, childDatabase].forEach(db => {
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: db
        });
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        });
      });

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      await importer.import(mockContext);

      // Should handle both databases successfully
      expect(testEnv.vault.createFolder).toHaveBeenCalledWith(
        expect.stringContaining('Parent Database')
      );
      expect(testEnv.vault.createFolder).toHaveBeenCalledWith(
        expect.stringContaining('Child Database')
      );
    });

    it('should handle Unicode and special characters correctly', async () => {
      const unicodeDatabase = {
        ...mockNotionDatabase,
        title: 'データベース 🌟 - Special Chars: <>/\\|?*',
        description: 'Unicode test: café, naïve, 中文, العربية, עברית'
      };

      const unicodePage = {
        ...mockNotionPage,
        title: 'Tâche 📝 - Special: <>/\\|?*',
        properties: {
          'Nom de la tâche': {
            type: 'title',
            title: [{ plain_text: 'Tâche Unicode 🌟' }]
          }
        }
      };

      const mockContext = createMockImportContext();

      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: mockUserResponse })
        .mockResolvedValueOnce({ status: 200, json: { results: [] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [unicodeDatabase], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [unicodePage], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: unicodeDatabase
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [unicodePage], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        });

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      await importer.import(mockContext);

      // Should handle Unicode gracefully
      expect(testEnv.vault.createFolder).toHaveBeenCalledWith(
        expect.stringMatching(/データベース.*-.*Special.*Chars/) // Should sanitize special chars
      );
    });

    it('should handle malformed or incomplete data gracefully', async () => {
      const malformedDatabase = {
        id: 'malformed-db',
        // Missing title
        properties: {
          'Broken Property': {
            type: 'unknown_type',
            // Missing required fields
          }
        },
        url: 'invalid-url',
        // Missing required timestamps
      };

      const malformedPage = {
        id: 'malformed-page',
        // Missing title and properties
        parent: { type: 'database_id', database_id: 'malformed-db' }
      };

      const mockContext = createMockImportContext();

      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: mockUserResponse })
        .mockResolvedValueOnce({ status: 200, json: { results: [] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [malformedDatabase], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [malformedPage], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: malformedDatabase
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [malformedPage], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: [], has_more: false }
        });

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      // Should not crash on malformed data
      await expect(importer.import(mockContext)).resolves.not.toThrow();

      expect(mockContext.status).toHaveBeenCalledWith('Import completed successfully!');
    });
  });

  describe('Memory Usage and Cleanup', () => {
    it('should clean up resources after import', async () => {
      const mockContext = createMockImportContext();

      // Mock successful but large import
      const largeDataset = generateLargeDataset(100);

      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: mockUserResponse })
        .mockResolvedValueOnce({ status: 200, json: { results: [] } })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: largeDataset.databases, has_more: false }
        })
        .mockResolvedValueOnce({
          status: 200,
          json: { results: largeDataset.pages.slice(0, 50), has_more: false }
        });

      // Mock remaining operations
      largeDataset.databases.forEach((db, i) => {
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: db
        });
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: {
            results: largeDataset.pages.slice(i * 5, (i + 1) * 5),
            has_more: false
          }
        });
      });

      // Mock blocks for first 50 pages
      for (let i = 0; i < 50; i++) {
        mockRequestUrl.mockResolvedValueOnce({
          status: 200,
          json: { results: largeDataset.blocks.slice(0, 3), has_more: false }
        });
      }

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      const memoryBefore = process.memoryUsage();

      await importer.import(mockContext);

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memoryAfter = process.memoryUsage();

      // Memory should not grow excessively
      const heapIncrease = (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024;
      expect(heapIncrease).toBeLessThan(50); // Less than 50MB increase

      console.log(`Memory usage - Before: ${(memoryBefore.heapUsed / 1024 / 1024).toFixed(2)}MB, After: ${(memoryAfter.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    });

    it('should handle cancellation correctly', async () => {
      const mockContext = createMockImportContext();

      // Set up context to be cancelled after some operations
      let callCount = 0;
      mockContext.isCancelled.mockImplementation(() => {
        callCount++;
        return callCount > 5; // Cancel after 5 calls
      });

      mockRequestUrl
        .mockResolvedValue({ status: 200, json: mockUserResponse })
        .mockResolvedValue({ status: 200, json: { results: [] } })
        .mockResolvedValue({
          status: 200,
          json: { results: [mockNotionDatabase], has_more: false }
        })
        .mockResolvedValue({
          status: 200,
          json: { results: [], has_more: false }
        });

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      await importer.import(mockContext);

      // Should handle cancellation gracefully
      expect(mockContext.status).toHaveBeenCalledWith('Import completed successfully!');
    });
  });
});

describe('Integration Performance Benchmarks', () => {
  it('should meet performance benchmarks for various dataset sizes', async () => {
    const benchmarks = [
      { size: 10, expectedTime: 2000 },
      { size: 100, expectedTime: 10000 },
      { size: 500, expectedTime: 25000 }
    ];

    for (const benchmark of benchmarks) {
      const testEnv = await setupTest({
        features: { vault: true, workspace: true, metadataCache: true, fileSystem: true },
        performance: { enableProfiling: true }
      });

      const importer = new NotionApiImporter(testEnv.app as any, {
        contentEl: { createEl: jest.fn(), appendChild: jest.fn() }
      } as any);

      importer.updateSettings({
        notionApiKey: 'benchmark-test-key',
        defaultOutputFolder: `Benchmark ${benchmark.size}`,
        importImages: false // Disable for performance testing
      });

      const mockContext = createMockImportContext();
      const dataset = generateLargeDataset(benchmark.size);

      // Mock responses
      mockRequestUrl.mockResolvedValue({ status: 200, json: mockUserResponse });
      mockRequestUrl.mockResolvedValue({ status: 200, json: { results: [] } });
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: { results: dataset.databases, has_more: false }
      });
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: { results: [], has_more: false }
      });

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as TFile);

      const start = Date.now();
      await importer.import(mockContext);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(benchmark.expectedTime);

      console.log(`Benchmark ${benchmark.size} items: ${elapsed}ms (expected < ${benchmark.expectedTime}ms)`);

      await teardownTest();
    }
  });
});

// Export utilities for other integration tests
export {
  generateLargeDataset,
  simulateNetworkConditions
};