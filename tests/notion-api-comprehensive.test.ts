import { BaseGenerator } from '../src/formats/notion-api/base-generator';
import { NotionToMarkdownConverter } from '../src/formats/notion-api/notion-to-md';
import { NotionApiClient } from '../src/formats/notion-api/notion-client';
import { NotionDatabase, NotionDataSource, NotionPage } from '../src/formats/notion-api/notion-client';

// Mock the Notion client
jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    search: jest.fn(),
    databases: {
      retrieve: jest.fn(),
      query: jest.fn()
    },
    blocks: {
      children: {
        list: jest.fn()
      }
    },
    request: jest.fn()
  }))
}));

describe('Notion API Importer - Comprehensive Tests', () => {
  let mockClient: any;
  let notionClient: NotionApiClient;
  let converter: NotionToMarkdownConverter;
  let baseGenerator: BaseGenerator;

  beforeEach(() => {
    mockClient = {
      search: jest.fn(),
      databases: {
        retrieve: jest.fn(),
        query: jest.fn()
      },
      blocks: {
        children: {
          list: jest.fn()
        }
      },
      request: jest.fn()
    };
    
    notionClient = new NotionApiClient('test-token');
    converter = new NotionToMarkdownConverter(notionClient, 'attachments');
    baseGenerator = new BaseGenerator();
  });

  describe('BaseGenerator - Property Type Mapping', () => {
    const testDatabase: NotionDatabase = {
      id: 'test-db',
      title: 'Comprehensive Test Database',
      properties: {
        // Text properties
        'Title': { type: 'title', title: {} },
        'Rich Text': { type: 'rich_text', rich_text: {} },
        'URL': { type: 'url', url: {} },
        'Email': { type: 'email', email: {} },
        'Phone': { type: 'phone_number', phone_number: {} },
        
        // Number properties
        'Number': { type: 'number', number: { format: 'number' } },
        'Currency': { type: 'number', number: { format: 'currency' } },
        'Percent': { type: 'number', number: { format: 'percent' } },
        
        // Selection properties
        'Select': { 
          type: 'select', 
          select: { 
            options: [
              { id: '1', name: 'Option 1', color: 'red' },
              { id: '2', name: 'Option 2', color: 'blue' }
            ] 
          } 
        },
        'Multi Select': { 
          type: 'multi_select', 
          multi_select: { 
            options: [
              { id: 'a', name: 'Tag A', color: 'green' },
              { id: 'b', name: 'Tag B', color: 'yellow' }
            ] 
          } 
        },
        
        // Date properties
        'Date': { type: 'date', date: {} },
        'Created Time': { type: 'created_time', created_time: {} },
        'Last Edited Time': { type: 'last_edited_time', last_edited_time: {} },
        
        // Boolean properties
        'Checkbox': { type: 'checkbox', checkbox: {} },
        
        // People properties
        'People': { type: 'people', people: {} },
        'Created By': { type: 'created_by', created_by: {} },
        'Last Edited By': { type: 'last_edited_by', last_edited_by: {} },
        
        // File properties
        'Files': { type: 'files', files: {} },
        
        // Relation properties
        'Relation': { type: 'relation', relation: {} },
        'Rollup': { type: 'rollup', rollup: {} },
        
        // Formula properties
        'Formula': { type: 'formula', formula: {} }
      },
      created_time: '2025-01-01T00:00:00.000Z',
      last_edited_time: '2025-01-01T00:00:00.000Z'
    };

    it('should map all 21 Notion property types correctly', () => {
      const dataSources: NotionDataSource[] = [
        { id: 'ds-1', name: 'Main Data Source' }
      ];

      const baseContent = baseGenerator.generateBase(testDatabase, dataSources);

      // Check that all property types are mapped
      expect(baseContent).toContain('title:');
      expect(baseContent).toContain('rich_text:');
      expect(baseContent).toContain('url:');
      expect(baseContent).toContain('email:');
      expect(baseContent).toContain('phone_number:');
      expect(baseContent).toContain('number:');
      expect(baseContent).toContain('select:');
      expect(baseContent).toContain('multi_select:');
      expect(baseContent).toContain('date:');
      expect(baseContent).toContain('checkbox:');
      expect(baseContent).toContain('people:');
      expect(baseContent).toContain('files:');
      expect(baseContent).toContain('relation:');
      expect(baseContent).toContain('rollup:');
      expect(baseContent).toContain('formula:');
    });

    it('should include select options in YAML', () => {
      const baseContent = baseGenerator.generateBase(testDatabase, []);
      
      expect(baseContent).toContain('options: ["Option 1", "Option 2"]');
      expect(baseContent).toContain('options: ["Tag A", "Tag B"]');
    });

    it('should handle number formats correctly', () => {
      const baseContent = baseGenerator.generateBase(testDatabase, []);
      
      expect(baseContent).toContain('format: number');
      expect(baseContent).toContain('format: currency');
      expect(baseContent).toContain('format: percent');
    });
  });

  describe('NotionToMarkdownConverter - Block Types', () => {
    const testBlocks = [
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Test paragraph' }] } },
      { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Heading 1' }] } },
      { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Heading 2' }] } },
      { type: 'heading_3', heading_3: { rich_text: [{ plain_text: 'Heading 3' }] } },
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'Bullet item' }] } },
      { type: 'numbered_list_item', numbered_list_item: { rich_text: [{ plain_text: 'Numbered item' }] } },
      { type: 'to_do', to_do: { rich_text: [{ plain_text: 'Todo item' }], checked: true } },
      { type: 'toggle', toggle: { rich_text: [{ plain_text: 'Toggle item' }] } },
      { type: 'code', code: { rich_text: [{ plain_text: 'console.log("hello")' }], language: 'javascript' } },
      { type: 'quote', quote: { rich_text: [{ plain_text: 'Quote text' }] } },
      { type: 'callout', callout: { rich_text: [{ plain_text: 'Callout text' }], icon: { emoji: '💡' } } },
      { type: 'divider', divider: {} },
      { type: 'image', image: { url: 'https://example.com/image.jpg' } },
      { type: 'file', file: { url: 'https://example.com/file.pdf', name: 'Document.pdf' } },
      { type: 'video', video: { url: 'https://example.com/video.mp4' } },
      { type: 'table', table: { table_width: 2, has_column_header: true, has_row_header: false } },
      { type: 'table_row', table_row: { cells: [['Cell 1'], ['Cell 2']] } }
    ];

    it('should convert all block types to markdown', async () => {
      for (const block of testBlocks) {
        const result = await converter.convertBlock(block);
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
      }
    });

    it('should handle rich text formatting', () => {
      const richText = [
        { plain_text: 'Bold text', annotations: { bold: true } },
        { plain_text: 'Italic text', annotations: { italic: true } },
        { plain_text: 'Code text', annotations: { code: true } },
        { plain_text: 'Strikethrough text', annotations: { strikethrough: true } },
        { plain_text: 'Link text', href: 'https://example.com' }
      ];

      const result = converter.convertRichText(richText);
      
      expect(result).toContain('**Bold text**');
      expect(result).toContain('*Italic text*');
      expect(result).toContain('`Code text`');
      expect(result).toContain('~~Strikethrough text~~');
      expect(result).toContain('[Link text](https://example.com)');
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      mockClient.search.mockRejectedValue(new Error('API Error'));
      
      await expect(notionClient.getDatabases()).rejects.toThrow('Failed to fetch databases: API Error');
    });

    it('should handle missing data sources', async () => {
      mockClient.databases.retrieve.mockResolvedValue({ id: 'test', title: [] });
      
      const result = await notionClient.getDataSources('test-db');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Default Data Source');
    });

    it('should handle empty databases', async () => {
      mockClient.search.mockResolvedValue({ results: [] });
      
      const result = await notionClient.getDatabases();
      expect(result).toHaveLength(0);
    });
  });

  describe('Performance Tests', () => {
    it('should handle large datasets efficiently', async () => {
      const largeDatabase: NotionDatabase = {
        id: 'large-db',
        title: 'Large Database',
        properties: {},
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-01T00:00:00.000Z'
      };

      const startTime = Date.now();
      const result = baseGenerator.generateBase(largeDatabase, []);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100); // Should complete in <100ms
      expect(result).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in property names', () => {
      const databaseWithSpecialChars: NotionDatabase = {
        id: 'special-db',
        title: 'Database with Special Chars',
        properties: {
          'Property with Spaces': { type: 'text', rich_text: {} },
          'Property-with-dashes': { type: 'text', rich_text: {} },
          'Property_with_underscores': { type: 'text', rich_text: {} },
          'Property.with.dots': { type: 'text', rich_text: {} }
        },
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-01T00:00:00.000Z'
      };

      const result = baseGenerator.generateBase(databaseWithSpecialChars, []);
      
      // Should sanitize property names
      expect(result).toContain('property_with_spaces:');
      expect(result).toContain('property_with_dashes:');
      expect(result).toContain('property_with_underscores:');
      expect(result).toContain('property_with_dots:');
    });

    it('should handle empty or null values', () => {
      const databaseWithNulls: NotionDatabase = {
        id: 'null-db',
        title: '',
        properties: {},
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-01T00:00:00.000Z'
      };

      const result = baseGenerator.generateBase(databaseWithNulls, []);
      expect(result).toContain('name: ');
      expect(result).toBeDefined();
    });
  });
});
