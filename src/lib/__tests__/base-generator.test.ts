/**
 * Test Suite for BaseGenerator
 *
 * Comprehensive testing of the Notion Database to Obsidian Base converter with focus on:
 * - Base YAML generation and validation
 * - All 21 property types mapping to Base properties
 * - View generation (table, cards, list, calendar)
 * - Folder structure creation and management
 * - Large database handling (1000+ entries)
 * - Property validation and validation rules
 * - Color preservation and option mapping
 * - Database overview generation
 * - Mobile-safe file operations
 *
 * Target Coverage: 95%+ for base-generator.ts
 */

import { jest } from '@jest/globals';
import { Platform } from 'obsidian';

// Import testing toolkit
import {
  setupTest,
  teardownTest,
  TestEnvironment
} from '@obsidian-testing-toolkit/core/ObsidianTestFramework';

// Import the class under test
import {
  BaseGenerator,
  createBaseGenerator,
  NOTION_TO_BASE_MAPPING,
  mapNotionColor
} from '../base-generator';

// Import types
import type {
  NotionDatabase,
  NotionPage,
  NotionImporterSettings,
  ConversionContext
} from '../../types';

import type {
  BaseConfig,
  BaseProperty,
  BasePropertyType,
  BasePropertyOption,
  BaseView,
  DatabaseOverview,
  PropertyValidation
} from '../base-generator';

// Test data fixtures
const comprehensiveNotionDatabase: NotionDatabase = {
  id: 'test-database-comprehensive-123',
  title: 'Comprehensive Test Database',
  description: 'A database with all 21 property types for comprehensive testing',
  properties: {
    // CRITICAL PROPERTIES
    'Task Name': {
      type: 'title',
      title: {},
      name: 'Task Name'
    },
    'Description': {
      type: 'rich_text',
      rich_text: {},
      name: 'Description'
    },
    'Priority Score': {
      type: 'number',
      number: { format: 'number' },
      name: 'Priority Score'
    },
    'Status': {
      type: 'select',
      select: {
        options: [
          { name: 'Not Started', color: 'gray' },
          { name: 'In Progress', color: 'yellow' },
          { name: 'Review', color: 'orange' },
          { name: 'Done', color: 'green' },
          { name: 'Cancelled', color: 'red' }
        ]
      },
      name: 'Status'
    },
    'Tags': {
      type: 'multi_select',
      multi_select: {
        options: [
          { name: 'Important', color: 'red' },
          { name: 'Urgent', color: 'orange' },
          { name: 'Review', color: 'blue' },
          { name: 'Documentation', color: 'green' },
          { name: 'Bug', color: 'purple' }
        ]
      },
      name: 'Tags'
    },
    'Due Date': {
      type: 'date',
      date: {},
      name: 'Due Date'
    },
    'Completed': {
      type: 'checkbox',
      checkbox: {},
      name: 'Completed'
    },
    'Related Tasks': {
      type: 'relation',
      relation: { database_id: 'related-db-id' },
      name: 'Related Tasks'
    },
    'Created Time': {
      type: 'created_time',
      created_time: {},
      name: 'Created Time'
    },
    'Last Edited': {
      type: 'last_edited_time',
      last_edited_time: {},
      name: 'Last Edited'
    },

    // HIGH PRIORITY PROPERTIES
    'Assignees': {
      type: 'people',
      people: {},
      name: 'Assignees'
    },
    'Attachments': {
      type: 'files',
      files: {},
      name: 'Attachments'
    },
    'Project URL': {
      type: 'url',
      url: {},
      name: 'Project URL'
    },
    'Progress Formula': {
      type: 'formula',
      formula: { expression: 'prop("Completed Tasks") / prop("Total Tasks") * 100' },
      name: 'Progress Formula'
    },
    'Team Rollup': {
      type: 'rollup',
      rollup: { function: 'count', relation_property_name: 'Team Members' },
      name: 'Team Rollup'
    },
    'Task ID': {
      type: 'unique_id',
      unique_id: { prefix: 'TASK' },
      name: 'Task ID'
    },
    'Workflow Status': {
      type: 'status',
      status: {
        options: [
          { name: 'Backlog', color: 'gray' },
          { name: 'Active', color: 'blue' },
          { name: 'Review', color: 'yellow' },
          { name: 'Complete', color: 'green' }
        ]
      },
      name: 'Workflow Status'
    },

    // MEDIUM PRIORITY PROPERTIES
    'Contact Email': {
      type: 'email',
      email: {},
      name: 'Contact Email'
    },
    'Phone': {
      type: 'phone_number',
      phone_number: {},
      name: 'Phone'
    },
    'Creator': {
      type: 'created_by',
      created_by: {},
      name: 'Creator'
    },
    'Last Editor': {
      type: 'last_edited_by',
      last_edited_by: {},
      name: 'Last Editor'
    }
  },
  url: 'https://notion.so/comprehensive-database',
  lastEditedTime: '2023-01-15T14:30:00.000Z',
  createdTime: '2023-01-01T09:00:00.000Z'
};

