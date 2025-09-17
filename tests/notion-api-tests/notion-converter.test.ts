/**
 * NotionConverter Test Suite
 *
 * Comprehensive unit tests for the NotionConverter class covering:
 * - All block type conversions
 * - Rich text formatting
 * - Property type conversions
 * - Database to Base conversion
 * - Utility functions
 * - Error handling
 * - Edge cases
 *
 * @author Notion API Importer Team
 * @version 2.0.0
 */

import { NotionConverter, COLOR_MAPPING, PROPERTY_TYPE_MAPPING } from '../lib/notion-converter';
import type {
  NotionPage,
  NotionDatabase,
  NotionBlock,
  NotionImporterSettings,
  ConversionContext
} from '../types';

// ============================================================================
// TEST SETUP AND MOCKS
// ============================================================================

const mockSettings: NotionImporterSettings = {
  notionApiKey: 'test-api-key',
  defaultOutputFolder: 'Test Import',
  importImages: true,
  preserveNotionBlocks: false,
  convertToMarkdown: true,
  includeMetadata: true
};

const mockContext: ConversionContext = {
  basePath: '/test/path',
  settings: mockSettings,
  client: {} as any,
  processedBlocks: new Set()
};

const mockPage: NotionPage = {
  id: 'test-page-id',
  title: 'Test Page',
  url: 'https://notion.so/test-page',
  lastEditedTime: '2024-01-01T00:00:00.000Z',
  createdTime: '2024-01-01T00:00:00.000Z',
  properties: {},
  parent: { type: 'workspace' }
};

const mockDatabase: NotionDatabase = {
  id: 'test-db-id',
  title: 'Test Database',
  description: 'A test database',
  properties: {
    'Name': {
      type: 'title',
      title: {}
    },
    'Status': {
      type: 'select',
      select: {
        options: [
          { name: 'Active', color: 'green' },
          { name: 'Inactive', color: 'red' }
        ]
      }
    },
    'Tags': {
      type: 'multi_select',
      multi_select: {
        options: [
          { name: 'Important', color: 'red' },
          { name: 'Urgent', color: 'orange' }
        ]
      }
    },
    'Count': {
      type: 'number',
      number: { format: 'number' }
    },
    'Due Date': {
      type: 'date',
      date: {}
    },
    'Done': {
      type: 'checkbox',
      checkbox: {}
    }
  },
  url: 'https://notion.so/test-database',
  lastEditedTime: '2024-01-01T00:00:00.000Z',
  createdTime: '2024-01-01T00:00:00.000Z'
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createRichText(content: string, annotations: any = {}): any[] {
  return [{
    type: 'text',
    text: { content },
    plain_text: content,
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
      ...annotations
    }
  }];
}

function createBlock(type: string, content: any = {}): NotionBlock {
  return {
    id: `block-${Math.random()}`,
    type,
    created_time: '2024-01-01T00:00:00.000Z',
    last_edited_time: '2024-01-01T00:00:00.000Z',
    archived: false,
    has_children: false,
    parent: { type: 'page_id', page_id: 'test-page' },
    [type]: content
  };
}

// ============================================================================
// MAIN TEST SUITE
// ============================================================================

