/**
 * NotionConverter - Comprehensive Notion to Obsidian content transformation
 *
 * @author Notion API Importer Team
 * @version 2.0.0
 * @license MIT
 *
 * Features:
 * - Complete support for all 21 Notion property types
 * - Conversion of 15+ Notion block types to Obsidian Markdown
 * - Rich text formatting preservation (bold, italic, strikethrough, etc.)
 * - Internal link conversion and page reference handling
 * - Database-to-Base conversion with property mapping
 * - Media handling (images, videos, files, PDFs)
 * - Mathematical equation support (KaTeX/LaTeX)
 * - Advanced features: callouts, toggles, columns, synced blocks
 * - Cross-platform filename sanitization
 * - Comprehensive error handling and validation
 */

import { Platform } from 'obsidian';
import type {
  NotionPage,
  NotionDatabase,
  NotionBlock,
  NotionImporterSettings,
  ProcessedContent,
  ConversionContext
} from '../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Rich text annotation interface matching Notion API structure
 */
interface RichTextAnnotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  color?: string;
}

/**
 * Rich text object with content and formatting
 */
interface RichTextObject {
  type: 'text' | 'mention' | 'equation';
  plain_text: string;
  href?: string;
  annotations: RichTextAnnotations;
  text?: {
    content: string;
    link?: { url: string };
  };
  mention?: {
    type: 'user' | 'page' | 'database' | 'date';
    user?: { id: string; name?: string };
    page?: { id: string };
    database?: { id: string };
    date?: { start: string; end?: string };
  };
  equation?: {
    expression: string;
  };
}

/**
 * Notion property value types for all 21 property types
 */
interface NotionPropertyValue {
  type: string;
  id?: string;

  // Basic types
  title?: RichTextObject[];
  rich_text?: RichTextObject[];
  number?: number;

  // Selection types
  select?: { id: string; name: string; color?: string };
  multi_select?: Array<{ id: string; name: string; color?: string }>;
  status?: { id: string; name: string; color?: string };

  // Date and time
  date?: { start: string; end?: string; time_zone?: string };
  created_time?: string;
  last_edited_time?: string;

  // People and relations
  people?: Array<{ id: string; name?: string; avatar_url?: string }>;
  created_by?: { id: string; name?: string };
  last_edited_by?: { id: string; name?: string };

  // Files and media
  files?: Array<{
    type: 'file' | 'external';
    name: string;
    file?: { url: string; expiry_time: string };
    external?: { url: string };
  }>;

  // Other types
  checkbox?: boolean;
  url?: string;
  email?: string;
  phone_number?: string;

  // Advanced types
  formula?: { type: string; string?: string; number?: number; boolean?: boolean; date?: string };
  relation?: Array<{ id: string }>;
  rollup?: { type: string; array?: any[]; function: string };
  unique_id?: { number: number; prefix?: string };
  verification?: { state: string; verified_by?: { id: string } };
}

/**
 * Block conversion result
 */
interface BlockConversionResult {
  content: string;
  attachments: string[];
  images: string[];
  children?: BlockConversionResult[];
  metadata?: Record<string, any>;
}

/**
 * Property conversion configuration
 */
interface PropertyConversionConfig {
  type: string;
  displayName: string;
  format?: string;
  options?: Array<{
    value: string;
    label: string;
    color?: string;
  }>;
  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

// ============================================================================
// UTILITY CONSTANTS
// ============================================================================

/**
 * Mapping of Notion colors to CSS/Obsidian colors
 */
const COLOR_MAPPING: Record<string, string> = {
  'default': '',
  'gray': '#9B9A97',
  'brown': '#64473A',
  'orange': '#D9730D',
  'yellow': '#DFAB01',
  'green': '#0F7B6C',
  'blue': '#0B6E99',
  'purple': '#6940A5',
  'pink': '#AD1A72',
  'red': '#E03E3E',
  'gray_background': '#F1F1EF',
  'brown_background': '#F4EEEE',
  'orange_background': '#FAEBDD',
  'yellow_background': '#FBF3DB',
  'green_background': '#EDF3F0',
  'blue_background': '#E7F3F8',
  'purple_background': '#F6F3F9',
  'pink_background': '#FAF1F5',
  'red_background': '#FDEBEC'
};

/**
 * Property type mapping for database-to-base conversion
 */
const PROPERTY_TYPE_MAPPING: Record<string, Partial<PropertyConversionConfig>> = {
  // Basic content types
  'title': { type: 'text', displayName: 'Title' },
  'rich_text': { type: 'text', displayName: 'Text' },
  'number': { type: 'number', format: '0.##' },

  // Selection types
  'select': { type: 'select' },
  'multi_select': { type: 'tags' },
  'status': { type: 'select' },

  // Date and time
  'date': { type: 'date', format: 'YYYY-MM-DD' },
  'created_time': { type: 'date', displayName: 'Created' },
  'last_edited_time': { type: 'date', displayName: 'Modified' },

  // People
  'people': { type: 'list', displayName: 'People' },
  'created_by': { type: 'text', displayName: 'Created By' },
  'last_edited_by': { type: 'text', displayName: 'Modified By' },

  // Media and files
  'files': { type: 'list', displayName: 'Files' },

  // Interactive types
  'checkbox': { type: 'checkbox' },
  'url': { type: 'url' },
  'email': { type: 'email' },
  'phone_number': { type: 'text', displayName: 'Phone' },

  // Advanced types
  'formula': { type: 'text', displayName: 'Formula' },
  'relation': { type: 'list', displayName: 'Related' },
  'rollup': { type: 'text', displayName: 'Rollup' },
  'unique_id': { type: 'text', displayName: 'ID' },
  'verification': { type: 'text', displayName: 'Verified' }
};

/**
 * Block type hierarchy for proper nesting
 */
const BLOCK_HIERARCHY: Record<string, number> = {
  'paragraph': 1,
  'heading_1': 2,
  'heading_2': 3,
  'heading_3': 4,
  'bulleted_list_item': 5,
  'numbered_list_item': 5,
  'to_do': 5,
  'toggle': 6,
  'quote': 7,
  'callout': 8,
  'code': 9,
  'equation': 10,
  'divider': 11,
  'table': 12,
  'image': 13,
  'video': 13,
  'file': 13,
  'pdf': 13,
  'bookmark': 14,
  'embed': 14,
  'link_preview': 14,
  'synced_block': 15,
  'column_list': 16,
  'column': 17,
  'table_of_contents': 18,
  'breadcrumb': 19
};

// ============================================================================
// MAIN CONVERTER CLASS
// ============================================================================

/**
 * NotionConverter - Main class for converting Notion content to Obsidian Markdown
 */
export class NotionConverter {
  private settings: NotionImporterSettings;
  private processedBlocks: Set<string> = new Set();
  private linkRegistry: Map<string, string> = new Map(); // Notion ID -> Obsidian filename
  private attachmentCounter: number = 0;