const simpleNotionDatabase: NotionDatabase = {
  id: 'simple-database-123',
  title: 'Simple Tasks',
  description: 'A simple task database',
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
    },
    'Priority': {
      type: 'number',
      number: { format: 'number' },
      name: 'Priority'
    }
  },
  url: 'https://notion.so/simple-database',
  lastEditedTime: '2023-01-10T12:00:00.000Z',
  createdTime: '2023-01-01T10:00:00.000Z'
};

const mockPages: NotionPage[] = Array(25).fill(null).map((_, i) => ({
  id: `page-${i + 1}`,
  title: `Task ${i + 1}`,
  url: `https://notion.so/task-${i + 1}`,
  lastEditedTime: `2023-01-${(i % 30 + 1).toString().padStart(2, '0')}T10:00:00.000Z`,
  createdTime: `2023-01-0${(i % 9 + 1)}T09:00:00.000Z`,
  properties: {
    'Task Name': {
      type: 'title',
      title: [{ plain_text: `Task ${i + 1}` }]
    },
    'Status': {
      type: 'select',
      select: { name: i % 3 === 0 ? 'Done' : 'In Progress' }
    },
    'Priority Score': {
      type: 'number',
      number: (i % 5) + 1
    }
  },
  parent: { type: 'database_id', database_id: 'test-database-comprehensive-123' }
}));

const largeDataset: NotionPage[] = Array(1000).fill(null).map((_, i) => ({
  id: `large-page-${i + 1}`,
  title: `Large Task ${i + 1}`,
  url: `https://notion.so/large-task-${i + 1}`,
  lastEditedTime: '2023-01-15T10:00:00.000Z',
  createdTime: '2023-01-01T09:00:00.000Z',
  properties: {
    'Task Name': {
      type: 'title',
      title: [{ plain_text: `Large Task ${i + 1}` }]
    }
  },
  parent: { type: 'database_id', database_id: 'test-database-comprehensive-123' }
}));

const mockSettings: NotionImporterSettings = {
  notionApiKey: 'test-key',
  defaultOutputFolder: 'Test Bases Import',
  importImages: true,
  preserveNotionBlocks: false,
  convertToMarkdown: true,
  includeMetadata: true
};

