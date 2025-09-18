import { BaseGenerator } from '../src/formats/notion-api/base-generator';
import { NotionDatabase, NotionDataSource } from '../src/formats/notion-api/notion-client';

// Mock Obsidian
jest.mock('obsidian', () => ({
  Platform: {
    isDesktopApp: true,
    isMobileApp: false
  }
}));

describe('Notion API Importer - Core Tests', () => {
  let baseGenerator: BaseGenerator;

  beforeEach(() => {
    baseGenerator = new BaseGenerator();
  });

  describe('BaseGenerator', () => {
    it('should generate a valid base file with basic properties', () => {
      const database: NotionDatabase = {
        id: 'test-db',
        title: 'Test Database',
        properties: {
          'Name': {
            type: 'title',
            title: {}
          },
          'Status': {
            type: 'select',
            select: {
              options: [
                { id: '1', name: 'Not Started', color: 'red' },
                { id: '2', name: 'In Progress', color: 'yellow' },
                { id: '3', name: 'Completed', color: 'green' }
              ]
            }
          },
          'Priority': {
            type: 'multi_select',
            multi_select: {
              options: [
                { id: 'high', name: 'High', color: 'red' },
                { id: 'medium', name: 'Medium', color: 'yellow' },
                { id: 'low', name: 'Low', color: 'green' }
              ]
            }
          },
          'Due Date': {
            type: 'date',
            date: {}
          },
          'Completed': {
            type: 'checkbox',
            checkbox: {}
          }
        },
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-01T00:00:00.000Z'
      };

      const dataSources: NotionDataSource[] = [
        { id: 'ds-1', name: 'Main Data Source' }
      ];

      const baseContent = baseGenerator.generateBase(database, dataSources);

      // Check basic structure
      expect(baseContent).toContain('type: base');
      expect(baseContent).toContain('name: Test Database');
      expect(baseContent).toContain('properties:');
      expect(baseContent).toContain('views:');
      
      // Check property mappings
      expect(baseContent).toContain('name:');
      expect(baseContent).toContain('status:');
      expect(baseContent).toContain('priority:');
      expect(baseContent).toContain('due_date:');
      expect(baseContent).toContain('completed:');
      
      // Check property types
      expect(baseContent).toContain('type: text');
      expect(baseContent).toContain('type: select');
      expect(baseContent).toContain('type: multi_select');
      expect(baseContent).toContain('type: date');
      expect(baseContent).toContain('type: checkbox');
      
      // Check select options
      expect(baseContent).toContain('options: ["Not Started", "In Progress", "Completed"]');
      expect(baseContent).toContain('options: ["High", "Medium", "Low"]');
      
      // Check views
      expect(baseContent).toContain('Table View');
      expect(baseContent).toContain('Main Data Source View');
    });

    it('should handle empty databases gracefully', () => {
      const emptyDatabase: NotionDatabase = {
        id: 'empty-db',
        title: 'Empty Database',
        properties: {},
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-01T00:00:00.000Z'
      };

      const dataSources: NotionDataSource[] = [];
      const baseContent = baseGenerator.generateBase(emptyDatabase, dataSources);

      expect(baseContent).toContain('type: base');
      expect(baseContent).toContain('name: Empty Database');
      expect(baseContent).toContain('properties:');
      expect(baseContent).toContain('views:');
    });

    it('should sanitize property names correctly', () => {
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

      const baseContent = baseGenerator.generateBase(databaseWithSpecialChars, []);
      
      // Should sanitize property names in views
      expect(baseContent).toContain('- property_with_spaces');
      expect(baseContent).toContain('- property_with_dashes');
      expect(baseContent).toContain('- property_with_underscores');
      expect(baseContent).toContain('- property_with_dots');
    });

    it('should handle all major property types', () => {
      const comprehensiveDatabase: NotionDatabase = {
        id: 'comprehensive-db',
        title: 'Comprehensive Database',
        properties: {
          'Title': { type: 'title', title: {} },
          'Rich Text': { type: 'rich_text', rich_text: {} },
          'Number': { type: 'number', number: { format: 'number' } },
          'Select': { type: 'select', select: { options: [] } },
          'Multi Select': { type: 'multi_select', multi_select: { options: [] } },
          'Date': { type: 'date', date: {} },
          'Checkbox': { type: 'checkbox', checkbox: {} },
          'URL': { type: 'url', url: {} },
          'Email': { type: 'email', email: {} },
          'Phone': { type: 'phone_number', phone_number: {} },
          'People': { type: 'people', people: {} },
          'Files': { type: 'files', files: {} },
          'Relation': { type: 'relation', relation: {} },
          'Rollup': { type: 'rollup', rollup: {} },
          'Formula': { type: 'formula', formula: {} },
          'Created Time': { type: 'created_time', created_time: {} },
          'Last Edited Time': { type: 'last_edited_time', last_edited_time: {} },
          'Created By': { type: 'created_by', created_by: {} },
          'Last Edited By': { type: 'last_edited_by', last_edited_by: {} }
        },
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-01T00:00:00.000Z'
      };

      const baseContent = baseGenerator.generateBase(comprehensiveDatabase, []);
      
      // Should include all property types
      expect(baseContent).toContain('type: text'); // title, rich_text, email, phone_number, people, files, relation, rollup, formula, created_by, last_edited_by
      expect(baseContent).toContain('type: number'); // number
      expect(baseContent).toContain('type: select'); // select
      expect(baseContent).toContain('type: multi_select'); // multi_select
      expect(baseContent).toContain('type: date'); // date, created_time, last_edited_time
      expect(baseContent).toContain('type: checkbox'); // checkbox
      expect(baseContent).toContain('type: url'); // url
    });
  });

  describe('Performance', () => {
    it('should generate base files quickly', () => {
      const largeDatabase: NotionDatabase = {
        id: 'large-db',
        title: 'Large Database',
        properties: {},
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-01T00:00:00.000Z'
      };

      // Add many properties
      for (let i = 0; i < 100; i++) {
        largeDatabase.properties[`Property ${i}`] = {
          type: 'text',
          rich_text: {}
        };
      }

      const startTime = Date.now();
      const result = baseGenerator.generateBase(largeDatabase, []);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100); // Should complete in <100ms
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
