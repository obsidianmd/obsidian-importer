import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { NotionApiImporter } from '../notion-api';
import { ImportContext } from '../../main';
import { Notice } from 'obsidian';

// Mock Obsidian API
jest.mock('obsidian', () => ({
	Notice: jest.fn(),
	normalizePath: (path: string) => path.replace(/\\/g, '/'),
	requestUrl: jest.fn(),
	Setting: jest.fn().mockImplementation(() => ({
		setName: jest.fn().mockReturnThis(),
		setDesc: jest.fn().mockReturnThis(),
		addText: jest.fn().mockReturnThis(),
	})),
}));

describe('NotionApiImporter', () => {
	let importer: NotionApiImporter;
	let mockContext: ImportContext;
	let mockVault: any;
	let mockApp: any;
	let mockModal: any;

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();
		
		// Create mock vault
		mockVault = {
			create: jest.fn(),
			createFolder: jest.fn(),
			getAbstractFileByPath: jest.fn(),
		};

		// Create mock app
		mockApp = {
			vault: mockVault,
		};

		// Create mock modal
		mockModal = {
			reportProgress: jest.fn(),
		};

		// Create mock context
		mockContext = {
			vault: mockVault,
			status: jest.fn(),
			reportProgress: jest.fn(),
			reportNoteSuccess: jest.fn(),
			reportFailed: jest.fn(),
			isCancelled: jest.fn().mockReturnValue(false),
		} as any;

		// Create importer instance with required arguments
		importer = new NotionApiImporter(mockApp, mockModal);
		(importer as any).vault = mockVault;
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('getName', () => {
		it('should return correct name', () => {
			expect(importer.getName()).toBe('Notion (API)');
		});
	});

	describe('getDescription', () => {
		it('should include data source API support in description', () => {
			const description = importer.getDescription();
			expect(description).toContain('data sources');
			expect(description).toContain('Sept 2025 API');
			expect(description).toContain('Database to Bases conversion');
		});
	});

	describe('Data Source API Support', () => {
		it('should detect API capabilities on import', async () => {
			const mockRequestUrl = require('obsidian').requestUrl;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { id: 'test-user' }
			}).mockResolvedValueOnce({
				status: 200,
				json: {
					results: [{
						object: 'database',
						data_source: {
							id: 'ds_123',
							type: 'page_source',
							source_data: { page_ids: ['page1', 'page2'] }
						}
					}]
				}
			});

			const detectApiCapabilities = (importer as any).detectApiCapabilities.bind(importer);
			await detectApiCapabilities();

			expect((importer as any).supportsDataSources).toBe(true);
			expect((importer as any).apiVersion).toBe('2025-09-15');
		});

		it('should fallback to standard API on error', async () => {
			const mockRequestUrl = require('obsidian').requestUrl;
			mockRequestUrl.mockRejectedValueOnce(new Error('API error'));

			const detectApiCapabilities = (importer as any).detectApiCapabilities.bind(importer);
			await detectApiCapabilities();

			expect((importer as any).supportsDataSources).toBe(false);
			expect((importer as any).apiVersion).toBe('2022-06-28');
		});
	});

	describe('Property Type Mapping', () => {
		const testPropertyMappings = [
			{ notionType: 'checkbox', obsidianType: 'boolean' },
			{ notionType: 'number', obsidianType: 'number' },
			{ notionType: 'date', obsidianType: 'date' },
			{ notionType: 'select', obsidianType: 'tag' },
			{ notionType: 'multi_select', obsidianType: 'tag' },
			{ notionType: 'rich_text', obsidianType: 'text' },
			{ notionType: 'title', obsidianType: 'text' },
			{ notionType: 'url', obsidianType: 'link' },
			{ notionType: 'email', obsidianType: 'text' },
			{ notionType: 'phone_number', obsidianType: 'text' },
			{ notionType: 'formula', obsidianType: 'text' },
			{ notionType: 'relation', obsidianType: 'link' },
			{ notionType: 'rollup', obsidianType: 'text' },
			{ notionType: 'created_time', obsidianType: 'date' },
			{ notionType: 'created_by', obsidianType: 'text' },
			{ notionType: 'last_edited_time', obsidianType: 'date' },
			{ notionType: 'last_edited_by', obsidianType: 'text' },
			{ notionType: 'people', obsidianType: 'text' },
			{ notionType: 'files', obsidianType: 'link' },
			{ notionType: 'status', obsidianType: 'tag' },
			{ notionType: 'unique_id', obsidianType: 'text' },
		];

		testPropertyMappings.forEach(({ notionType, obsidianType }) => {
			it(`should map ${notionType} to ${obsidianType}`, () => {
				const database = {
					id: 'db_123',
					title: [{ plain_text: 'Test Database' }],
					properties: {
						'Test Property': { type: notionType, id: 'prop_123' }
					}
				};

				const baseContent = (importer as any).createBaseFile(database);
				expect(baseContent).toContain(`type: ${obsidianType}`);
			});
		});
	});

	describe('Base File Creation', () => {
		it('should create valid YAML structure for Base files', () => {
			const database = {
				id: 'db_123',
				title: [{ plain_text: 'AI Resources' }],
				properties: {
					'Name': { type: 'title', id: 'title' },
					'Category': { type: 'select', id: 'cat' },
					'Priority': { type: 'number', id: 'pri' },
					'Done': { type: 'checkbox', id: 'done' }
				}
			};

			const baseContent = (importer as any).createBaseFile(database);
			
			// Check YAML structure
			expect(baseContent).toContain('views:');
			expect(baseContent).toContain('  - type: table');
			expect(baseContent).toContain('    name: AI Resources');
			expect(baseContent).toContain('    filters:');
			expect(baseContent).toContain('      and:');
			expect(baseContent).toContain('        - file.folder("Notion API Import/AI Resources/")');
			expect(baseContent).toContain('    columns:');
			
			// Check property mappings
			expect(baseContent).toContain('      - key: Name');
			expect(baseContent).toContain('        type: text');
			expect(baseContent).toContain('      - key: Category');
			expect(baseContent).toContain('        type: tag');
			expect(baseContent).toContain('      - key: Priority');
			expect(baseContent).toContain('        type: number');
			expect(baseContent).toContain('      - key: Done');
			expect(baseContent).toContain('        type: boolean');
		});

		it('should sanitize database names for folder creation', () => {
			const invalidChars = '<>:"|?*';
			const database = {
				id: 'db_123',
				title: [{ plain_text: `Test${invalidChars}Database` }],
				properties: {}
			};

			const sanitized = (importer as any).sanitizeFileName(
				(importer as any).getDatabaseTitle(database)
			);
			
			// Check that invalid characters are removed
			for (const char of invalidChars) {
				expect(sanitized).not.toContain(char);
			}
		});
	});

	describe('Data Source Handling', () => {
		it('should handle page_source data sources', async () => {
			const database = {
				id: 'db_123',
				title: [{ plain_text: 'Test DB' }],
				properties: {},
				data_source: {
					id: 'ds_123',
					type: 'page_source' as const,
					source_data: {
						page_ids: ['page1', 'page2']
					},
					created_time: '2025-09-15T00:00:00Z'
				}
			};

			const mockRequestUrl = require('obsidian').requestUrl;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { id: 'page1', properties: {} }
			}).mockResolvedValueOnce({
				status: 200,
				json: { id: 'page2', properties: {} }
			});

			(importer as any).supportsDataSources = true;
			const pages = await (importer as any).queryDatabaseWithDataSource(database);
			
			expect(pages).toHaveLength(2);
			expect(pages[0].id).toBe('page1');
			expect(pages[1].id).toBe('page2');
		});

		it('should handle wiki_source data sources', async () => {
			const database = {
				id: 'db_123',
				title: [{ plain_text: 'Test DB' }],
				properties: {},
				data_source: {
					id: 'ds_123',
					type: 'wiki_source' as const,
					source_data: {
						wiki_id: 'wiki_123'
					},
					created_time: '2025-09-15T00:00:00Z'
				}
			};

			const mockRequestUrl = require('obsidian').requestUrl;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: {
					results: [
						{ id: 'wiki_page1', properties: {} },
						{ id: 'wiki_page2', properties: {} }
					]
				}
			});

			(importer as any).supportsDataSources = true;
			const pages = await (importer as any).queryDatabaseWithDataSource(database);
			
			expect(pages).toHaveLength(2);
			expect(pages[0].id).toBe('wiki_page1');
		});

		it('should fallback to standard query for sample_data', async () => {
			const database = {
				id: 'db_123',
				title: [{ plain_text: 'Test DB' }],
				properties: {},
				data_source: {
					id: 'ds_123',
					type: 'sample_data' as const,
					source_data: {
						sample_type: 'demo'
					},
					created_time: '2025-09-15T00:00:00Z'
				}
			};

			const mockRequestUrl = require('obsidian').requestUrl;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: {
					results: [{ id: 'sample1' }],
					has_more: false
				}
			});

			(importer as any).supportsDataSources = true;
			const queryDatabaseSpy = jest.spyOn((importer as any), 'queryDatabase');
			
			await (importer as any).queryDatabaseWithDataSource(database);
			
			expect(queryDatabaseSpy).toHaveBeenCalledWith('db_123');
		});
	});

	describe('Rate Limiting', () => {
		it('should respect 3 requests per second limit', async () => {
			const startTime = Date.now();
			
			// Mock sleep function to track delays
			const sleepSpy = jest.spyOn((importer as any), 'sleep')
				.mockImplementation(() => Promise.resolve());
			
			// Make 3 rapid requests
			await (importer as any).notionRequest('test1');
			await (importer as any).notionRequest('test2');
			await (importer as any).notionRequest('test3');
			
			// Check that sleep was called to enforce rate limit
			expect(sleepSpy).toHaveBeenCalled();
		});
	});

	describe('Error Handling', () => {
		it('should handle missing API key', async () => {
			(importer as any).config = { apiKey: '' };
			
			await importer.import(mockContext);
			
			expect(Notice).toHaveBeenCalledWith('Please enter your Notion Integration Token');
		});

		it('should handle 401 unauthorized errors', async () => {
			const mockRequestUrl = require('obsidian').requestUrl;
			mockRequestUrl.mockRejectedValueOnce({
				message: '401 Unauthorized'
			});

			await expect((importer as any).notionRequest('test'))
				.rejects.toThrow('Invalid API token');
		});

		it('should handle no content found', async () => {
			(importer as any).config = { apiKey: 'secret_test' };
			
			const mockRequestUrl = require('obsidian').requestUrl;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { results: [], has_more: false }
			});

			const mockFolder = { path: '/test' };
			(importer as any).getOutputFolder = jest.fn().mockReturnValue(Promise.resolve(mockFolder));

			await importer.import(mockContext);
			
			expect(Notice).toHaveBeenCalledWith(
				'No content found in Notion workspace. Make sure your integration has access to the pages.'
			);
		});
	});

	describe('Pagination', () => {
		it('should handle paginated results', async () => {
			const mockRequestUrl = require('obsidian').requestUrl;
			
			// First page
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: {
					results: [{ id: 'page1' }],
					has_more: true,
					next_cursor: 'cursor123'
				}
			});
			
			// Second page
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: {
					results: [{ id: 'page2' }],
					has_more: false
				}
			});

			const results = await (importer as any).searchNotionContent();
			
			expect(results).toHaveLength(2);
			expect(results[0].id).toBe('page1');
			expect(results[1].id).toBe('page2');
		});
	});

	describe('Block Processing', () => {
		it('should convert paragraph blocks to markdown', async () => {
			const blocks = [{
				type: 'paragraph',
				paragraph: {
					rich_text: [{
						type: 'text',
						text: { content: 'Test paragraph' },
						plain_text: 'Test paragraph'
					}]
				}
			}];

			const markdown = await (importer as any).blocksToMarkdown(mockContext, blocks);
			expect(markdown).toContain('Test paragraph');
		});

		it('should convert heading blocks to markdown', async () => {
			const blocks = [
				{
					type: 'heading_1',
					heading_1: {
						rich_text: [{
							type: 'text',
							text: { content: 'Heading 1' },
							plain_text: 'Heading 1'
						}]
					}
				},
				{
					type: 'heading_2',
					heading_2: {
						rich_text: [{
							type: 'text',
							text: { content: 'Heading 2' },
							plain_text: 'Heading 2'
						}]
					}
				}
			];

			const markdown = await (importer as any).blocksToMarkdown(mockContext, blocks);
			expect(markdown).toContain('# Heading 1');
			expect(markdown).toContain('## Heading 2');
		});

		it('should handle bulleted lists', async () => {
			const blocks = [{
				type: 'bulleted_list_item',
				bulleted_list_item: {
					rich_text: [{
						type: 'text',
						text: { content: 'List item' },
						plain_text: 'List item'
					}]
				}
			}];

			const markdown = await (importer as any).blocksToMarkdown(mockContext, blocks);
			expect(markdown).toContain('- List item');
		});

		it('should handle numbered lists', async () => {
			const blocks = [{
				type: 'numbered_list_item',
				numbered_list_item: {
					rich_text: [{
						type: 'text',
						text: { content: 'List item' },
						plain_text: 'List item'
					}]
				}
			}];

			const markdown = await (importer as any).blocksToMarkdown(mockContext, blocks);
			expect(markdown).toContain('1. List item');
		});

		it('should handle code blocks', async () => {
			const blocks = [{
				type: 'code',
				code: {
					rich_text: [{
						type: 'text',
						text: { content: 'const x = 1;' },
						plain_text: 'const x = 1;'
					}],
					language: 'javascript'
				}
			}];

			const markdown = await (importer as any).blocksToMarkdown(mockContext, blocks);
			expect(markdown).toContain('```javascript');
			expect(markdown).toContain('const x = 1;');
			expect(markdown).toContain('```');
		});
	});
});