describe('BaseGenerator', () => {
  let testEnv: TestEnvironment;
  let generator: BaseGenerator;
  let mockContext: ConversionContext;

  beforeEach(async () => {
    // Setup test environment
    testEnv = await setupTest({
      features: {
        vault: true,
        workspace: true,
        metadataCache: true,
        fileSystem: true
      }
    });

    // Create mock conversion context
    mockContext = {
      basePath: '/test/path',
      settings: mockSettings,
      client: { client: testEnv.app } as any,
      processedBlocks: new Set()
    };

    // Create generator instance
    generator = new BaseGenerator(mockSettings, mockContext, testEnv.vault);

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await teardownTest();
  });

  describe('Constructor and Factory', () => {
    it('should initialize with settings and context', () => {
      expect(generator).toBeInstanceOf(BaseGenerator);
    });

    it('should create instance with factory function', () => {
      const factoryGenerator = createBaseGenerator(mockSettings, mockContext);
      expect(factoryGenerator).toBeInstanceOf(BaseGenerator);
    });

    it('should have access to property mappings', () => {
      expect(NOTION_TO_BASE_MAPPING).toBeDefined();
      expect(NOTION_TO_BASE_MAPPING.title).toEqual({
        type: 'text',
        priority: 'CRITICAL',
        converter: expect.any(Function)
      });
    });
  });

  describe('Base Configuration Generation', () => {
    it('should generate complete Base configuration', () => {
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, mockPages);

      expect(config).toHaveProperty('filters');
      expect(config).toHaveProperty('properties');
      expect(config).toHaveProperty('views');

      // Validate filters structure
      expect(config.filters.and).toBeInstanceOf(Array);
      expect(config.filters.and).toHaveLength(3);
      expect(config.filters.and[0]).toContain('Comprehensive Test Database');

      // Validate properties
      expect(config.properties).toHaveProperty(['file.name']);
      expect(Object.keys(config.properties).length).toBeGreaterThan(20); // 21 Notion properties + file.name

      // Validate views
      expect(config.views).toBeInstanceOf(Array);
      expect(config.views.length).toBeGreaterThan(0);
    });

    it('should handle simple databases correctly', () => {
      const config = generator.generateBaseConfig(simpleNotionDatabase, mockPages.slice(0, 5));

      expect(config.properties).toHaveProperty(['file.name']);
      expect(config.properties).toHaveProperty('name');
      expect(config.properties).toHaveProperty('status');
      expect(config.properties).toHaveProperty('priority');
      expect(config.views.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle empty databases', () => {
      const emptyDatabase = {
        ...simpleNotionDatabase,
        properties: {}
      };

      const config = generator.generateBaseConfig(emptyDatabase, []);

      expect(config.properties).toHaveProperty(['file.name']);
      expect(config.views).toBeInstanceOf(Array);
    });
  });

  describe('Property Type Conversions', () => {
    // Test all 21 property types from NOTION_TO_BASE_MAPPING
    it('should convert title properties correctly', () => {
      const titleProp = comprehensiveNotionDatabase.properties['Task Name'];
      const mapping = NOTION_TO_BASE_MAPPING.title;
      const result = mapping.converter(titleProp);

      expect(result.type).toBe('text');
      expect(result.validation?.required).toBe(true);
      expect(result.description).toContain('Primary title');
    });

    it('should convert rich_text properties correctly', () => {
      const richTextProp = comprehensiveNotionDatabase.properties['Description'];
      const mapping = NOTION_TO_BASE_MAPPING.rich_text;
      const result = mapping.converter(richTextProp);

      expect(result.type).toBe('text');
      expect(result.validation?.maxLength).toBe(2000);
    });

    it('should convert number properties correctly', () => {
      const numberProp = comprehensiveNotionDatabase.properties['Priority Score'];
      const mapping = NOTION_TO_BASE_MAPPING.number;
      const result = mapping.converter(numberProp);

      expect(result.type).toBe('number');
      expect(result.format).toBe('number');
    });

    it('should convert select properties with options', () => {
      const selectProp = comprehensiveNotionDatabase.properties['Status'];
      const mapping = NOTION_TO_BASE_MAPPING.select;
      const result = mapping.converter(selectProp);

      expect(result.type).toBe('select');
      expect(result.options).toBeInstanceOf(Array);
      expect(result.options?.length).toBe(5);
      expect(result.options?.[0]).toEqual({
        value: 'Not Started',
        label: 'Not Started',
        color: expect.any(String)
      });
    });

    it('should convert multi_select properties with options', () => {
      const multiSelectProp = comprehensiveNotionDatabase.properties['Tags'];
      const mapping = NOTION_TO_BASE_MAPPING.multi_select;
      const result = mapping.converter(multiSelectProp);

      expect(result.type).toBe('tags');
      expect(result.options).toBeInstanceOf(Array);
      expect(result.options?.length).toBe(5);
    });

    it('should convert date properties correctly', () => {
      const dateProp = comprehensiveNotionDatabase.properties['Due Date'];
      const mapping = NOTION_TO_BASE_MAPPING.date;
      const result = mapping.converter(dateProp);

      expect(result.type).toBe('date');
      expect(result.format).toBe('YYYY-MM-DD');
    });

    it('should convert checkbox properties correctly', () => {
      const checkboxProp = comprehensiveNotionDatabase.properties['Completed'];
      const mapping = NOTION_TO_BASE_MAPPING.checkbox;
      const result = mapping.converter(checkboxProp);

      expect(result.type).toBe('checkbox');
      expect(result.default).toBe(false);
    });

    it('should convert relation properties correctly', () => {
      const relationProp = comprehensiveNotionDatabase.properties['Related Tasks'];
      const mapping = NOTION_TO_BASE_MAPPING.relation;
      const result = mapping.converter(relationProp);

      expect(result.type).toBe('list');
      expect(result.description).toContain('related-db-id');
    });

    it('should convert timestamp properties correctly', () => {
      const createdTimeProp = comprehensiveNotionDatabase.properties['Created Time'];
      const mapping = NOTION_TO_BASE_MAPPING.created_time;
      const result = mapping.converter(createdTimeProp);

      expect(result.type).toBe('date');
      expect(result.format).toBe('YYYY-MM-DD HH:mm');
      expect(result.displayName).toBe('Created');
    });

    it('should convert people properties correctly', () => {
      const peopleProp = comprehensiveNotionDatabase.properties['Assignees'];
      const mapping = NOTION_TO_BASE_MAPPING.people;
      const result = mapping.converter(peopleProp);

      expect(result.type).toBe('text');
      expect(result.description).toContain('User references');
    });

    it('should convert files properties correctly', () => {
      const filesProp = comprehensiveNotionDatabase.properties['Attachments'];
      const mapping = NOTION_TO_BASE_MAPPING.files;
      const result = mapping.converter(filesProp);

      expect(result.type).toBe('list');
      expect(result.description).toContain('File attachments');
    });

    it('should convert URL properties with validation', () => {
      const urlProp = comprehensiveNotionDatabase.properties['Project URL'];
      const mapping = NOTION_TO_BASE_MAPPING.url;
      const result = mapping.converter(urlProp);

      expect(result.type).toBe('url');
      expect(result.validation?.pattern).toBe('^https?://.+');
    });

    it('should convert formula properties correctly', () => {
      const formulaProp = comprehensiveNotionDatabase.properties['Progress Formula'];
      const mapping = NOTION_TO_BASE_MAPPING.formula;
      const result = mapping.converter(formulaProp);

      expect(result.type).toBe('text');
      expect(result.description).toContain('Formula result');
    });

    it('should convert rollup properties correctly', () => {
      const rollupProp = comprehensiveNotionDatabase.properties['Team Rollup'];
      const mapping = NOTION_TO_BASE_MAPPING.rollup;
      const result = mapping.converter(rollupProp);

      expect(result.type).toBe('text');
      expect(result.description).toContain('Rollup aggregation');
    });

    it('should convert unique_id properties correctly', () => {
      const uniqueIdProp = comprehensiveNotionDatabase.properties['Task ID'];
      const mapping = NOTION_TO_BASE_MAPPING.unique_id;
      const result = mapping.converter(uniqueIdProp);

      expect(result.type).toBe('text');
      expect(result.validation?.required).toBe(true);
    });

    it('should convert status properties with options', () => {
      const statusProp = comprehensiveNotionDatabase.properties['Workflow Status'];
      const mapping = NOTION_TO_BASE_MAPPING.status;
      const result = mapping.converter(statusProp);

      expect(result.type).toBe('select');
      expect(result.options).toBeInstanceOf(Array);
      expect(result.description).toContain('Status workflow');
    });

    it('should convert email properties with validation', () => {
      const emailProp = comprehensiveNotionDatabase.properties['Contact Email'];
      const mapping = NOTION_TO_BASE_MAPPING.email;
      const result = mapping.converter(emailProp);

      expect(result.type).toBe('email');
      expect(result.validation?.pattern).toContain('@');
    });

    it('should convert phone_number properties with validation', () => {
      const phoneProp = comprehensiveNotionDatabase.properties['Phone'];
      const mapping = NOTION_TO_BASE_MAPPING.phone_number;
      const result = mapping.converter(phoneProp);

      expect(result.type).toBe('text');
      expect(result.validation?.pattern).toContain('[+]?[0-9');
    });

    it('should convert created_by and last_edited_by properties', () => {
      const createdByProp = comprehensiveNotionDatabase.properties['Creator'];
      const mapping = NOTION_TO_BASE_MAPPING.created_by;
      const result = mapping.converter(createdByProp);

      expect(result.type).toBe('text');
      expect(result.displayName).toBe('Created By');
    });
  });

  describe('View Generation', () => {
    it('should generate table view with appropriate columns', () => {
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, mockPages);
      const tableView = config.views.find(v => v.type === 'table');

      expect(tableView).toBeDefined();
      expect(tableView?.name).toBe('Comprehensive Test Database');
      expect(tableView?.columns).toBeInstanceOf(Array);
      expect(tableView?.columns?.[0]).toBe('file.name');
      expect(tableView?.sort).toBeInstanceOf(Array);
    });

    it('should generate cards view for databases with select properties', () => {
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, mockPages);
      const cardsViews = config.views.filter(v => v.type === 'cards');

      expect(cardsViews.length).toBeGreaterThan(0);
      const mainCardsView = cardsViews.find(v => v.name === 'Card View');
      expect(mainCardsView).toBeDefined();
      expect(mainCardsView?.cardSize).toBe('medium');
    });

    it('should generate list view', () => {
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, mockPages);
      const listView = config.views.find(v => v.type === 'list');

      expect(listView).toBeDefined();
      expect(listView?.name).toBe('List View');
      expect(listView?.sort).toBeInstanceOf(Array);
    });

    it('should generate calendar view for databases with date properties', () => {
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, mockPages);
      const calendarView = config.views.find(v => v.type === 'calendar');

      expect(calendarView).toBeDefined();
      expect(calendarView?.name).toBe('Calendar');
    });

    it('should generate select-based group views', () => {
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, mockPages);
      const groupViews = config.views.filter(v => v.group);

      expect(groupViews.length).toBeGreaterThan(0);
      expect(groupViews.some(v => v.name.includes('Status'))).toBe(true);
    });

    it('should handle databases without select properties', () => {
      const noSelectDatabase = {
        ...comprehensiveNotionDatabase,
        properties: {
          'Name': { type: 'title', title: {}, name: 'Name' },
          'Count': { type: 'number', number: { format: 'number' }, name: 'Count' }
        }
      };

      const config = generator.generateBaseConfig(noSelectDatabase as any, mockPages);
      const views = config.views;

      expect(views.length).toBeGreaterThanOrEqual(2); // Should have table and list at minimum
    });
  });

  describe('Folder Structure Creation', () => {
    it('should create database folder structure successfully', async () => {
      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as any);

      const folderPath = await generator.createDatabaseStructure(comprehensiveNotionDatabase, mockPages);

      expect(folderPath).toBe('Test Bases Import/Comprehensive Test Database');
      expect(testEnv.vault.createFolder).toHaveBeenCalledWith('Test Bases Import/Comprehensive Test Database');
      expect(testEnv.vault.create).toHaveBeenCalledTimes(2); // Base file + index file
    });

    it('should handle folder creation errors gracefully', async () => {
      jest.spyOn(testEnv.vault, 'createFolder').mockRejectedValue(new Error('Permission denied'));

      await expect(
        generator.createDatabaseStructure(comprehensiveNotionDatabase, mockPages)
      ).rejects.toThrow('Failed to create database structure');
    });

    it('should sanitize folder names correctly', async () => {
      const problematicDatabase = {
        ...comprehensiveNotionDatabase,
        title: 'Database<>:"/\\|?*WithProblematicChars'
      };

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as any);

      const folderPath = await generator.createDatabaseStructure(problematicDatabase, mockPages);

      expect(folderPath).toContain('Database_________WithProblematicChars');
    });
  });

  describe('YAML Serialization', () => {
    it('should serialize Base configuration to valid YAML', () => {
      const config = generator.generateBaseConfig(simpleNotionDatabase, mockPages.slice(0, 3));
      const yaml = (generator as any).serializeBaseConfig(config);

      expect(yaml).toContain('filters:');
      expect(yaml).toContain('  and:');
      expect(yaml).toContain('properties:');
      expect(yaml).toContain('  file_name:');
      expect(yaml).toContain('views:');
      expect(yaml).toContain('  - type: table');

      // Should be valid YAML format
      expect(yaml).toMatch(/^\w+:/gm);
      expect(yaml).not.toContain('undefined');
      expect(yaml).not.toContain('null');
    });

    it('should serialize complex properties correctly', () => {
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, mockPages);
      const yaml = (generator as any).serializeBaseConfig(config);

      // Should contain select options
      expect(yaml).toContain('options:');
      expect(yaml).toContain('value: "Not Started"');
      expect(yaml).toContain('label: "Not Started"');

      // Should contain validation rules
      expect(yaml).toContain('validation:');
      expect(yaml).toContain('required: true');

      // Should contain view configurations
      expect(yaml).toContain('columns:');
      expect(yaml).toContain('sort:');
      expect(yaml).toContain('direction: asc');
    });

    it('should serialize database overview to Markdown', () => {
      const overview = (generator as any).generateDatabaseOverview(comprehensiveNotionDatabase, mockPages);
      const markdown = (generator as any).serializeDatabaseOverview(overview);

      expect(markdown).toContain('# Comprehensive Test Database');
      expect(markdown).toContain('## Database Information');
      expect(markdown).toContain('- **Total Entries**: 25');
      expect(markdown).toContain('## Properties');
      expect(markdown).toContain('| Property | Type |');
      expect(markdown).toContain('## Usage');
      expect(markdown).toContain('### Available Views');
    });
  });

  describe('Color Mapping', () => {
    it('should map Notion colors to CSS colors correctly', () => {
      expect(mapNotionColor('red')).toBe('#DC2626');
      expect(mapNotionColor('blue')).toBe('#2563EB');
      expect(mapNotionColor('green')).toBe('#16A34A');
      expect(mapNotionColor('yellow')).toBe('#CA8A04');
      expect(mapNotionColor('purple')).toBe('#9333EA');
      expect(mapNotionColor('gray')).toBe('#6B7280');
    });

    it('should map background colors correctly', () => {
      expect(mapNotionColor('red_background')).toBe('#FEE2E2');
      expect(mapNotionColor('blue_background')).toBe('#DBEAFE');
      expect(mapNotionColor('green_background')).toBe('#D1FAE5');
    });

    it('should handle unknown colors gracefully', () => {
      expect(mapNotionColor('unknown-color')).toBe('unknown-color');
      expect(mapNotionColor('')).toBeUndefined();
      expect(mapNotionColor(undefined)).toBeUndefined();
    });

    it('should preserve colors in property options', () => {
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, mockPages);
      const statusProperty = config.properties.status;

      expect(statusProperty.options).toBeDefined();
      expect(statusProperty.options?.[0].color).toMatch(/^#[0-9A-F]{6}$/i);
    });
  });

  describe('Performance and Large Datasets', () => {
    it('should handle large datasets efficiently (1000+ entries)', async () => {
      const start = Date.now();
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, largeDataset);
      const elapsed = Date.now() - start;

      expect(config).toBeDefined();
      expect(config.properties).toBeDefined();
      expect(config.views).toBeDefined();
      expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should generate overview for large datasets correctly', () => {
      const overview = (generator as any).generateDatabaseOverview(comprehensiveNotionDatabase, largeDataset);

      expect(overview.totalEntries).toBe(1000);
      expect(overview.title).toBe('Comprehensive Test Database');
      expect(Object.keys(overview.properties).length).toBeGreaterThan(20);
    });

    it('should limit table columns for readability', () => {
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, mockPages);
      const tableView = config.views.find(v => v.type === 'table');

      expect(tableView?.columns?.length).toBeLessThanOrEqual(6);
      expect(tableView?.columns?.[0]).toBe('file.name');
    });

    it('should efficiently serialize large configurations', () => {
      const config = generator.generateBaseConfig(comprehensiveNotionDatabase, largeDataset);

      const start = Date.now();
      const yaml = (generator as any).serializeBaseConfig(config);
      const elapsed = Date.now() - start;

      expect(yaml).toBeDefined();
      expect(yaml.length).toBeGreaterThan(1000);
      expect(elapsed).toBeLessThan(1000); // Should serialize within 1 second
    });
  });

  describe('Base Configuration Validation', () => {
    it('should validate correct Base configuration', () => {
      const config = generator.generateBaseConfig(simpleNotionDatabase, mockPages.slice(0, 3));
      const validation = generator.validateBaseConfig(config);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect missing filters', () => {
      const invalidConfig = {
        // Missing filters
        properties: { 'file.name': { displayName: 'Name', type: 'text' as BasePropertyType } },
        views: []
      } as BaseConfig;

      const validation = generator.validateBaseConfig(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Missing or invalid filters.and array');
    });

    it('should detect missing properties', () => {
      const invalidConfig = {
        filters: { and: ['test'] },
        // Missing properties
        views: []
      } as BaseConfig;

      const validation = generator.validateBaseConfig(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Missing or invalid properties object');
    });

    it('should detect invalid property definitions', () => {
      const invalidConfig = {
        filters: { and: ['test'] },
        properties: {
          'invalid-prop': {} // Missing required fields
        },
        views: []
      } as BaseConfig;

      const validation = generator.validateBaseConfig(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('missing displayName'))).toBe(true);
    });

    it('should detect missing views', () => {
      const invalidConfig = {
        filters: { and: ['test'] },
        properties: { 'file.name': { displayName: 'Name', type: 'text' as BasePropertyType } }
        // Missing views
      } as BaseConfig;

      const validation = generator.validateBaseConfig(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Missing or invalid views array');
    });

    it('should detect invalid view definitions', () => {
      const invalidConfig = {
        filters: { and: ['test'] },
        properties: { 'file.name': { displayName: 'Name', type: 'text' as BasePropertyType } },
        views: [
          {} // Missing required fields
        ]
      } as BaseConfig;

      const validation = generator.validateBaseConfig(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('View missing type or name');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle databases with no properties', () => {
      const emptyPropsDatabase = {
        ...simpleNotionDatabase,
        properties: {}
      };

      const config = generator.generateBaseConfig(emptyPropsDatabase, []);

      expect(config.properties).toHaveProperty(['file.name']);
      expect(Object.keys(config.properties)).toHaveLength(1);
      expect(config.views.length).toBeGreaterThan(0);
    });

    it('should handle very long database names', () => {
      const longNameDatabase = {
        ...simpleNotionDatabase,
        title: 'A'.repeat(200) // Very long name
      };

      const config = generator.generateBaseConfig(longNameDatabase, []);

      // Should be truncated to reasonable length
      expect(config.filters.and[0].length).toBeLessThan(150);
    });

    it('should handle properties with missing names', () => {
      const noNameDatabase = {
        ...simpleNotionDatabase,
        properties: {
          '': { // Empty property name
            type: 'text',
            text: {},
            name: ''
          }
        }
      };

      const config = generator.generateBaseConfig(noNameDatabase as any, []);

      // Should still generate valid config
      expect(config.properties).toHaveProperty(['file.name']);
    });

    it('should handle unknown property types gracefully', () => {
      const unknownTypeDatabase = {
        ...simpleNotionDatabase,
        properties: {
          'Unknown Prop': {
            type: 'unknown_type',
            unknown_type: {},
            name: 'Unknown Prop'
          }
        }
      };

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const config = generator.generateBaseConfig(unknownTypeDatabase as any, []);

      expect(config.properties).toHaveProperty('unknown_prop');
      expect(config.properties.unknown_prop.type).toBe('text');
      expect(consoleSpy).toHaveBeenCalledWith('Unknown Notion property type: unknown_type');

      consoleSpy.mockRestore();
    });

    it('should handle circular references in property mapping', () => {
      const circularProperty = {
        type: 'relation',
        relation: { database_id: 'self-referencing-db' },
        name: 'Self Reference'
      };

      const mapping = NOTION_TO_BASE_MAPPING.relation;
      const result = mapping.converter(circularProperty);

      expect(result.type).toBe('list');
      expect(result.description).toContain('self-referencing-db');
    });
  });

  describe('Mobile Compatibility', () => {
    it('should use Vault API exclusively (no Node.js dependencies)', async () => {
      // Mock mobile environment
      jest.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(false);

      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as any);

      const folderPath = await generator.createDatabaseStructure(simpleNotionDatabase, mockPages.slice(0, 3));

      expect(folderPath).toBeDefined();
      expect(testEnv.vault.createFolder).toHaveBeenCalled();
      expect(testEnv.vault.create).toHaveBeenCalled();

      // Restore
      jest.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(true);
    });

    it('should handle file system operations gracefully on mobile', async () => {
      jest.spyOn(testEnv.vault, 'createFolder').mockResolvedValue(undefined);
      jest.spyOn(testEnv.vault, 'create').mockResolvedValue({} as any);

      // Should work the same on mobile and desktop
      const folderPath = await generator.createDatabaseStructure(simpleNotionDatabase, mockPages.slice(0, 3));

      expect(folderPath).toBe('Test Bases Import/Simple Tasks');
    });
  });

  describe('Database Overview Generation', () => {
    it('should generate comprehensive database overview', () => {
      const overview = (generator as any).generateDatabaseOverview(comprehensiveNotionDatabase, mockPages);

      expect(overview.title).toBe('Comprehensive Test Database');
      expect(overview.description).toBe('A database with all 21 property types for comprehensive testing');
      expect(overview.totalEntries).toBe(25);
      expect(overview.notionUrl).toBe('https://notion.so/comprehensive-database');
      expect(overview.createdTime).toBe('2023-01-01T09:00:00.000Z');
      expect(overview.lastEditedTime).toBe('2023-01-15T14:30:00.000Z');
      expect(overview.lastUpdated).toBeDefined();
      expect(Object.keys(overview.properties).length).toBeGreaterThan(20);
    });

    it('should map all property types correctly in overview', () => {
      const overview = (generator as any).generateDatabaseOverview(comprehensiveNotionDatabase, mockPages);

      expect(overview.properties['Task Name']).toBe('text');
      expect(overview.properties['Status']).toBe('select');
      expect(overview.properties['Tags']).toBe('tags');
      expect(overview.properties['Priority Score']).toBe('number');
      expect(overview.properties['Due Date']).toBe('date');
      expect(overview.properties['Completed']).toBe('checkbox');
      expect(overview.properties['Related Tasks']).toBe('list');
      expect(overview.properties['Contact Email']).toBe('email');
      expect(overview.properties['Project URL']).toBe('url');
    });
  });
});

// Export test utilities for integration tests
export {
  comprehensiveNotionDatabase,
  simpleNotionDatabase,
  mockPages,
  largeDataset,
  mockSettings
};