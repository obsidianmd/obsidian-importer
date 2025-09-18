import { BaseGenerator } from '../src/formats/notion-api/base-generator';
import { NotionDatabase, NotionDataSource } from '../src/formats/notion-api/notion-client';

describe('Notion API Importer', () => {
  describe('BaseGenerator', () => {
    it('should generate a valid base file', () => {
      const generator = new BaseGenerator();
      
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

      const baseContent = generator.generateBase(database, dataSources);

      // Check that the base file contains expected content
      expect(baseContent).toContain('type: base');
      expect(baseContent).toContain('name: Test Database');
      expect(baseContent).toContain('properties:');
      expect(baseContent).toContain('views:');
      
      // Check that properties are mapped correctly
      expect(baseContent).toContain('name:');
      expect(baseContent).toContain('type: text');
      expect(baseContent).toContain('type: select');
      expect(baseContent).toContain('type: multi_select');
      expect(baseContent).toContain('type: date');
      expect(baseContent).toContain('type: checkbox');
      
      // Check that select options are included
      expect(baseContent).toContain('options: ["Not Started", "In Progress", "Completed"]');
      expect(baseContent).toContain('options: ["High", "Medium", "Low"]');
      
      // Check that views are generated
      expect(baseContent).toContain('Table View');
      expect(baseContent).toContain('Main Data Source View');
    });

    it('should handle unsupported property types gracefully', () => {
      const generator = new BaseGenerator();
      
      const database: NotionDatabase = {
        id: 'test-db',
        title: 'Test Database',
        properties: {
          'Supported': {
            type: 'text',
            rich_text: {}
          },
          'Unsupported': {
            type: 'unsupported_type',
            some_property: {}
          }
        },
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-01T00:00:00.000Z'
      };

      const dataSources: NotionDataSource[] = [];
      const baseContent = generator.generateBase(database, dataSources);

      // Should include supported properties
      expect(baseContent).toContain('supported');
      expect(baseContent).toContain('type: text');
      
      // Should not include unsupported properties
      expect(baseContent).not.toContain('unsupported');
    });
  });
});
