/**
 * Test Suite for NotionConverter
 *
 * Comprehensive testing of the Notion to Obsidian content converter with focus on:
 * - All 15+ Notion block types conversion
 * - All 21 Notion property types conversion
 * - Rich text formatting preservation
 * - Nested content and children handling
 * - Database-to-Base conversion
 * - Edge cases (unicode, empty data, malformed content)
 * - Media handling (images, videos, files)
 * - Internal link conversion
 *
 * Target Coverage: 90%+ for notion-converter.ts
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
  NotionConverter,
  COLOR_MAPPING,
  PROPERTY_TYPE_MAPPING,
  BLOCK_HIERARCHY
} from '../notion-converter';

// Import types
import type {
  NotionPage,
  NotionDatabase,
  NotionBlock,
  NotionImporterSettings,
  ProcessedContent,
  ConversionContext
} from '../../types';

// Test data fixtures for all 21 property types
const allPropertyTypes = {
  // CRITICAL PROPERTY TYPES
  title: {
    type: 'title',
    title: [
      {
        type: 'text',
        text: { content: 'Test Title' },
        plain_text: 'Test Title',
        annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
      }
    ]
  },
  rich_text: {
    type: 'rich_text',
    rich_text: [
      {
        type: 'text',
        text: { content: 'Rich text content with ' },
        plain_text: 'Rich text content with ',
        annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
      },
      {
        type: 'text',
        text: { content: 'formatting' },
        plain_text: 'formatting',
        annotations: { bold: true, italic: true, strikethrough: false, underline: false, code: false, color: 'red' }
      }
    ]
  },
  number: {
    type: 'number',
    number: 42.5
  },
  select: {
    type: 'select',
    select: {
      id: 'select-1',
      name: 'Done',
      color: 'green'
    }
  },
  multi_select: {
    type: 'multi_select',
    multi_select: [
      { id: 'tag-1', name: 'Important', color: 'red' },
      { id: 'tag-2', name: 'Review', color: 'blue' }
    ]
  },
  date: {
    type: 'date',
    date: {
      start: '2023-01-01',
      end: '2023-01-03',
      time_zone: 'America/New_York'
    }
  },
  checkbox: {
    type: 'checkbox',
    checkbox: true
  },
  relation: {
    type: 'relation',
    relation: [
      { id: 'related-page-1' },
      { id: 'related-page-2' }
    ]
  },
  created_time: {
    type: 'created_time',
    created_time: '2023-01-01T10:00:00.000Z'
  },
  last_edited_time: {
    type: 'last_edited_time',
    last_edited_time: '2023-01-02T15:30:00.000Z'
  },

  // HIGH PRIORITY PROPERTY TYPES
  people: {
    type: 'people',
    people: [
      {
        id: 'user-1',
        name: 'John Doe',
        avatar_url: 'https://example.com/avatar1.jpg'
      },
      {
        id: 'user-2',
        name: 'Jane Smith',
        avatar_url: 'https://example.com/avatar2.jpg'
      }
    ]
  },
  files: {
    type: 'files',
    files: [
      {
        type: 'file',
        name: 'document.pdf',
        file: {
          url: 'https://notion.so/file.pdf',
          expiry_time: '2023-12-31T23:59:59.000Z'
        }
      },
      {
        type: 'external',
        name: 'External File',
        external: {
          url: 'https://example.com/external-file.docx'
        }
      }
    ]
  },
  url: {
    type: 'url',
    url: 'https://example.com/test-url'
  },
  formula: {
    type: 'formula',
    formula: {
      type: 'string',
      string: 'Calculated result: 100%'
    }
  },
  rollup: {
    type: 'rollup',
    rollup: {
      type: 'array',
      array: [
        { type: 'number', number: 10 },
        { type: 'number', number: 20 },
        { type: 'number', number: 30 }
      ],
      function: 'sum'
    }
  },
  unique_id: {
    type: 'unique_id',
    unique_id: {
      number: 1001,
      prefix: 'TASK'
    }
  },
  status: {
    type: 'status',
    status: {
      id: 'status-1',
      name: 'In Progress',
      color: 'yellow'
    }
  },

  // MEDIUM PRIORITY PROPERTY TYPES
  email: {
    type: 'email',
    email: 'test@example.com'
  },
  phone_number: {
    type: 'phone_number',
    phone_number: '+1-555-123-4567'
  },
  created_by: {
    type: 'created_by',
    created_by: {
      id: 'user-1',
      name: 'Creator User'
    }
  },
  last_edited_by: {
    type: 'last_edited_by',
    last_edited_by: {
      id: 'user-2',
      name: 'Editor User'
    }
  },

  // LOW PRIORITY PROPERTY TYPES
  verification: {
    type: 'verification',
    verification: {
      state: 'verified',
      verified_by: {
        id: 'user-1'
      }
    }
  }
};

// Test data for all 15+ block types
const allBlockTypes = {
  paragraph: {
    id: 'block-paragraph',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'This is a paragraph with ' },
          plain_text: 'This is a paragraph with ',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        },
        {
          type: 'text',
          text: { content: 'bold text' },
          plain_text: 'bold text',
          annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  heading_1: {
    id: 'block-h1',
    type: 'heading_1',
    heading_1: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Main Heading' },
          plain_text: 'Main Heading',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  heading_2: {
    id: 'block-h2',
    type: 'heading_2',
    heading_2: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Section Heading' },
          plain_text: 'Section Heading',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  heading_3: {
    id: 'block-h3',
    type: 'heading_3',
    heading_3: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Subsection Heading' },
          plain_text: 'Subsection Heading',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  bulleted_list_item: {
    id: 'block-bullet',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Bullet point item' },
          plain_text: 'Bullet point item',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  numbered_list_item: {
    id: 'block-numbered',
    type: 'numbered_list_item',
    numbered_list_item: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Numbered list item' },
          plain_text: 'Numbered list item',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  to_do: {
    id: 'block-todo',
    type: 'to_do',
    to_do: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Todo item' },
          plain_text: 'Todo item',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ],
      checked: true
    },
    has_children: false
  },

  toggle: {
    id: 'block-toggle',
    type: 'toggle',
    toggle: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Toggle summary' },
          plain_text: 'Toggle summary',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: true
  },

  quote: {
    id: 'block-quote',
    type: 'quote',
    quote: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'This is a quote' },
          plain_text: 'This is a quote',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  callout: {
    id: 'block-callout',
    type: 'callout',
    callout: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Important callout message' },
          plain_text: 'Important callout message',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ],
      icon: {
        type: 'emoji',
        emoji: '💡'
      }
    },
    has_children: false
  },

  divider: {
    id: 'block-divider',
    type: 'divider',
    divider: {},
    has_children: false
  },

  code: {
    id: 'block-code',
    type: 'code',
    code: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'console.log("Hello, world!");' },
          plain_text: 'console.log("Hello, world!");',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ],
      language: 'javascript'
    },
    has_children: false
  },

  equation: {
    id: 'block-equation',
    type: 'equation',
    equation: {
      expression: 'E = mc^2'
    },
    has_children: false
  },

  image: {
    id: 'block-image',
    type: 'image',
    image: {
      type: 'file',
      file: {
        url: 'https://notion.so/image.png',
        expiry_time: '2023-12-31T23:59:59.000Z'
      },
      caption: [
        {
          type: 'text',
          text: { content: 'Image caption' },
          plain_text: 'Image caption',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  video: {
    id: 'block-video',
    type: 'video',
    video: {
      type: 'external',
      external: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ'
      },
      caption: [
        {
          type: 'text',
          text: { content: 'Video caption' },
          plain_text: 'Video caption',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  file: {
    id: 'block-file',
    type: 'file',
    file: {
      type: 'file',
      file: {
        url: 'https://notion.so/document.pdf',
        expiry_time: '2023-12-31T23:59:59.000Z'
      },
      name: 'Important Document.pdf',
      caption: [
        {
          type: 'text',
          text: { content: 'File description' },
          plain_text: 'File description',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  bookmark: {
    id: 'block-bookmark',
    type: 'bookmark',
    bookmark: {
      url: 'https://example.com',
      caption: [
        {
          type: 'text',
          text: { content: 'Bookmark description' },
          plain_text: 'Bookmark description',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  embed: {
    id: 'block-embed',
    type: 'embed',
    embed: {
      url: 'https://youtube.com/embed/dQw4w9WgXcQ',
      caption: [
        {
          type: 'text',
          text: { content: 'Embedded content' },
          plain_text: 'Embedded content',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  },

  table: {
    id: 'block-table',
    type: 'table',
    table: {
      table_width: 3,
      has_column_header: true,
      has_row_header: false
    },
    has_children: true
  },

  table_row: {
    id: 'block-table-row',
    type: 'table_row',
    table_row: {
      cells: [
        [
          {
            type: 'text',
            text: { content: 'Header 1' },
            plain_text: 'Header 1',
            annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
          }
        ],
        [
          {
            type: 'text',
            text: { content: 'Header 2' },
            plain_text: 'Header 2',
            annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
          }
        ],
        [
          {
            type: 'text',
            text: { content: 'Header 3' },
            plain_text: 'Header 3',
            annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
          }
        ]
      ]
    },
    has_children: false
  },

  child_page: {
    id: 'block-child-page',
    type: 'child_page',
    child_page: {
      title: 'Child Page Title'
    },
    has_children: false
  },

  child_database: {
    id: 'block-child-database',
    type: 'child_database',
    child_database: {
      title: 'Child Database Title'
    },
    has_children: false
  },

  column_list: {
    id: 'block-column-list',
    type: 'column_list',
    column_list: {},
    has_children: true
  },

  column: {
    id: 'block-column',
    type: 'column',
    column: {},
    has_children: true
  },

  synced_block: {
    id: 'block-synced',
    type: 'synced_block',
    synced_block: {
      synced_from: null // Original synced block
    },
    has_children: true
  },

  table_of_contents: {
    id: 'block-toc',
    type: 'table_of_contents',
    table_of_contents: {
      color: 'default'
    },
    has_children: false
  },

  breadcrumb: {
    id: 'block-breadcrumb',
    type: 'breadcrumb',
    breadcrumb: {},
    has_children: false
  },

  template: {
    id: 'block-template',
    type: 'template',
    template: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Template content' },
          plain_text: 'Template content',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ]
    },
    has_children: false
  }
};

const mockSettings: NotionImporterSettings = {
  notionApiKey: 'test-key',
  defaultOutputFolder: 'Test Import',
  importImages: true,
  preserveNotionBlocks: false,
  convertToMarkdown: true,
  includeMetadata: true
};

const mockDatabase: NotionDatabase = {
  id: 'test-database-id',
  title: 'Test Database',
  description: 'A comprehensive test database',
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
    Priority: {
      type: 'number',
      number: { format: 'number' }
    },
    'Due Date': {
      type: 'date',
      date: {}
    }
  },
  url: 'https://notion.so/test-database',
  lastEditedTime: '2023-01-02T00:00:00.000Z',
  createdTime: '2023-01-01T00:00:00.000Z'
};

const mockPage: NotionPage = {
  id: 'test-page-id',
  title: 'Test Page',
  url: 'https://notion.so/test-page',
  lastEditedTime: '2023-01-02T00:00:00.000Z',
  createdTime: '2023-01-01T00:00:00.000Z',
  properties: allPropertyTypes,
  parent: { type: 'workspace' },
  icon: {
    type: 'emoji',
    emoji: '📝'
  },
  cover: {
    type: 'external',
    external: {
      url: 'https://example.com/cover.jpg'
    }
  }
};

describe('NotionConverter', () => {
  let testEnv: TestEnvironment;
  let converter: NotionConverter;
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

    // Create converter instance
    converter = new NotionConverter(mockSettings);

    // Create mock conversion context
    mockContext = {
      basePath: '/test/path',
      settings: mockSettings,
      client: { client: testEnv.app } as any,
      processedBlocks: new Set()
    };

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await teardownTest();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with settings', () => {
      expect(converter).toBeInstanceOf(NotionConverter);
    });

    it('should have access to color mapping constants', () => {
      expect(COLOR_MAPPING).toBeDefined();
      expect(COLOR_MAPPING['red']).toBe('#E03E3E');
      expect(COLOR_MAPPING['blue']).toBe('#0B6E99');
    });

    it('should have property type mappings', () => {
      expect(PROPERTY_TYPE_MAPPING).toBeDefined();
      expect(PROPERTY_TYPE_MAPPING['title']).toEqual({
        type: 'text',
        displayName: 'Title'
      });
    });

    it('should have block hierarchy defined', () => {
      expect(BLOCK_HIERARCHY).toBeDefined();
      expect(BLOCK_HIERARCHY['heading_1']).toBeDefined();
      expect(BLOCK_HIERARCHY['paragraph']).toBeDefined();
    });
  });

  describe('Page Conversion', () => {
    it('should convert complete page with all components', async () => {
      const blocks = [
        allBlockTypes.paragraph,
        allBlockTypes.heading_1,
        allBlockTypes.bulleted_list_item
      ];

      const result = await converter.convertPage(mockPage, blocks, mockContext);

      expect(result).toHaveProperty('markdown');
      expect(result).toHaveProperty('frontmatter');
      expect(result).toHaveProperty('attachments');
      expect(result).toHaveProperty('images');

      // Should contain converted blocks
      expect(result.markdown).toContain('This is a paragraph with **bold text**');
      expect(result.markdown).toContain('# Main Heading');
      expect(result.markdown).toContain('- Bullet point item');

      // Should have frontmatter with all critical properties
      expect(result.frontmatter).toHaveProperty('title', 'Test Page');
      expect(result.frontmatter).toHaveProperty('notion-id', 'test-page-id');
    });

    it('should handle empty pages gracefully', async () => {
      const emptyPage = { ...mockPage, properties: {} };
      const result = await converter.convertPage(emptyPage, [], mockContext);

      expect(result.markdown).toBeDefined();
      expect(result.frontmatter).toHaveProperty('title', 'Test Page');
    });

    it('should process page icons and covers', async () => {
      const result = await converter.convertPage(mockPage, [], mockContext);

      // Should start with emoji icon
      expect(result.markdown).toMatch(/^📝/);
    });
  });

  describe('Rich Text Conversion', () => {
    it('should convert plain text', () => {
      const richText = [
        {
          type: 'text' as const,
          text: { content: 'Plain text' },
          plain_text: 'Plain text',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ];

      const result = converter.convertRichText(richText);
      expect(result).toBe('Plain text');
    });

    it('should apply all text formatting annotations', () => {
      const richText = [
        {
          type: 'text' as const,
          text: { content: 'bold' },
          plain_text: 'bold',
          annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        },
        {
          type: 'text' as const,
          text: { content: ' italic' },
          plain_text: ' italic',
          annotations: { bold: false, italic: true, strikethrough: false, underline: false, code: false, color: 'default' }
        },
        {
          type: 'text' as const,
          text: { content: ' strikethrough' },
          plain_text: ' strikethrough',
          annotations: { bold: false, italic: false, strikethrough: true, underline: false, code: false, color: 'default' }
        },
        {
          type: 'text' as const,
          text: { content: ' underline' },
          plain_text: ' underline',
          annotations: { bold: false, italic: false, strikethrough: false, underline: true, code: false, color: 'default' }
        },
        {
          type: 'text' as const,
          text: { content: ' code' },
          plain_text: ' code',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: true, color: 'default' }
        }
      ];

      const result = converter.convertRichText(richText);
      expect(result).toBe('**bold** *italic* ~~strikethrough~~ <u>underline</u> `code`');
    });

    it('should handle colors correctly', () => {
      const richText = [
        {
          type: 'text' as const,
          text: { content: 'Red text' },
          plain_text: 'Red text',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'red' }
        }
      ];

      const result = converter.convertRichText(richText);
      expect(result).toContain('<span style="color:#E03E3E">Red text</span>');
    });

    it('should handle links', () => {
      const richText = [
        {
          type: 'text' as const,
          text: { content: 'Click here', link: { url: 'https://example.com' } },
          plain_text: 'Click here',
          href: 'https://example.com',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ];

      const result = converter.convertRichText(richText);
      expect(result).toBe('[Click here](https://example.com)');
    });

    it('should handle equations', () => {
      const richText = [
        {
          type: 'equation' as const,
          equation: { expression: 'x^2 + y^2 = z^2' },
          plain_text: 'x^2 + y^2 = z^2',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ];

      const result = converter.convertRichText(richText);
      expect(result).toBe('$x^2 + y^2 = z^2$');
    });

    it('should handle mentions', () => {
      const richText = [
        {
          type: 'mention' as const,
          mention: {
            type: 'user',
            user: { id: 'user-1', name: 'John Doe' }
          },
          plain_text: '@John Doe',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ];

      const result = converter.convertRichText(richText);
      expect(result).toBe('@John Doe');
    });

    it('should handle empty or invalid rich text', () => {
      expect(converter.convertRichText([])).toBe('');
      expect(converter.convertRichText(null as any)).toBe('');
      expect(converter.convertRichText(undefined as any)).toBe('');
    });
  });

  describe('Block Type Conversions', () => {
    // Test all 15+ block types
    it('should convert paragraph blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.paragraph, mockContext);
      expect(result.content).toBe('This is a paragraph with **bold text**');
    });

    it('should convert heading blocks (h1, h2, h3)', async () => {
      const h1Result = await converter.convertBlock(allBlockTypes.heading_1, mockContext);
      expect(h1Result.content).toBe('# Main Heading');

      const h2Result = await converter.convertBlock(allBlockTypes.heading_2, mockContext);
      expect(h2Result.content).toBe('## Section Heading');

      const h3Result = await converter.convertBlock(allBlockTypes.heading_3, mockContext);
      expect(h3Result.content).toBe('### Subsection Heading');
    });

    it('should convert list items', async () => {
      const bulletResult = await converter.convertBlock(allBlockTypes.bulleted_list_item, mockContext);
      expect(bulletResult.content).toBe('- Bullet point item');

      const numberedResult = await converter.convertBlock(allBlockTypes.numbered_list_item, mockContext);
      expect(numberedResult.content).toBe('1. Numbered list item');
    });

    it('should convert todo items', async () => {
      const result = await converter.convertBlock(allBlockTypes.to_do, mockContext);
      expect(result.content).toBe('- [x] Todo item');
    });

    it('should convert toggle blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.toggle, mockContext);
      expect(result.content).toContain('<details><summary>Toggle summary</summary>');
    });

    it('should convert quote blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.quote, mockContext);
      expect(result.content).toBe('> This is a quote');
    });

    it('should convert callout blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.callout, mockContext);
      expect(result.content).toContain('> [!tip] 💡');
      expect(result.content).toContain('Important callout message');
    });

    it('should convert divider blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.divider, mockContext);
      expect(result.content).toBe('---');
    });

    it('should convert code blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.code, mockContext);
      expect(result.content).toContain('```javascript');
      expect(result.content).toContain('console.log("Hello, world!");');
      expect(result.content).toContain('```');
    });

    it('should convert equation blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.equation, mockContext);
      expect(result.content).toBe('$$E = mc^2$$');
    });

    it('should convert image blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.image, mockContext);
      expect(result.content).toContain('![Image caption]');
    });

    it('should convert video blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.video, mockContext);
      expect(result.content).toContain('[Video caption](https://youtube.com/watch?v=dQw4w9WgXcQ)');
    });

    it('should convert file blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.file, mockContext);
      expect(result.content).toContain('File description');
    });

    it('should convert bookmark blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.bookmark, mockContext);
      expect(result.content).toBe('[Bookmark description](https://example.com)');
    });

    it('should convert embed blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.embed, mockContext);
      expect(result.content).toContain('<iframe');
      expect(result.content).toContain('youtube.com/embed');
    });

    it('should convert table row blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.table_row, mockContext);
      expect(result.content).toBe('| **Header 1** | **Header 2** | **Header 3** |');
    });

    it('should convert child page blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.child_page, mockContext);
      expect(result.content).toBe('[[Child Page Title]]');
    });

    it('should convert child database blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.child_database, mockContext);
      expect(result.content).toBe('![[Child Database Title.base]]');
    });

    it('should convert column list and column blocks', async () => {
      const columnListResult = await converter.convertBlock(allBlockTypes.column_list, mockContext);
      expect(columnListResult.content).toContain('<div class="column-list">');

      const columnResult = await converter.convertBlock(allBlockTypes.column, mockContext);
      expect(columnResult.content).toContain('<div class="column">');
    });

    it('should convert synced blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.synced_block, mockContext);
      expect(result.content).toContain('<!-- Synced block');
    });

    it('should convert table of contents blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.table_of_contents, mockContext);
      expect(result.content).toContain('<!-- Table of Contents');
    });

    it('should convert breadcrumb blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.breadcrumb, mockContext);
      expect(result.content).toContain('<!-- Breadcrumb navigation');
    });

    it('should convert template blocks', async () => {
      const result = await converter.convertBlock(allBlockTypes.template, mockContext);
      expect(result.content).toContain('<!-- Template: Template content');
    });

    it('should handle unknown block types', async () => {
      const unknownBlock = {
        id: 'unknown-block',
        type: 'unknown_type',
        unknown_type: {
          rich_text: [
            {
              type: 'text' as const,
              text: { content: 'Unknown content' },
              plain_text: 'Unknown content',
              annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
            }
          ]
        },
        has_children: false
      };

      const result = await converter.convertBlock(unknownBlock as any, mockContext);
      expect(result.content).toBe('Unknown content');
    });
  });

  describe('Property Value Extraction', () => {
    // Test all 21 property types
    it('should extract title property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.title);
      expect(result).toBe('Test Title');
    });

    it('should extract rich text property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.rich_text);
      expect(result).toBe('Rich text content with formatting');
    });

    it('should extract number property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.number);
      expect(result).toBe(42.5);
    });

    it('should extract select property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.select);
      expect(result).toBe('Done');
    });

    it('should extract multi-select property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.multi_select);
      expect(result).toEqual(['Important', 'Review']);
    });

    it('should extract date property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.date);
      expect(result).toBe('2023-01-01 to 2023-01-03');
    });

    it('should extract checkbox property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.checkbox);
      expect(result).toBe(true);
    });

    it('should extract relation property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.relation);
      expect(result).toEqual(['related-page-1', 'related-page-2']);
    });

    it('should extract people property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.people);
      expect(result).toEqual(['John Doe', 'Jane Smith']);
    });

    it('should extract files property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.files);
      expect(result).toEqual(['document.pdf', 'External File']);
    });

    it('should extract URL property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.url);
      expect(result).toBe('https://example.com/test-url');
    });

    it('should extract email property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.email);
      expect(result).toBe('test@example.com');
    });

    it('should extract phone number property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.phone_number);
      expect(result).toBe('+1-555-123-4567');
    });

    it('should extract formula property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.formula);
      expect(result).toBe('Calculated result: 100%');
    });

    it('should extract rollup property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.rollup);
      expect(result).toEqual([
        { type: 'number', number: 10 },
        { type: 'number', number: 20 },
        { type: 'number', number: 30 }
      ]);
    });

    it('should extract unique ID property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.unique_id);
      expect(result).toBe('TASK-1001');
    });

    it('should extract status property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.status);
      expect(result).toBe('In Progress');
    });

    it('should extract created/edited time property values', () => {
      const createdResult = converter.extractPropertyValue(allPropertyTypes.created_time);
      expect(createdResult).toBe('2023-01-01T10:00:00.000Z');

      const editedResult = converter.extractPropertyValue(allPropertyTypes.last_edited_time);
      expect(editedResult).toBe('2023-01-02T15:30:00.000Z');
    });

    it('should extract created/edited by property values', () => {
      const createdResult = converter.extractPropertyValue(allPropertyTypes.created_by);
      expect(createdResult).toBe('Creator User');

      const editedResult = converter.extractPropertyValue(allPropertyTypes.last_edited_by);
      expect(editedResult).toBe('Editor User');
    });

    it('should extract verification property values', () => {
      const result = converter.extractPropertyValue(allPropertyTypes.verification);
      expect(result).toBe('verified');
    });

    it('should handle null and undefined properties', () => {
      expect(converter.extractPropertyValue(null as any)).toBeNull();
      expect(converter.extractPropertyValue(undefined as any)).toBeNull();
      expect(converter.extractPropertyValue({} as any)).toBeNull();
    });
  });

  describe('Database to Base Conversion', () => {
    it('should convert database to complete Base configuration', () => {
      const entries = [mockPage];
      const result = converter.convertDatabaseToBase(mockDatabase, entries, mockContext);

      expect(result).toContain('# Test Database Database');
      expect(result).toContain('filters:');
      expect(result).toContain('properties:');
      expect(result).toContain('views:');
    });

    it('should handle databases with no entries', () => {
      const result = converter.convertDatabaseToBase(mockDatabase, [], mockContext);
      expect(result).toContain('Test Database');
    });

    it('should generate valid YAML structure', () => {
      const entries = [mockPage];
      const result = converter.convertDatabaseToBase(mockDatabase, entries, mockContext);

      // Should contain proper YAML sections
      expect(result).toMatch(/filters:\s*and:/);
      expect(result).toMatch(/properties:\s*file\.name:/);
      expect(result).toMatch(/views:\s*-\s*type:\s*table/);
    });
  });

  describe('Utility Functions', () => {
    it('should sanitize file names correctly', () => {
      const testCases = [
        { input: 'Normal File Name', expected: 'Normal File Name' },
        { input: 'Invalid<>:"/\\|?*Characters', expected: 'Invalid---------Characters' },
        { input: '   Whitespace   ', expected: 'Whitespace' },
        { input: 'Very long file name that exceeds the normal filesystem limits and should be truncated to ensure compatibility with various operating systems and file systems that have different maximum filename length restrictions', expected: 'Very long file name that exceeds the normal filesystem limits and should be truncated to en' },
        { input: '...Leading dots', expected: 'Leading dots' },
        { input: 'Trailing dots...', expected: 'Trailing dots' },
        { input: '', expected: '' }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = converter.sanitizeFileName(input);
        expect(result).toBe(expected);
        expect(result.length).toBeLessThanOrEqual(255);
      });
    });

    it('should convert Notion colors correctly', () => {
      expect(converter.convertColor('red')).toBe('#E03E3E');
      expect(converter.convertColor('blue')).toBe('#0B6E99');
      expect(converter.convertColor('green')).toBe('#0F7B6C');
      expect(converter.convertColor('unknown-color')).toBe('');
      expect(converter.convertColor('')).toBe('');
    });

    it('should extract plain text from rich text arrays', () => {
      const richText = [
        {
          type: 'text' as const,
          text: { content: 'First part' },
          plain_text: 'First part',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        },
        {
          type: 'text' as const,
          text: { content: ' second part' },
          plain_text: ' second part',
          annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ];

      const result = converter.extractPlainText(richText);
      expect(result).toBe('First part second part');
    });

    it('should generate frontmatter correctly', () => {
      const data = {
        title: 'Test Page',
        id: 'test-id',
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        number: 42,
        boolean: true
      };

      const result = converter.generateFrontmatter(data);

      expect(result).toHaveProperty('title', 'Test Page');
      expect(result).toHaveProperty('id', 'test-id');
      expect(result).toHaveProperty('emptyString', '');
      expect(result).toHaveProperty('number', 42);
      expect(result).toHaveProperty('boolean', true);
      expect(result).not.toHaveProperty('nullValue');
      expect(result).not.toHaveProperty('undefinedValue');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle blocks with no content', async () => {
      const emptyBlock = {
        id: 'empty-block',
        type: 'paragraph',
        paragraph: {
          rich_text: []
        },
        has_children: false
      };

      const result = await converter.convertBlock(emptyBlock as any, mockContext);
      expect(result.content).toBe('');
    });

    it('should handle malformed rich text', () => {
      const malformedRichText = [
        {
          type: 'text' as const,
          // Missing text property
          plain_text: 'Fallback text',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ];

      const result = converter.convertRichText(malformedRichText as any);
      expect(result).toBe('Fallback text');
    });

    it('should handle blocks with circular references', async () => {
      const block = {
        id: 'test-block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text' as const,
              text: { content: 'Test content' },
              plain_text: 'Test content',
              annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
            }
          ]
        },
        has_children: false
      };

      // Add block to processed set to simulate circular reference
      mockContext.processedBlocks.add('test-block');

      const result = await converter.convertBlock(block as any, mockContext);
      expect(result.content).toBe(''); // Should return empty for already processed blocks
    });

    it('should handle unicode and special characters', () => {
      const unicodeRichText = [
        {
          type: 'text' as const,
          text: { content: '🌟 Unicode: café, naïve, résumé 中文 العربية' },
          plain_text: '🌟 Unicode: café, naïve, résumé 中文 العربية',
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }
      ];

      const result = converter.convertRichText(unicodeRichText);
      expect(result).toBe('🌟 Unicode: café, naïve, résumé 中文 العربية');
    });

    it('should handle very large content gracefully', async () => {
      const largeContent = 'x'.repeat(10000);
      const largeBlock = {
        id: 'large-block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text' as const,
              text: { content: largeContent },
              plain_text: largeContent,
              annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
            }
          ]
        },
        has_children: false
      };

      const start = Date.now();
      const result = await converter.convertBlock(largeBlock as any, mockContext);
      const elapsed = Date.now() - start;

      expect(result.content).toBe(largeContent);
      expect(elapsed).toBeLessThan(1000); // Should process quickly
    });

    it('should handle nested block conversion errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock a block that will cause an error
      const problematicBlock = {
        id: 'problem-block',
        type: 'paragraph',
        paragraph: null, // This will cause an error
        has_children: false
      };

      const result = await converter.convertBlock(problematicBlock as any, mockContext);

      expect(result.content).toContain('<!-- Error converting block:');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Performance Tests', () => {
    it('should handle large numbers of blocks efficiently', async () => {
      const manyBlocks = Array(100).fill(null).map((_, i) => ({
        id: `block-${i}`,
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text' as const,
              text: { content: `Paragraph ${i}` },
              plain_text: `Paragraph ${i}`,
              annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
            }
          ]
        },
        has_children: false
      }));

      const start = Date.now();
      const result = await converter.convertPage(mockPage, manyBlocks as any, mockContext);
      const elapsed = Date.now() - start;

      expect(result.markdown).toContain('Paragraph 0');
      expect(result.markdown).toContain('Paragraph 99');
      expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle complex nested structures efficiently', async () => {
      const nestedBlocks = Array(50).fill(null).map((_, i) => ({
        id: `nested-block-${i}`,
        type: 'toggle',
        toggle: {
          rich_text: [
            {
              type: 'text' as const,
              text: { content: `Toggle ${i}` },
              plain_text: `Toggle ${i}`,
              annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
            }
          ]
        },
        has_children: true
      }));

      const start = Date.now();
      const results = await Promise.all(
        nestedBlocks.map(block => converter.convertBlock(block as any, mockContext))
      );
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(50);
      expect(elapsed).toBeLessThan(3000); // Should complete within 3 seconds
    });
  });
});

// Export test utilities for integration tests
export {
  allPropertyTypes,
  allBlockTypes,
  mockSettings,
  mockDatabase,
  mockPage
};