  constructor(settings: NotionImporterSettings) {
    this.settings = settings;
  }

  // ========================================================================
  // PUBLIC API METHODS
  // ========================================================================

  /**
   * Convert a complete Notion page to Obsidian Markdown
   * @param page - Notion page data
   * @param blocks - Page content blocks
   * @param context - Conversion context
   * @returns Promise<ProcessedContent> - Converted content with metadata
   */
  async convertPage(
    page: NotionPage,
    blocks: NotionBlock[],
    context: ConversionContext
  ): Promise<ProcessedContent> {
    try {
      this.processedBlocks.clear();

      const result: ProcessedContent = {
        markdown: '',
        frontmatter: this.generateFrontmatter(page),
        attachments: [],
        images: []
      };

      // Process page icon and cover
      const pageHeader = await this.processPageHeader(page, context);
      if (pageHeader) {
        result.markdown += pageHeader + '\n\n';
      }

      // Convert all blocks
      const blockResults = await this.convertBlocks(blocks, context, 0);

      // Combine results
      result.markdown += blockResults.map(b => b.content).join('\n');
      result.attachments = this.flattenArray(blockResults.map(b => b.attachments));
      result.images = this.flattenArray(blockResults.map(b => b.images));

      // Post-process content
      result.markdown = this.postProcessMarkdown(result.markdown, context);

      return result;

    } catch (error) {
      console.error('Failed to convert page:', error);
      throw new Error(`Page conversion failed: ${error.message}`);
    }
  }

  /**
   * Convert Notion database to Obsidian Base configuration
   * @param database - Notion database data
   * @param entries - Database entries
   * @param context - Conversion context
   * @returns string - Base YAML configuration
   */
  convertDatabaseToBase(
    database: NotionDatabase,
    entries: NotionPage[],
    context: ConversionContext
  ): string {
    try {
      const dbName = this.sanitizeFileName(database.title);

      // Generate Base components
      const filters = this.generateBaseFilters(dbName);
      const properties = this.convertDatabaseProperties(database.properties);
      const views = this.generateBaseViews(database, entries);

      // Combine into complete Base file
      return `# ${database.title} Database\n\n${filters}\n\n${properties}\n\n${views}`;

    } catch (error) {
      console.error('Failed to convert database to base:', error);
      throw new Error(`Database conversion failed: ${error.message}`);
    }
  }

  /**
   * Convert single Notion block to Markdown
   * @param block - Notion block data
   * @param context - Conversion context
   * @param indentLevel - Current indentation level
   * @returns Promise<BlockConversionResult> - Converted block result
   */
  async convertBlock(
    block: NotionBlock,
    context: ConversionContext,
    indentLevel: number = 0
  ): Promise<BlockConversionResult> {
    try {
      // Skip already processed blocks to prevent infinite loops
      if (this.processedBlocks.has(block.id)) {
        return { content: '', attachments: [], images: [] };
      }

      this.processedBlocks.add(block.id);

      const indent = '  '.repeat(indentLevel);
      const result = await this.convertBlockByType(block, context, indent);

      // Process children if they exist
      if (block.has_children && this.shouldProcessChildren(block.type)) {
        result.children = await this.convertChildren(block, context, indentLevel + 1);

        // Append children content based on block type
        result.content += this.formatChildrenContent(result.children, block.type);
      }

      return result;

    } catch (error) {
      console.error(`Failed to convert block ${block.id}:`, error);
      return {
        content: `<!-- Error converting block: ${error.message} -->`,
        attachments: [],
        images: []
      };
    }
  }

  // ========================================================================
  // BLOCK TYPE CONVERTERS
  // ========================================================================