describe('NotionConverter', () => {
  let converter: NotionConverter;

  beforeEach(() => {
    converter = new NotionConverter(mockSettings);
  });

  // ========================================================================
  // INITIALIZATION TESTS
  // ========================================================================

  describe('Initialization', () => {
    test('should initialize with correct settings', () => {
      expect(converter).toBeInstanceOf(NotionConverter);
    });

    test('should handle empty settings gracefully', () => {
      const emptyConverter = new NotionConverter({} as NotionImporterSettings);
      expect(emptyConverter).toBeInstanceOf(NotionConverter);
    });
  });

  // ========================================================================
  // RICH TEXT CONVERSION TESTS
  // ========================================================================

  describe('Rich Text Conversion', () => {
    test('should convert plain text', () => {
      const richText = createRichText('Hello World');
      const result = converter.convertRichText(richText);
      expect(result).toBe('Hello World');
    });

    test('should apply bold formatting', () => {
      const richText = createRichText('Bold Text', { bold: true });
      const result = converter.convertRichText(richText);
      expect(result).toBe('**Bold Text**');
    });

    test('should apply italic formatting', () => {
      const richText = createRichText('Italic Text', { italic: true });
      const result = converter.convertRichText(richText);
      expect(result).toBe('*Italic Text*');
    });

    test('should apply strikethrough formatting', () => {
      const richText = createRichText('Strikethrough Text', { strikethrough: true });
      const result = converter.convertRichText(richText);
      expect(result).toBe('~~Strikethrough Text~~');
    });

    test('should apply code formatting', () => {
      const richText = createRichText('Code Text', { code: true });
      const result = converter.convertRichText(richText);
      expect(result).toBe('`Code Text`');
    });

    test('should apply underline formatting', () => {
      const richText = createRichText('Underline Text', { underline: true });
      const result = converter.convertRichText(richText);
      expect(result).toBe('<u>Underline Text</u>');
    });

    test('should apply multiple formatting', () => {
      const richText = createRichText('Multi Format', {
        bold: true,
        italic: true,
        code: true
      });
      const result = converter.convertRichText(richText);
      expect(result).toBe('`***Multi Format***`');
    });

    test('should handle color formatting', () => {
      const richText = createRichText('Colored Text', { color: 'red' });
      const result = converter.convertRichText(richText);
      expect(result).toContain('style="color:#E03E3E"');
    });

    test('should convert links', () => {
      const richText = [{
        type: 'text',
        text: { content: 'Link Text', link: { url: 'https://example.com' } },
        plain_text: 'Link Text',
        href: 'https://example.com',
        annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
      }];
      const result = converter.convertRichText(richText);
      expect(result).toBe('[Link Text](https://example.com)');
    });

    test('should handle empty rich text arrays', () => {
      const result = converter.convertRichText([]);
      expect(result).toBe('');
    });

    test('should handle invalid rich text input', () => {
      const result = converter.convertRichText(null as any);
      expect(result).toBe('');
    });
  });

  // ========================================================================
  // BLOCK CONVERSION TESTS
  // ========================================================================

  describe('Block Conversion', () => {
    test('should convert paragraph blocks', async () => {
      const block = createBlock('paragraph', {
        rich_text: createRichText('This is a paragraph')
      });

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toBe('This is a paragraph');
    });

    test('should convert heading blocks', async () => {
      const h1Block = createBlock('heading_1', {
        rich_text: createRichText('Heading 1')
      });
      const h2Block = createBlock('heading_2', {
        rich_text: createRichText('Heading 2')
      });
      const h3Block = createBlock('heading_3', {
        rich_text: createRichText('Heading 3')
      });

      const h1Result = await converter.convertBlock(h1Block, mockContext);
      const h2Result = await converter.convertBlock(h2Block, mockContext);
      const h3Result = await converter.convertBlock(h3Block, mockContext);

      expect(h1Result.content).toBe('# Heading 1');
      expect(h2Result.content).toBe('## Heading 2');
      expect(h3Result.content).toBe('### Heading 3');
    });

    test('should convert list items', async () => {
      const bulletBlock = createBlock('bulleted_list_item', {
        rich_text: createRichText('Bullet item')
      });
      const numberedBlock = createBlock('numbered_list_item', {
        rich_text: createRichText('Numbered item')
      });

      const bulletResult = await converter.convertBlock(bulletBlock, mockContext);
      const numberedResult = await converter.convertBlock(numberedBlock, mockContext);

      expect(bulletResult.content).toBe('- Bullet item');
      expect(numberedResult.content).toBe('1. Numbered item');
    });

    test('should convert todo items', async () => {
      const checkedTodo = createBlock('to_do', {
        rich_text: createRichText('Completed task'),
        checked: true
      });
      const uncheckedTodo = createBlock('to_do', {
        rich_text: createRichText('Incomplete task'),
        checked: false
      });

      const checkedResult = await converter.convertBlock(checkedTodo, mockContext);
      const uncheckedResult = await converter.convertBlock(uncheckedTodo, mockContext);

      expect(checkedResult.content).toBe('- [x] Completed task');
      expect(uncheckedResult.content).toBe('- [ ] Incomplete task');
    });

    test('should convert toggle blocks', async () => {
      const block = createBlock('toggle', {
        rich_text: createRichText('Toggle content')
      });

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toContain('<details><summary>Toggle content</summary>');
    });

    test('should convert quote blocks', async () => {
      const block = createBlock('quote', {
        rich_text: createRichText('Quoted text')
      });

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toBe('> Quoted text');
    });

    test('should convert callout blocks', async () => {
      const block = createBlock('callout', {
        rich_text: createRichText('Important note'),
        icon: { type: 'emoji', emoji: '⚠️' }
      });

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toContain('[!warning] ⚠️');
      expect(result.content).toContain('Important note');
    });

    test('should convert divider blocks', async () => {
      const block = createBlock('divider', {});

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toBe('---');
    });

    test('should convert code blocks', async () => {
      const block = createBlock('code', {
        rich_text: createRichText('console.log("Hello");'),
        language: 'javascript'
      });

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toBe('```javascript\nconsole.log("Hello");\n```');
    });

    test('should convert equation blocks', async () => {
      const block = createBlock('equation', {
        expression: 'E = mc^2'
      });

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toBe('$$E = mc^2$$');
    });

    test('should convert bookmark blocks', async () => {
      const block = createBlock('bookmark', {
        url: 'https://example.com',
        caption: createRichText('Example Site')
      });

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toBe('[Example Site](https://example.com)');
    });

    test('should convert child page blocks', async () => {
      const block = createBlock('child_page', {
        title: 'Child Page Title',
        id: 'child-page-id'
      });

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toBe('[[Child Page Title]]');
    });

    test('should convert child database blocks', async () => {
      const block = createBlock('child_database', {
        title: 'Child Database'
      });

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toBe('![[Child Database.base]]');
    });

    test('should handle unknown block types', async () => {
      const block = createBlock('unknown_type', {
        some_property: 'some value'
      });

      const result = await converter.convertBlock(block, mockContext);
      expect(result.content).toContain('<!-- Unknown block type: unknown_type -->');
    });
  });

  // ========================================================================
  // PROPERTY CONVERSION TESTS
  // ========================================================================

  describe('Property Conversion', () => {
    test('should extract title property values', () => {
      const property = {
        type: 'title',
        title: createRichText('Test Title')
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toBe('Test Title');
    });

    test('should extract rich text property values', () => {
      const property = {
        type: 'rich_text',
        rich_text: createRichText('Rich text content')
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toBe('Rich text content');
    });

    test('should extract number property values', () => {
      const property = {
        type: 'number',
        number: 42
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toBe(42);
    });

    test('should extract select property values', () => {
      const property = {
        type: 'select',
        select: { name: 'Option A', color: 'blue' }
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toBe('Option A');
    });

    test('should extract multi-select property values', () => {
      const property = {
        type: 'multi_select',
        multi_select: [
          { name: 'Tag1', color: 'blue' },
          { name: 'Tag2', color: 'red' }
        ]
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toEqual(['Tag1', 'Tag2']);
    });

    test('should extract date property values', () => {
      const property = {
        type: 'date',
        date: { start: '2024-01-01', end: '2024-01-02' }
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toBe('2024-01-01 to 2024-01-02');
    });

    test('should extract checkbox property values', () => {
      const checkedProperty = {
        type: 'checkbox',
        checkbox: true
      };
      const uncheckedProperty = {
        type: 'checkbox',
        checkbox: false
      };

      expect(converter.extractPropertyValue(checkedProperty as any)).toBe(true);
      expect(converter.extractPropertyValue(uncheckedProperty as any)).toBe(false);
    });

    test('should extract URL property values', () => {
      const property = {
        type: 'url',
        url: 'https://example.com'
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toBe('https://example.com');
    });

    test('should extract email property values', () => {
      const property = {
        type: 'email',
        email: 'test@example.com'
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toBe('test@example.com');
    });

    test('should extract phone number property values', () => {
      const property = {
        type: 'phone_number',
        phone_number: '+1-555-123-4567'
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toBe('+1-555-123-4567');
    });

    test('should extract people property values', () => {
      const property = {
        type: 'people',
        people: [
          { name: 'John Doe', id: 'user1' },
          { name: 'Jane Smith', id: 'user2' }
        ]
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toEqual(['John Doe', 'Jane Smith']);
    });

    test('should extract files property values', () => {
      const property = {
        type: 'files',
        files: [
          { name: 'document.pdf' },
          { name: 'image.jpg' }
        ]
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toEqual(['document.pdf', 'image.jpg']);
    });

    test('should extract formula property values', () => {
      const numberFormula = {
        type: 'formula',
        formula: { type: 'number', number: 42 }
      };
      const stringFormula = {
        type: 'formula',
        formula: { type: 'string', string: 'Calculated' }
      };

      expect(converter.extractPropertyValue(numberFormula as any)).toBe(42);
      expect(converter.extractPropertyValue(stringFormula as any)).toBe('Calculated');
    });

    test('should extract relation property values', () => {
      const property = {
        type: 'relation',
        relation: [
          { id: 'page1' },
          { id: 'page2' }
        ]
      };

      const result = converter.extractPropertyValue(property as any);
      expect(result).toEqual(['page1', 'page2']);
    });

    test('should extract unique ID property values', () => {
      const propertyWithPrefix = {
        type: 'unique_id',
        unique_id: { prefix: 'TASK', number: 123 }
      };
      const propertyWithoutPrefix = {
        type: 'unique_id',
        unique_id: { number: 456 }
      };

      expect(converter.extractPropertyValue(propertyWithPrefix as any)).toBe('TASK-123');
      expect(converter.extractPropertyValue(propertyWithoutPrefix as any)).toBe('456');
    });

    test('should handle null property values', () => {
      const result = converter.extractPropertyValue(null as any);
      expect(result).toBeNull();
    });

    test('should handle undefined property values', () => {
      const result = converter.extractPropertyValue(undefined as any);
      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // DATABASE TO BASE CONVERSION TESTS
  // ========================================================================

  describe('Database to Base Conversion', () => {
    test('should convert database to Base configuration', () => {
      const entries: NotionPage[] = [
        { ...mockPage, title: 'Entry 1' },
        { ...mockPage, title: 'Entry 2' }
      ];

      const result = converter.convertDatabaseToBase(mockDatabase, entries, mockContext);

      expect(result).toContain('Test Database Database');
      expect(result).toContain('filters:');
      expect(result).toContain('properties:');
      expect(result).toContain('views:');
    });

    test('should handle database with no properties', () => {
      const emptyDatabase: NotionDatabase = {
        ...mockDatabase,
        properties: {}
      };

      const result = converter.convertDatabaseToBase(emptyDatabase, [], mockContext);
      expect(result).toBeDefined();
      expect(result).toContain('properties:');
    });

    test('should handle database with complex properties', () => {
      const complexDatabase: NotionDatabase = {
        ...mockDatabase,
        properties: {
          'Formula Test': {
            type: 'formula',
            formula: { expression: 'prop("Count") * 2' }
          },
          'Rollup Test': {
            type: 'rollup',
            rollup: { function: 'sum' }
          },
          'Relation Test': {
            type: 'relation',
            relation: { database_id: 'other-db' }
          }
        }
      };

      const result = converter.convertDatabaseToBase(complexDatabase, [], mockContext);
      expect(result).toContain('Formula Test:');
      expect(result).toContain('Rollup Test:');
      expect(result).toContain('Relation Test:');
    });
  });

  // ========================================================================
  // UTILITY FUNCTION TESTS
  // ========================================================================

  describe('Utility Functions', () => {
    test('should sanitize filenames correctly', () => {
      expect(converter.sanitizeFileName('Normal File')).toBe('Normal File');
      expect(converter.sanitizeFileName('File<>:"/\\|?*Name')).toBe('File-----------Name');
      expect(converter.sanitizeFileName('  Spaced File  ')).toBe('Spaced File');
      expect(converter.sanitizeFileName('')).toBe('');

      // Test length limitation
      const longName = 'a'.repeat(300);
      expect(converter.sanitizeFileName(longName).length).toBeLessThanOrEqual(255);
    });

    test('should convert colors correctly', () => {
      expect(converter.convertColor('red')).toBe('#E03E3E');
      expect(converter.convertColor('blue')).toBe('#0B6E99');
      expect(converter.convertColor('green')).toBe('#0F7B6C');
      expect(converter.convertColor('default')).toBe('');
      expect(converter.convertColor('nonexistent')).toBe('');
    });

    test('should extract plain text correctly', () => {
      const richText = [
        createRichText('Hello ')[0],
        createRichText('World', { bold: true })[0]
      ];

      const result = converter.extractPlainText(richText);
      expect(result).toBe('Hello World');
    });

    test('should handle invalid plain text input', () => {
      expect(converter.extractPlainText(null as any)).toBe('');
      expect(converter.extractPlainText(undefined as any)).toBe('');
      expect(converter.extractPlainText([])).toBe('');
    });

    test('should generate frontmatter correctly', () => {
      const data = {
        title: 'Test Page',
        created: '2024-01-01',
        tags: ['tag1', 'tag2'],
        nullValue: null,
        undefinedValue: undefined
      };

      const result = converter.generateFrontmatter(data);
      expect(result.title).toBe('Test Page');
      expect(result.created).toBe('2024-01-01');
      expect(result.tags).toEqual(['tag1', 'tag2']);
      expect(result.nullValue).toBeUndefined();
      expect(result.undefinedValue).toBeUndefined();
    });
  });

  // ========================================================================
  // INTEGRATION TESTS
  // ========================================================================

  describe('Integration Tests', () => {
    test('should convert complete page with multiple block types', async () => {
      const blocks: NotionBlock[] = [
        createBlock('heading_1', { rich_text: createRichText('Main Title') }),
        createBlock('paragraph', { rich_text: createRichText('Introduction paragraph') }),
        createBlock('bulleted_list_item', { rich_text: createRichText('First bullet') }),
        createBlock('bulleted_list_item', { rich_text: createRichText('Second bullet') }),
        createBlock('code', {
          rich_text: createRichText('console.log("test");'),
          language: 'javascript'
        }),
        createBlock('quote', { rich_text: createRichText('Important quote') })
      ];

      const result = await converter.convertPage(mockPage, blocks, mockContext);

      expect(result.markdown).toContain('# Main Title');
      expect(result.markdown).toContain('Introduction paragraph');
      expect(result.markdown).toContain('- First bullet');
      expect(result.markdown).toContain('- Second bullet');
      expect(result.markdown).toContain('```javascript');
      expect(result.markdown).toContain('> Important quote');
      expect(result.frontmatter.title).toBe('Test Page');
    });

    test('should handle page conversion errors gracefully', async () => {
      const invalidBlocks = [
        { invalid: 'block' } as any
      ];

      // Should not throw, but handle gracefully
      const result = await converter.convertPage(mockPage, invalidBlocks, mockContext);
      expect(result).toBeDefined();
      expect(result.markdown).toBeDefined();
    });

    test('should handle complex nested content', async () => {
      const complexBlocks: NotionBlock[] = [
        createBlock('toggle', {
          rich_text: createRichText('Expandable section'),
          has_children: true
        }),
        createBlock('paragraph', {
          rich_text: [
            ...createRichText('Text with '),
            ...createRichText('bold', { bold: true }),
            ...createRichText(' and '),
            ...createRichText('italic', { italic: true }),
            ...createRichText(' formatting')
          ]
        }),
        createBlock('callout', {
          rich_text: createRichText('Important information'),
          icon: { type: 'emoji', emoji: '💡' }
        })
      ];

      const result = await converter.convertPage(mockPage, complexBlocks, mockContext);
      expect(result.markdown).toContain('<details>');
      expect(result.markdown).toContain('**bold**');
      expect(result.markdown).toContain('*italic*');
      expect(result.markdown).toContain('[!tip] 💡');
    });
  });

  // ========================================================================
  // ERROR HANDLING TESTS
  // ========================================================================

  describe('Error Handling', () => {
    test('should handle malformed rich text gracefully', () => {
      const malformedRichText = [
        { no_plain_text: true },
        null,
        undefined
      ] as any[];

      const result = converter.convertRichText(malformedRichText);
      expect(result).toBeDefined();
    });

    test('should handle malformed blocks gracefully', async () => {
      const malformedBlock = {
        id: 'malformed',
        type: 'paragraph'
        // Missing required properties
      } as any;

      const result = await converter.convertBlock(malformedBlock, mockContext);
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    test('should handle circular block references', async () => {
      const circularBlock = createBlock('paragraph', {
        rich_text: createRichText('Circular test')
      });

      // Add to processed blocks to simulate circular reference
      mockContext.processedBlocks.add(circularBlock.id);

      const result = await converter.convertBlock(circularBlock, mockContext);
      expect(result.content).toBe('');
    });

    test('should handle conversion context errors', async () => {
      const invalidContext = {
        ...mockContext,
        settings: null
      } as any;

      const block = createBlock('paragraph', {
        rich_text: createRichText('Test content')
      });

      // Should not throw
      const result = await converter.convertBlock(block, invalidContext);
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // EDGE CASE TESTS
  // ========================================================================

  describe('Edge Cases', () => {
    test('should handle empty blocks', async () => {
      const emptyBlock = createBlock('paragraph', { rich_text: [] });
      const result = await converter.convertBlock(emptyBlock, mockContext);
      expect(result.content).toBe('');
    });

    test('should handle blocks with null content', async () => {
      const nullBlock = createBlock('paragraph', { rich_text: null });
      const result = await converter.convertBlock(nullBlock, mockContext);
      expect(result).toBeDefined();
    });

    test('should handle very long content', async () => {
      const longContent = 'a'.repeat(10000);
      const longBlock = createBlock('paragraph', {
        rich_text: createRichText(longContent)
      });

      const result = await converter.convertBlock(longBlock, mockContext);
      expect(result.content).toContain(longContent);
    });

    test('should handle special characters in content', async () => {
      const specialContent = '`backticks` **stars** [brackets] | pipes | <<arrows>>';
      const specialBlock = createBlock('paragraph', {
        rich_text: createRichText(specialContent)
      });

      const result = await converter.convertBlock(specialBlock, mockContext);
      expect(result.content).toContain(specialContent);
    });

    test('should handle Unicode and emoji content', async () => {
      const unicodeContent = '🚀 Unicode: αβγ δεζ 中文 العربية Русский';
      const unicodeBlock = createBlock('paragraph', {
        rich_text: createRichText(unicodeContent)
      });

      const result = await converter.convertBlock(unicodeBlock, mockContext);
      expect(result.content).toContain(unicodeContent);
    });

    test('should handle database with no entries', () => {
      const result = converter.convertDatabaseToBase(mockDatabase, [], mockContext);
      expect(result).toBeDefined();
      expect(result).toContain('Test Database Database');
    });

    test('should handle database with null properties', () => {
      const nullPropsDatabase = {
        ...mockDatabase,
        properties: null as any
      };

      // Should not throw
      expect(() => {
        converter.convertDatabaseToBase(nullPropsDatabase, [], mockContext);
      }).not.toThrow();
    });
  });

  // ========================================================================
  // CONSTANTS AND MAPPINGS TESTS
  // ========================================================================

  describe('Constants and Mappings', () => {
    test('should have correct color mappings', () => {
      expect(COLOR_MAPPING.red).toBe('#E03E3E');
      expect(COLOR_MAPPING.blue).toBe('#0B6E99');
      expect(COLOR_MAPPING.green).toBe('#0F7B6C');
      expect(COLOR_MAPPING.default).toBe('');
    });

    test('should have correct property type mappings', () => {
      expect(PROPERTY_TYPE_MAPPING.title.type).toBe('text');
      expect(PROPERTY_TYPE_MAPPING.number.type).toBe('number');
      expect(PROPERTY_TYPE_MAPPING.select.type).toBe('select');
      expect(PROPERTY_TYPE_MAPPING.multi_select.type).toBe('tags');
      expect(PROPERTY_TYPE_MAPPING.checkbox.type).toBe('checkbox');
    });

    test('should cover all 21 property types', () => {
      const expectedTypes = [
        'title', 'rich_text', 'number', 'select', 'multi_select', 'status',
        'date', 'created_time', 'last_edited_time', 'people', 'created_by',
        'last_edited_by', 'files', 'checkbox', 'url', 'email', 'phone_number',
        'formula', 'relation', 'rollup', 'unique_id', 'verification'
      ];

      expectedTypes.forEach(type => {
        expect(PROPERTY_TYPE_MAPPING[type]).toBeDefined();
      });
    });
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('NotionConverter Performance', () => {
  let converter: NotionConverter;

  beforeEach(() => {
    converter = new NotionConverter(mockSettings);
  });

  test('should handle large rich text arrays efficiently', () => {
    const start = performance.now();

    const largeRichText = Array(1000).fill(null).map((_, i) =>
      createRichText(`Text chunk ${i}`)
    ).flat();

    const result = converter.convertRichText(largeRichText);

    const end = performance.now();

    expect(result).toBeDefined();
    expect(end - start).toBeLessThan(100); // Should complete in under 100ms
  });

  test('should handle large block arrays efficiently', async () => {
    const start = performance.now();

    const largeBlockArray = Array(100).fill(null).map((_, i) =>
      createBlock('paragraph', {
        rich_text: createRichText(`Paragraph ${i}`)
      })
    );

    const result = await converter.convertPage(mockPage, largeBlockArray, mockContext);

    const end = performance.now();

    expect(result).toBeDefined();
    expect(end - start).toBeLessThan(1000); // Should complete in under 1 second
  });
});