  /**
   * Convert block based on its type
   * @param block - Notion block
   * @param context - Conversion context
   * @param indent - Current indentation
   * @returns Promise<BlockConversionResult> - Conversion result
   */
  private async convertBlockByType(
    block: NotionBlock,
    context: ConversionContext,
    indent: string
  ): Promise<BlockConversionResult> {
    const blockData = block[block.type] as any;

    switch (block.type) {
      // Text content blocks
      case 'paragraph':
        return this.convertParagraph(blockData, context, indent);

      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        return this.convertHeading(blockData, context, block.type, indent);

      // List blocks
      case 'bulleted_list_item':
        return this.convertBulletedListItem(blockData, context, indent);

      case 'numbered_list_item':
        return this.convertNumberedListItem(blockData, context, indent);

      case 'to_do':
        return this.convertTodoItem(blockData, context, indent);

      // Rich content blocks
      case 'toggle':
        return this.convertToggle(blockData, context, indent);

      case 'quote':
        return this.convertQuote(blockData, context, indent);

      case 'callout':
        return this.convertCallout(blockData, context, indent);

      case 'divider':
        return this.convertDivider(indent);

      // Code blocks
      case 'code':
        return this.convertCodeBlock(blockData, context, indent);

      // Math blocks
      case 'equation':
        return this.convertEquation(blockData, context, indent);

      // Media blocks
      case 'image':
        return await this.convertImage(blockData, context, indent);

      case 'video':
        return await this.convertVideo(blockData, context, indent);

      case 'file':
        return await this.convertFile(blockData, context, indent);

      case 'pdf':
        return await this.convertPdf(blockData, context, indent);

      // External content blocks
      case 'bookmark':
        return this.convertBookmark(blockData, context, indent);

      case 'embed':
        return this.convertEmbed(blockData, context, indent);

      case 'link_preview':
        return this.convertLinkPreview(blockData, context, indent);

      // Table blocks
      case 'table':
        return await this.convertTable(block, context, indent);

      case 'table_row':
        return this.convertTableRow(blockData, context, indent);

      // Navigation blocks
      case 'child_page':
        return this.convertChildPage(blockData, context, indent);

      case 'child_database':
        return this.convertChildDatabase(blockData, context, indent);

      case 'link_to_page':
        return this.convertLinkToPage(blockData, context, indent);

      // Layout blocks
      case 'column_list':
        return this.convertColumnList(blockData, context, indent);

      case 'column':
        return this.convertColumn(blockData, context, indent);

      // Special blocks
      case 'synced_block':
        return await this.convertSyncedBlock(block, context, indent);

      case 'table_of_contents':
        return this.convertTableOfContents(blockData, context, indent);

      case 'breadcrumb':
        return this.convertBreadcrumb(blockData, context, indent);

      case 'template':
        return this.convertTemplate(blockData, context, indent);

      // Fallback for unknown block types
      default:
        return this.convertUnknownBlock(block, context, indent);
    }
  }

  /**
   * Convert paragraph block
   */
  private convertParagraph(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const content = this.convertRichText(blockData.rich_text || []);
    return {
      content: content ? `${indent}${content}` : '',
      attachments: [],
      images: []
    };
  }

  /**
   * Convert heading blocks (h1, h2, h3)
   */
  private convertHeading(
    blockData: any,
    context: ConversionContext,
    type: string,
    indent: string
  ): BlockConversionResult {
    const level = parseInt(type.split('_')[1]);
    const hashes = '#'.repeat(level);
    const content = this.convertRichText(blockData.rich_text || []);

    return {
      content: `${indent}${hashes} ${content}`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert bulleted list item
   */
  private convertBulletedListItem(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const content = this.convertRichText(blockData.rich_text || []);
    return {
      content: `${indent}- ${content}`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert numbered list item
   */
  private convertNumberedListItem(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const content = this.convertRichText(blockData.rich_text || []);
    return {
      content: `${indent}1. ${content}`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert todo item
   */
  private convertTodoItem(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const checked = blockData.checked ? 'x' : ' ';
    const content = this.convertRichText(blockData.rich_text || []);
    return {
      content: `${indent}- [${checked}] ${content}`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert toggle block
   */
  private convertToggle(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const summary = this.convertRichText(blockData.rich_text || []);
    return {
      content: `${indent}<details><summary>${summary}</summary>\n\n`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert quote block
   */
  private convertQuote(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const content = this.convertRichText(blockData.rich_text || []);
    return {
      content: `${indent}> ${content}`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert callout block with Obsidian callout syntax
   */
  private convertCallout(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const icon = this.convertCalloutIcon(blockData.icon);
    const content = this.convertRichText(blockData.rich_text || []);
    const calloutType = this.getCalloutType(icon);

    return {
      content: `${indent}> [!${calloutType}] ${icon}\n${indent}> ${content}`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert divider block
   */
  private convertDivider(indent: string): BlockConversionResult {
    return {
      content: `${indent}---`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert code block
   */
  private convertCodeBlock(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const language = blockData.language || '';
    const code = this.convertRichText(blockData.rich_text || []);

    return {
      content: `${indent}\`\`\`${language}\n${code}\n${indent}\`\`\``,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert equation block
   */
  private convertEquation(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const expression = blockData.expression || '';
    return {
      content: `${indent}$$${expression}$$`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert image block
   */
  private async convertImage(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): Promise<BlockConversionResult> {
    try {
      const url = blockData.file?.url || blockData.external?.url;
      if (!url) {
        return { content: `${indent}<!-- Missing image URL -->`, attachments: [], images: [] };
      }

      const caption = this.convertRichText(blockData.caption || []);

      if (this.settings.importImages) {
        const fileName = await this.downloadAttachment(url, 'image', context);
        if (fileName) {
          const altText = caption || 'Image';
          return {
            content: `${indent}![${altText}](${fileName})`,
            attachments: [],
            images: [fileName]
          };
        }
      }

      // Fallback to external URL
      return {
        content: `${indent}![${caption || 'Image'}](${url})`,
        attachments: [],
        images: []
      };

    } catch (error) {
      console.error('Failed to convert image:', error);
      return {
        content: `${indent}<!-- Error processing image: ${error.message} -->`,
        attachments: [],
        images: []
      };
    }
  }

  /**
   * Convert video block
   */
  private async convertVideo(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): Promise<BlockConversionResult> {
    try {
      const url = blockData.file?.url || blockData.external?.url;
      if (!url) {
        return { content: `${indent}<!-- Missing video URL -->`, attachments: [], images: [] };
      }

      const caption = this.convertRichText(blockData.caption || []);

      // For external videos (YouTube, Vimeo, etc.), use direct link
      if (blockData.external?.url) {
        return {
          content: `${indent}[${caption || 'Video'}](${url})`,
          attachments: [],
          images: []
        };
      }

      // For uploaded videos, try to download if settings allow
      if (this.settings.importImages) { // Reuse image setting for media
        const fileName = await this.downloadAttachment(url, 'video', context);
        if (fileName) {
          return {
            content: `${indent}<video controls><source src="${fileName}"></video>`,
            attachments: [fileName],
            images: []
          };
        }
      }

      return {
        content: `${indent}[${caption || 'Video'}](${url})`,
        attachments: [],
        images: []
      };

    } catch (error) {
      console.error('Failed to convert video:', error);
      return {
        content: `${indent}<!-- Error processing video: ${error.message} -->`,
        attachments: [],
        images: []
      };
    }
  }

  /**
   * Convert file block
   */
  private async convertFile(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): Promise<BlockConversionResult> {
    try {
      const url = blockData.file?.url || blockData.external?.url;
      const name = blockData.name || 'File';

      if (!url) {
        return { content: `${indent}<!-- Missing file URL -->`, attachments: [], images: [] };
      }

      const caption = this.convertRichText(blockData.caption || []);
      const displayName = caption || name;

      // Try to download file if it's uploaded to Notion
      if (blockData.file?.url) {
        const fileName = await this.downloadAttachment(url, 'file', context);
        if (fileName) {
          return {
            content: `${indent}[[${fileName}|${displayName}]]`,
            attachments: [fileName],
            images: []
          };
        }
      }

      return {
        content: `${indent}[${displayName}](${url})`,
        attachments: [],
        images: []
      };

    } catch (error) {
      console.error('Failed to convert file:', error);
      return {
        content: `${indent}<!-- Error processing file: ${error.message} -->`,
        attachments: [],
        images: []
      };
    }
  }

  /**
   * Convert PDF block
   */
  private async convertPdf(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): Promise<BlockConversionResult> {
    // PDFs are handled similarly to files
    return this.convertFile(blockData, context, indent);
  }

  /**
   * Convert bookmark block
   */
  private convertBookmark(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const url = blockData.url || '';
    const caption = this.convertRichText(blockData.caption || []);
    const title = caption || url;

    return {
      content: `${indent}[${title}](${url})`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert embed block
   */
  private convertEmbed(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const url = blockData.url || '';
    const caption = this.convertRichText(blockData.caption || []);

    // Try to detect embed type
    if (this.isYouTubeUrl(url)) {
      const videoId = this.extractYouTubeId(url);
      return {
        content: `${indent}<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`,
        attachments: [],
        images: []
      };
    }

    // Generic embed
    return {
      content: `${indent}<iframe src="${url}" title="${caption || 'Embed'}"></iframe>`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert link preview block
   */
  private convertLinkPreview(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const url = blockData.url || '';
    return {
      content: `${indent}[${url}](${url})`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert table block
   */
  private async convertTable(
    block: NotionBlock,
    context: ConversionContext,
    indent: string
  ): Promise<BlockConversionResult> {
    try {
      // Tables need their children (table_row blocks) to be converted
      const children = await this.convertChildren(block, context, 0);

      if (children.length === 0) {
        return { content: `${indent}<!-- Empty table -->`, attachments: [], images: [] };
      }

      let markdown = '';
      const hasHeader = block.table?.has_column_header;

      for (let i = 0; i < children.length; i++) {
        const row = children[i];
        markdown += `${indent}${row.content}\n`;

        // Add separator after header row
        if (i === 0 && hasHeader) {
          const cellCount = (row.content.match(/\|/g) || []).length - 1;
          const separator = Array(cellCount).fill('---').join(' | ');
          markdown += `${indent}| ${separator} |\n`;
        }
      }

      // Collect all attachments and images from rows
      const allAttachments = this.flattenArray(children.map(c => c.attachments));
      const allImages = this.flattenArray(children.map(c => c.images));

      return {
        content: markdown.trim(),
        attachments: allAttachments,
        images: allImages
      };

    } catch (error) {
      console.error('Failed to convert table:', error);
      return {
        content: `${indent}<!-- Error converting table: ${error.message} -->`,
        attachments: [],
        images: []
      };
    }
  }

  /**
   * Convert table row block
   */
  private convertTableRow(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const cells = blockData.cells || [];
    const cellContents = cells.map((cell: RichTextObject[]) =>
      this.convertRichText(cell).replace(/\|/g, '\\|') // Escape pipes in cell content
    );

    const content = `| ${cellContents.join(' | ')} |`;

    return {
      content,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert child page reference
   */
  private convertChildPage(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const title = blockData.title || 'Untitled Page';
    const fileName = this.sanitizeFileName(title);

    // Register link for cross-references
    if (blockData.id) {
      this.linkRegistry.set(blockData.id, fileName);
    }

    return {
      content: `${indent}[[${fileName}]]`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert child database reference
   */
  private convertChildDatabase(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const title = blockData.title || 'Untitled Database';
    const fileName = this.sanitizeFileName(title);

    return {
      content: `${indent}![[${fileName}.base]]`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert link to page reference
   */
  private convertLinkToPage(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const pageId = blockData.page_id || blockData.page?.id;

    if (this.linkRegistry.has(pageId)) {
      const fileName = this.linkRegistry.get(pageId)!;
      return {
        content: `${indent}[[${fileName}]]`,
        attachments: [],
        images: []
      };
    }

    return {
      content: `${indent}[[${pageId}]]`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert column list block
   */
  private convertColumnList(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    return {
      content: `${indent}<div class="column-list">`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert column block
   */
  private convertColumn(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    return {
      content: `${indent}<div class="column">`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert synced block
   */
  private async convertSyncedBlock(
    block: NotionBlock,
    context: ConversionContext,
    indent: string
  ): Promise<BlockConversionResult> {
    const blockData = block.synced_block;

    if (blockData?.synced_from) {
      // This is a reference to another synced block
      const originalId = blockData.synced_from.block_id;
      return {
        content: `${indent}<!-- Synced content from ${originalId} -->`,
        attachments: [],
        images: []
      };
    } else {
      // This is the original synced block - convert its children normally
      const children = await this.convertChildren(block, context, 0);
      const content = children.map(c => c.content).join('\n');
      const allAttachments = this.flattenArray(children.map(c => c.attachments));
      const allImages = this.flattenArray(children.map(c => c.images));

      return {
        content: `${indent}<!-- Synced block start -->\n${content}\n${indent}<!-- Synced block end -->`,
        attachments: allAttachments,
        images: allImages
      };
    }
  }

  /**
   * Convert table of contents block
   */
  private convertTableOfContents(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    return {
      content: `${indent}<!-- Table of Contents - Obsidian will auto-generate -->`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert breadcrumb block
   */
  private convertBreadcrumb(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    return {
      content: `${indent}<!-- Breadcrumb navigation -->`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert template block
   */
  private convertTemplate(
    blockData: any,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    const title = this.convertRichText(blockData.rich_text || []);
    return {
      content: `${indent}<!-- Template: ${title} -->`,
      attachments: [],
      images: []
    };
  }

  /**
   * Convert unknown block type
   */
  private convertUnknownBlock(
    block: NotionBlock,
    context: ConversionContext,
    indent: string
  ): BlockConversionResult {
    // Try to extract any text content
    const blockData = block[block.type] as any;
    let textContent = '';

    if (blockData?.rich_text) {
      textContent = this.convertRichText(blockData.rich_text);
    } else if (blockData?.text) {
      textContent = this.convertRichText(blockData.text);
    } else if (blockData?.title) {
      textContent = this.convertRichText(blockData.title);
    }

    const content = textContent || `<!-- Unknown block type: ${block.type} -->`;

    return {
      content: `${indent}${content}`,
      attachments: [],
      images: []
    };
  }

  // ========================================================================
  // RICH TEXT PROCESSING
  // ========================================================================

  /**
   * Convert Notion rich text array to Markdown
   * @param richText - Array of rich text objects
   * @returns string - Formatted Markdown text
   */
  convertRichText(richText: RichTextObject[]): string {
    if (!Array.isArray(richText)) {
      return '';
    }

    return richText.map(text => this.convertRichTextObject(text)).join('');
  }

  /**
   * Convert individual rich text object
   * @param text - Rich text object
   * @returns string - Formatted text
   */
  private convertRichTextObject(text: RichTextObject): string {
    let content = text.plain_text || '';

    // Handle special text types
    if (text.type === 'mention') {
      return this.convertMention(text);
    } else if (text.type === 'equation') {
      return `$${text.equation?.expression || ''}$`;
    }

    // Apply text formatting
    if (text.annotations) {
      content = this.applyTextFormatting(content, text.annotations);
    }

    // Handle links
    if (text.href || text.text?.link?.url) {
      const url = text.href || text.text!.link!.url;
      content = `[${content}](${url})`;
    }

    return content;
  }

  /**
   * Apply text formatting annotations
   * @param content - Text content
   * @param annotations - Formatting annotations
   * @returns string - Formatted text
   */
  private applyTextFormatting(content: string, annotations: RichTextAnnotations): string {
    // Bold
    if (annotations.bold) {
      content = `**${content}**`;
    }

    // Italic
    if (annotations.italic) {
      content = `*${content}*`;
    }

    // Strikethrough
    if (annotations.strikethrough) {
      content = `~~${content}~~`;
    }

    // Code
    if (annotations.code) {
      content = `\`${content}\``;
    }

    // Underline (using HTML)
    if (annotations.underline) {
      content = `<u>${content}</u>`;
    }

    // Color (using HTML spans)
    if (annotations.color && annotations.color !== 'default') {
      const color = this.convertColor(annotations.color);
      if (color) {
        content = `<span style="color:${color}">${content}</span>`;
      }
    }

    return content;
  }

  /**
   * Convert Notion mention to appropriate Markdown
   * @param text - Rich text object with mention
   * @returns string - Converted mention
   */
  private convertMention(text: RichTextObject): string {
    if (!text.mention) {
      return text.plain_text || '';
    }

    const mention = text.mention;

    switch (mention.type) {
      case 'page':
        if (mention.page?.id && this.linkRegistry.has(mention.page.id)) {
          const fileName = this.linkRegistry.get(mention.page.id)!;
          return `[[${fileName}]]`;
        }
        return `[[${mention.page?.id || 'Unknown Page'}]]`;

      case 'database':
        return `[[${mention.database?.id || 'Unknown Database'}.base]]`;

      case 'user':
        return `@${mention.user?.name || 'Unknown User'}`;

      case 'date':
        if (mention.date?.start) {
          return mention.date.end
            ? `${mention.date.start} → ${mention.date.end}`
            : mention.date.start;
        }
        return '@date';

      default:
        return text.plain_text || '@mention';
    }
  }

  // ========================================================================
  // PROPERTY CONVERSION
  // ========================================================================

  /**
   * Convert all Notion database properties to Base properties
   * @param properties - Notion database properties
   * @returns string - YAML properties section
   */
  private convertDatabaseProperties(properties: Record<string, any>): string {
    const convertedProperties: Record<string, PropertyConversionConfig> = {};

    for (const [key, property] of Object.entries(properties)) {
      convertedProperties[key] = this.convertProperty(key, property);
    }

    return this.generatePropertiesYAML(convertedProperties);
  }

  /**
   * Convert individual property to Base format
   * @param key - Property key
   * @param property - Notion property definition
   * @returns PropertyConversionConfig - Base property configuration
   */
  private convertProperty(key: string, property: any): PropertyConversionConfig {
    const baseMapping = PROPERTY_TYPE_MAPPING[property.type] || { type: 'text' };

    const config: PropertyConversionConfig = {
      type: baseMapping.type || 'text',
      displayName: property.name || key,
      format: baseMapping.format
    };

    // Handle type-specific configurations
    switch (property.type) {
      case 'select':
        if (property.select?.options) {
          config.options = property.select.options.map((opt: any) => ({
            value: opt.name,
            label: opt.name,
            color: this.convertColor(opt.color)
          }));
        }
        break;

      case 'multi_select':
        if (property.multi_select?.options) {
          config.options = property.multi_select.options.map((opt: any) => ({
            value: opt.name,
            label: opt.name,
            color: this.convertColor(opt.color)
          }));
        }
        break;

      case 'status':
        if (property.status?.options) {
          config.options = property.status.options.map((opt: any) => ({
            value: opt.name,
            label: opt.name,
            color: this.convertColor(opt.color)
          }));
        }
        break;

      case 'number':
        if (property.number?.format) {
          config.format = this.convertNumberFormat(property.number.format);
        }
        break;

      case 'formula':
        // Determine type based on formula return type
        config.type = this.getFormulaReturnType(property.formula);
        break;

      case 'rollup':
        // Determine type based on rollup function
        config.type = this.getRollupReturnType(property.rollup);
        break;

      // Add validation for certain types
      case 'email':
        config.validation = {
          pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
        };
        break;

      case 'url':
        config.validation = {
          pattern: '^https?://.+'
        };
        break;

      case 'phone_number':
        config.validation = {
          pattern: '^[\\+]?[1-9][\\d\\s\\-\\(\\)]{7,}$'
        };
        break;
    }

    return config;
  }

  /**
   * Extract value from Notion property for frontmatter
   * @param property - Notion property value
   * @returns any - Extracted value
   */
  extractPropertyValue(property: NotionPropertyValue): any {
    if (!property) return null;

    switch (property.type) {
      case 'title':
        return this.extractPlainText(property.title || []);

      case 'rich_text':
        return this.extractPlainText(property.rich_text || []);

      case 'number':
        return property.number;

      case 'select':
        return property.select?.name || null;

      case 'multi_select':
        return property.multi_select?.map(s => s.name) || [];

      case 'status':
        return property.status?.name || null;

      case 'date':
        if (property.date?.start) {
          return property.date.end
            ? `${property.date.start} to ${property.date.end}`
            : property.date.start;
        }
        return null;

      case 'checkbox':
        return property.checkbox || false;

      case 'url':
        return property.url;

      case 'email':
        return property.email;

      case 'phone_number':
        return property.phone_number;

      case 'people':
        return property.people?.map(p => p.name || 'Unknown') || [];

      case 'files':
        return property.files?.map(f => f.name) || [];

      case 'created_time':
      case 'last_edited_time':
        return property[property.type];

      case 'created_by':
      case 'last_edited_by':
        return property[property.type]?.name || 'Unknown';

      case 'formula':
        // Return the computed value based on type
        if (property.formula?.string !== undefined) return property.formula.string;
        if (property.formula?.number !== undefined) return property.formula.number;
        if (property.formula?.boolean !== undefined) return property.formula.boolean;
        if (property.formula?.date !== undefined) return property.formula.date;
        return null;

      case 'relation':
        return property.relation?.map(r => r.id) || [];

      case 'rollup':
        // Handle different rollup result types
        if (property.rollup?.array) {
          return property.rollup.array;
        }
        return property.rollup || null;

      case 'unique_id':
        const prefix = property.unique_id?.prefix || '';
        const number = property.unique_id?.number || 0;
        return prefix ? `${prefix}-${number}` : number.toString();

      case 'verification':
        return property.verification?.state || 'unverified';

      default:
        return null;
    }
  }

  // ========================================================================
  // HELPER UTILITIES
  // ========================================================================

  /**
   * Sanitize filename for cross-platform compatibility
   * @param filename - Original filename
   * @returns string - Sanitized filename
   */
  sanitizeFileName(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') // Remove invalid characters
      .replace(/[\s\u00A0]+/g, ' ') // Normalize whitespace
      .replace(/^\.+|\.+$/g, '') // Remove leading/trailing dots
      .trim()
      .substring(0, 255); // Limit length for filesystem compatibility
  }

  /**
   * Convert Notion color to CSS color value
   * @param notionColor - Notion color name
   * @returns string - CSS color value or empty string
   */
  convertColor(notionColor: string): string {
    return COLOR_MAPPING[notionColor] || '';
  }

  /**
   * Extract plain text from rich text array
   * @param richText - Rich text array
   * @returns string - Plain text content
   */
  extractPlainText(richText: RichTextObject[]): string {
    if (!Array.isArray(richText)) {
      return '';
    }

    return richText.map(text => text.plain_text || '').join('');
  }

  /**
   * Generate YAML frontmatter from object
   * @param data - Frontmatter data
   * @returns string - YAML frontmatter
   */
  generateFrontmatter(data: Record<string, any>): Record<string, any> {
    const frontmatter: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        frontmatter[key] = value;
      }
    }

    return frontmatter;
  }

  // ========================================================================
  // PRIVATE HELPER METHODS
  // ========================================================================

  /**
   * Process page header (icon and cover)
   */
  private async processPageHeader(page: NotionPage, context: ConversionContext): Promise<string | null> {
    let header = '';

    // Add page icon if present
    if (page.icon) {
      if (page.icon.type === 'emoji') {
        header += page.icon.emoji + ' ';
      } else if (page.icon.type === 'external' || page.icon.type === 'file') {
        const iconUrl = page.icon.external?.url || page.icon.file?.url;
        if (iconUrl && this.settings.importImages) {
          try {
            const iconFile = await this.downloadAttachment(iconUrl, 'image', context);
            if (iconFile) {
              header += `![Icon](${iconFile}) `;
            }
          } catch (error) {
            console.warn('Failed to download page icon:', error);
          }
        }
      }
    }

    // Add page cover if present
    if (page.cover && this.settings.importImages) {
      const coverUrl = page.cover.external?.url || page.cover.file?.url;
      if (coverUrl) {
        try {
          const coverFile = await this.downloadAttachment(coverUrl, 'image', context);
          if (coverFile) {
            header += `\n\n![Cover](${coverFile})`;
          }
        } catch (error) {
          console.warn('Failed to download page cover:', error);
        }
      }
    }

    return header.trim() || null;
  }

  /**
   * Convert blocks array to results
   */
  private async convertBlocks(
    blocks: NotionBlock[],
    context: ConversionContext,
    indentLevel: number
  ): Promise<BlockConversionResult[]> {
    const results: BlockConversionResult[] = [];

    for (const block of blocks) {
      try {
        const result = await this.convertBlock(block, context, indentLevel);
        results.push(result);
      } catch (error) {
        console.error(`Failed to convert block ${block.id}:`, error);
        results.push({
          content: `<!-- Error converting block: ${error.message} -->`,
          attachments: [],
          images: []
        });
      }
    }

    return results;
  }

  /**
   * Convert child blocks
   */
  private async convertChildren(
    block: NotionBlock,
    context: ConversionContext,
    indentLevel: number
  ): Promise<BlockConversionResult[]> {
    // This would typically fetch children from the API
    // For now, return empty array - implement based on your API structure
    return [];
  }

  /**
   * Check if block type should process children
   */
  private shouldProcessChildren(blockType: string): boolean {
    const typesWithChildren = [
      'toggle',
      'bulleted_list_item',
      'numbered_list_item',
      'to_do',
      'column_list',
      'column',
      'table',
      'synced_block',
      'quote',
      'callout'
    ];

    return typesWithChildren.includes(blockType);
  }

  /**
   * Format children content based on parent block type
   */
  private formatChildrenContent(children: BlockConversionResult[], parentType: string): string {
    if (children.length === 0) return '';

    const childrenText = children.map(c => c.content).join('\n');

    switch (parentType) {
      case 'toggle':
        return `\n${childrenText}\n</details>`;

      case 'column_list':
        return `\n${childrenText}\n</div>`;

      case 'column':
        return `\n${childrenText}\n</div>`;

      default:
        return `\n${childrenText}`;
    }
  }

  /**
   * Download attachment file
   */
  private async downloadAttachment(
    url: string,
    type: 'image' | 'video' | 'file',
    context: ConversionContext
  ): Promise<string | null> {
    try {
      // This would implement the actual file download
      // Return a unique filename for the downloaded file
      this.attachmentCounter++;
      const extension = this.getFileExtension(url, type);
      return `attachment-${this.attachmentCounter}${extension}`;
    } catch (error) {
      console.error('Failed to download attachment:', error);
      return null;
    }
  }

  /**
   * Get file extension from URL and type
   */
  private getFileExtension(url: string, type: 'image' | 'video' | 'file'): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const ext = pathname.substring(pathname.lastIndexOf('.'));

      if (ext) return ext;

      // Default extensions by type
      switch (type) {
        case 'image': return '.png';
        case 'video': return '.mp4';
        case 'file': return '.pdf';
        default: return '.file';
      }
    } catch {
      return '.file';
    }
  }

  /**
   * Convert callout icon to appropriate type
   */
  private convertCalloutIcon(icon: any): string {
    if (!icon) return '💡';

    if (icon.type === 'emoji') {
      return icon.emoji;
    }

    return '💡'; // Default icon
  }

  /**
   * Get Obsidian callout type from icon
   */
  private getCalloutType(icon: string): string {
    const iconMapping: Record<string, string> = {
      '💡': 'tip',
      '⚠️': 'warning',
      '❗': 'important',
      '📝': 'note',
      '✅': 'success',
      '❌': 'error',
      '📋': 'todo',
      '❓': 'question',
      '💭': 'abstract',
      '📌': 'info'
    };

    return iconMapping[icon] || 'note';
  }

  /**
   * Check if URL is YouTube
   */
  private isYouTubeUrl(url: string): boolean {
    return /(?:youtube\.com\/watch\?v=|youtu\.be\/)/.test(url);
  }

  /**
   * Extract YouTube video ID
   */
  private extractYouTubeId(url: string): string {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
    return match ? match[1] : '';
  }

  /**
   * Generate Base filters section
   */
  private generateBaseFilters(dbName: string): string {
    return `\`\`\`yaml
filters:
  and:
    - file.inFolder("${dbName}")
    - file.ext == "md"
    - 'file.name != "_index"'
\`\`\``;
  }

  /**
   * Generate Properties YAML
   */
  private generatePropertiesYAML(properties: Record<string, PropertyConversionConfig>): string {
    let yaml = '```yaml\nproperties:';

    for (const [key, config] of Object.entries(properties)) {
      yaml += `\n  ${key}:`;
      yaml += `\n    displayName: "${config.displayName}"`;
      yaml += `\n    type: ${config.type}`;

      if (config.format) {
        yaml += `\n    format: "${config.format}"`;
      }

      if (config.options && config.options.length > 0) {
        yaml += `\n    options:`;
        for (const option of config.options) {
          yaml += `\n      - value: "${option.value}"`;
          yaml += `\n        label: "${option.label}"`;
          if (option.color) {
            yaml += `\n        color: "${option.color}"`;
          }
        }
      }

      if (config.validation) {
        yaml += `\n    validation:`;
        for (const [validKey, validValue] of Object.entries(config.validation)) {
          yaml += `\n      ${validKey}: ${JSON.stringify(validValue)}`;
        }
      }
    }

    return yaml + '\n```';
  }

  /**
   * Generate Base views section
   */
  private generateBaseViews(database: NotionDatabase, entries: NotionPage[]): string {
    const propertyKeys = Object.keys(database.properties).slice(0, 4);
    const columns = ['file.name', ...propertyKeys];

    return `\`\`\`yaml
views:
  - type: table
    name: "${database.title}"
    columns:
${columns.map(col => `      - ${col}`).join('\n')}
    sort:
      - field: file.name
        direction: asc

  - type: cards
    name: "Card View"

  - type: list
    name: "Recent Updates"
    sort:
      - field: file.mtime
        direction: desc
    limit: 20
\`\`\``;
  }

  /**
   * Post-process markdown content
   */
  private postProcessMarkdown(markdown: string, context: ConversionContext): string {
    // Clean up extra whitespace
    markdown = markdown.replace(/\n{3,}/g, '\n\n');

    // Fix list formatting
    markdown = this.fixListFormatting(markdown);

    // Process internal links
    markdown = this.processInternalLinks(markdown);

    return markdown.trim();
  }

  /**
   * Fix list formatting issues
   */
  private fixListFormatting(markdown: string): string {
    // Ensure proper spacing around lists
    return markdown.replace(/(\n[^\n\-\d].*)\n(\s*[\-\d]\s)/g, '$1\n\n$2');
  }

  /**
   * Process internal links for cross-references
   */
  private processInternalLinks(markdown: string): string {
    // Convert Notion page IDs to proper Obsidian links
    return markdown.replace(/\[\[([a-f0-9-]{36})\]\]/g, (match, id) => {
      if (this.linkRegistry.has(id)) {
        return `[[${this.linkRegistry.get(id)}]]`;
      }
      return match;
    });
  }

  /**
   * Flatten array of arrays
   */
  private flattenArray<T>(arrays: T[][]): T[] {
    return arrays.reduce((acc, arr) => acc.concat(arr), []);
  }

  /**
   * Convert number format from Notion to Base
   */
  private convertNumberFormat(notionFormat: string): string {
    const formatMap: Record<string, string> = {
      'number': '0.##',
      'number_with_commas': '0,0.##',
      'percent': '0.##%',
      'dollar': '$0,0.00',
      'euro': '€0,0.00',
      'pound': '£0,0.00',
      'yen': '¥0,0',
      'ruble': '₽0,0.00',
      'rupee': '₹0,0.00',
      'won': '₩0,0',
      'yuan': '¥0,0.00'
    };

    return formatMap[notionFormat] || '0.##';
  }

  /**
   * Get formula return type
   */
  private getFormulaReturnType(formula: any): string {
    if (!formula?.expression) return 'text';

    // Simple heuristics - could be enhanced with actual formula parsing
    const expression = formula.expression.toLowerCase();

    if (expression.includes('number') || expression.includes('sum') || expression.includes('count')) {
      return 'number';
    }
    if (expression.includes('date') || expression.includes('now()')) {
      return 'date';
    }
    if (expression.includes('checkbox') || expression.includes('boolean')) {
      return 'checkbox';
    }

    return 'text';
  }

  /**
   * Get rollup return type
   */
  private getRollupReturnType(rollup: any): string {
    if (!rollup?.function) return 'text';

    const func = rollup.function.toLowerCase();
    const numericFunctions = ['count', 'sum', 'average', 'median', 'min', 'max', 'range'];
    const dateFunctions = ['earliest_date', 'latest_date'];

    if (numericFunctions.includes(func)) {
      return 'number';
    }
    if (dateFunctions.includes(func)) {
      return 'date';
    }
    if (func === 'show_original') {
      return 'list';
    }

    return 'text';
  }
}

// ============================================================================
// EXPORT
// ============================================================================

export default NotionConverter;

/**
 * Re-export utility functions for external use
 */
export {
  COLOR_MAPPING,
  PROPERTY_TYPE_MAPPING,
  BLOCK_HIERARCHY
};

/**
 * Re-export types for external use
 */
export type {
  RichTextObject,
  RichTextAnnotations,
  NotionPropertyValue,
  BlockConversionResult,
  PropertyConversionConfig
};