/**
 * BaseGenerator - Notion Database to Obsidian Base YAML converter
 *
 * @author Notion API Importer Team
 * @version 1.0.0
 * @license MIT
 *
 * CRITICAL PHASE 3 REQUIREMENTS:
 * - Converts ALL 21 Notion property types to Base properties
 * - Generates valid Obsidian Base YAML files
 * - Creates proper folder structure with Base configuration
 * - Maps property types with validation rules and color preservation
 * - Generates comprehensive views (table, cards, list)
 * - Creates database overview in _index.md
 * - Preserves Notion colors and formatting where possible
 *
 * Mobile-Safe Implementation:
 * - No Node.js dependencies
 * - Uses Obsidian Vault API exclusively
 * - Platform-aware file operations
 */

import { Platform } from 'obsidian';
import type {
  NotionDatabase,
  NotionPage,
  NotionImporterSettings,
  ConversionContext
} from '../types';

// ============================================================================
// TYPE DEFINITIONS - Base YAML Structure
// ============================================================================

/**
 * Obsidian Base YAML structure interface
 */
interface BaseConfig {
  filters: {
    and: Array<string | Record<string, any>>;
  };
  properties: Record<string, BaseProperty>;
  views: BaseView[];
}

/**
 * Base property definition with type and validation
 */
interface BaseProperty {
  displayName: string;
  type: BasePropertyType;
  options?: BasePropertyOption[];
  format?: string;
  validation?: PropertyValidation;
  default?: any;
  description?: string;
}

/**
 * Base property types supported by Obsidian Bases
 */
type BasePropertyType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'checkbox'
  | 'date'
  | 'select'
  | 'tags'
  | 'list'
  | 'url'
  | 'email'
  | 'file'
  | 'color';

/**
 * Property options for select and tags
 */
interface BasePropertyOption {
  value: string;
  label: string;
  color?: string;
  description?: string;
}

/**
 * Property validation rules
 */
interface PropertyValidation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
}

/**
 * Base view configuration
 */
interface BaseView {
  type: 'table' | 'cards' | 'list' | 'gallery' | 'calendar';
  name: string;
  columns?: string[];
  group?: string;
  sort?: Array<{
    field: string;
    direction: 'asc' | 'desc';
  }>;
  filter?: Record<string, any>;
  limit?: number;
  cardSize?: 'small' | 'medium' | 'large';
  showPreview?: boolean;
}

/**
 * Database overview metadata for _index.md
 */
interface DatabaseOverview {
  title: string;
  description?: string;
  totalEntries: number;
  properties: Record<string, string>;
  lastUpdated: string;
  notionUrl: string;
  createdTime: string;
  lastEditedTime: string;
}

// ============================================================================
// NOTION TO BASE PROPERTY TYPE MAPPING
// ============================================================================

/**
 * Comprehensive mapping of all 21 Notion property types to Base properties
 * Based on PRD Section 4.2 Property Type Mapping Matrix
 */
const NOTION_TO_BASE_MAPPING: Record<string, {
  type: BasePropertyType;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  converter: (notionProperty: any) => Partial<BaseProperty>;
}> = {
  // CRITICAL MAPPINGS
  title: {
    type: 'text',
    priority: 'CRITICAL',
    converter: (prop) => ({
      displayName: prop.name || 'Title',
      type: 'text',
      validation: { required: true, minLength: 1 },
      description: 'Primary title of the entry'
    })
  },

  rich_text: {
    type: 'text',
    priority: 'CRITICAL',
    converter: (prop) => ({
      displayName: prop.name || 'Text',
      type: 'text',
      validation: { maxLength: 2000 },
      description: 'Rich text content (formatting stripped for Base compatibility)'
    })
  },

  number: {
    type: 'number',
    priority: 'CRITICAL',
    converter: (prop) => ({
      displayName: prop.name || 'Number',
      type: 'number',
      format: prop.number?.format || 'number',
      validation: {
        ...(prop.number?.min !== undefined && { min: prop.number.min }),
        ...(prop.number?.max !== undefined && { max: prop.number.max })
      },
      description: `Number field${prop.number?.format ? ` (${prop.number.format})` : ''}`
    })
  },

  select: {
    type: 'select',
    priority: 'CRITICAL',
    converter: (prop) => ({
      displayName: prop.name || 'Select',
      type: 'select',
      options: prop.select?.options?.map((option: any) => ({
        value: option.name || option.id,
        label: option.name || option.id,
        color: mapNotionColor(option.color),
        description: option.description
      })) || [],
      description: 'Single selection from predefined options'
    })
  },

  multi_select: {
    type: 'tags',
    priority: 'CRITICAL',
    converter: (prop) => ({
      displayName: prop.name || 'Tags',
      type: 'tags',
      options: prop.multi_select?.options?.map((option: any) => ({
        value: option.name || option.id,
        label: option.name || option.id,
        color: mapNotionColor(option.color),
        description: option.description
      })) || [],
      description: 'Multiple selections as tags'
    })
  },

  date: {
    type: 'date',
    priority: 'CRITICAL',
    converter: (prop) => ({
      displayName: prop.name || 'Date',
      type: 'date',
      format: 'YYYY-MM-DD',
      description: 'Date field with optional time'
    })
  },

  checkbox: {
    type: 'checkbox',
    priority: 'CRITICAL',
    converter: (prop) => ({
      displayName: prop.name || 'Checkbox',
      type: 'checkbox',
      default: false,
      description: 'Boolean checkbox field'
    })
  },

  relation: {
    type: 'list',
    priority: 'CRITICAL',
    converter: (prop) => ({
      displayName: prop.name || 'Related',
      type: 'list',
      description: `Links to related notes${prop.relation?.database_id ? ` in database ${prop.relation.database_id}` : ''}`
    })
  },

  created_time: {
    type: 'date',
    priority: 'CRITICAL',
    converter: (prop) => ({
      displayName: 'Created',
      type: 'date',
      format: 'YYYY-MM-DD HH:mm',
      description: 'Entry creation timestamp'
    })
  },

  last_edited_time: {
    type: 'date',
    priority: 'CRITICAL',
    converter: (prop) => ({
      displayName: 'Last Edited',
      type: 'date',
      format: 'YYYY-MM-DD HH:mm',
      description: 'Last modification timestamp'
    })
  },

  // HIGH PRIORITY MAPPINGS
  people: {
    type: 'text',
    priority: 'HIGH',
    converter: (prop) => ({
      displayName: prop.name || 'People',
      type: 'text',
      description: 'User references (names)'
    })
  },

  files: {
    type: 'list',
    priority: 'HIGH',
    converter: (prop) => ({
      displayName: prop.name || 'Files',
      type: 'list',
      description: 'File attachments and links'
    })
  },

  url: {
    type: 'url',
    priority: 'HIGH',
    converter: (prop) => ({
      displayName: prop.name || 'URL',
      type: 'url',
      validation: { pattern: '^https?://.+' },
      description: 'Web URL link'
    })
  },

  formula: {
    type: 'text', // Dynamic based on formula result
    priority: 'HIGH',
    converter: (prop) => ({
      displayName: prop.name || 'Formula',
      type: 'text', // Will be dynamically determined
      description: `Formula result: ${prop.formula?.expression || 'unknown'}`
    })
  },

  rollup: {
    type: 'text', // Dynamic based on rollup aggregation
    priority: 'HIGH',
    converter: (prop) => ({
      displayName: prop.name || 'Rollup',
      type: 'text', // Will be dynamically determined
      description: `Rollup aggregation from related records`
    })
  },

  unique_id: {
    type: 'text',
    priority: 'HIGH',
    converter: (prop) => ({
      displayName: prop.name || 'ID',
      type: 'text',
      validation: { required: true },
      description: 'Unique identifier'
    })
  },

  status: {
    type: 'select',
    priority: 'HIGH',
    converter: (prop) => ({
      displayName: prop.name || 'Status',
      type: 'select',
      options: prop.status?.options?.map((option: any) => ({
        value: option.name || option.id,
        label: option.name || option.id,
        color: mapNotionColor(option.color),
        description: option.description
      })) || [],
      description: 'Status workflow field'
    })
  },

  // MEDIUM PRIORITY MAPPINGS
  email: {
    type: 'email',
    priority: 'MEDIUM',
    converter: (prop) => ({
      displayName: prop.name || 'Email',
      type: 'email',
      validation: { pattern: '^[^@]+@[^@]+\\.[^@]+$' },
      description: 'Email address'
    })
  },

  phone_number: {
    type: 'text',
    priority: 'MEDIUM',
    converter: (prop) => ({
      displayName: prop.name || 'Phone',
      type: 'text',
      validation: { pattern: '^[+]?[0-9\\s\\-\\(\\)]+$' },
      description: 'Phone number'
    })
  },

  created_by: {
    type: 'text',
    priority: 'MEDIUM',
    converter: (prop) => ({
      displayName: 'Created By',
      type: 'text',
      description: 'User who created this entry'
    })
  },

  last_edited_by: {
    type: 'text',
    priority: 'MEDIUM',
    converter: (prop) => ({
      displayName: 'Last Edited By',
      type: 'text',
      description: 'User who last modified this entry'
    })
  },

  // LOW PRIORITY MAPPINGS
  button: {
    type: 'text',
    priority: 'LOW',
    converter: (prop) => ({
      displayName: prop.name || 'Button',
      type: 'text',
      description: 'Button field (not fully supported in Base)'
    })
  }
};

// ============================================================================
// COLOR MAPPING UTILITIES
// ============================================================================

/**
 * Maps Notion colors to Base-compatible colors
 */
function mapNotionColor(notionColor?: string): string | undefined {
  if (!notionColor) return undefined;

  const colorMap: Record<string, string> = {
    // Notion default colors to CSS colors
    'default': '#6B7280',
    'gray': '#6B7280',
    'brown': '#92400E',
    'orange': '#EA580C',
    'yellow': '#CA8A04',
    'green': '#16A34A',
    'blue': '#2563EB',
    'purple': '#9333EA',
    'pink': '#DB2777',
    'red': '#DC2626',

    // Background colors (lighter variants)
    'gray_background': '#F3F4F6',
    'brown_background': '#FEF3C7',
    'orange_background': '#FED7AA',
    'yellow_background': '#FEF3C7',
    'green_background': '#D1FAE5',
    'blue_background': '#DBEAFE',
    'purple_background': '#E9D5FF',
    'pink_background': '#FCE7F3',
    'red_background': '#FEE2E2'
  };

  return colorMap[notionColor] || notionColor;
}

// ============================================================================
// MAIN BASE GENERATOR CLASS
// ============================================================================

/**
 * BaseGenerator - Converts Notion databases to Obsidian Base configurations
 */
export class BaseGenerator {
  private settings: NotionImporterSettings;
  private context: ConversionContext;
  private vault: any; // Obsidian Vault API

  constructor(settings: NotionImporterSettings, context: ConversionContext, vault: any) {
    this.settings = settings;
    this.context = context;
    this.vault = vault;
  }

  /**
   * Generates a complete Base configuration from a Notion database
   * @param database - Notion database object
   * @param pages - Array of pages in the database
   * @returns BaseConfig object ready for YAML serialization
   */
  public generateBaseConfig(database: NotionDatabase, pages: NotionPage[]): BaseConfig {
    try {
      if (!database || !database.title) {
        throw new Error('Invalid database: missing title');
      }

      if (!database.properties || typeof database.properties !== 'object') {
        throw new Error('Invalid database: missing or invalid properties');
      }

      const databaseName = this.sanitizeFolderName(database.title);

      return {
        filters: this.generateFilters(databaseName),
        properties: this.generateProperties(database.properties),
        views: this.generateViews(database, pages || [])
      };
    } catch (error) {
      console.error('Failed to generate Base config:', error);
      throw new Error(`Base configuration generation failed: ${error.message}`);
    }
  }

  /**
   * Creates the folder structure for a database import
   * @param database - Notion database object
   * @param pages - Array of pages in the database
   * @returns Promise resolving to folder path
   */
  public async createDatabaseStructure(
    database: NotionDatabase,
    pages: NotionPage[]
  ): Promise<string> {
    const basePath = this.settings.defaultOutputFolder;
    const databaseName = this.sanitizeFolderName(database.title);
    const folderPath = `${basePath}/${databaseName}`;

    try {
      // Create database folder
      await this.ensureFolderExists(folderPath);

      // Generate and save Base configuration
      const baseConfig = this.generateBaseConfig(database, pages);
      const baseYaml = this.serializeBaseConfig(baseConfig);
      await this.vault.create(
        `${folderPath}/${databaseName}.base`,
        baseYaml
      );

      // Generate and save database overview
      const overview = this.generateDatabaseOverview(database, pages);
      const overviewMd = this.serializeDatabaseOverview(overview);
      await this.vault.create(
        `${folderPath}/_index.md`,
        overviewMd
      );

      return folderPath;
    } catch (error) {
      throw new Error(`Failed to create database structure: ${error.message}`);
    }
  }

  // ============================================================================
  // FILTER GENERATION
  // ============================================================================

  /**
   * Generates Base filters for database folder
   */
  private generateFilters(databaseName: string): { and: Array<string | Record<string, any>> } {
    return {
      and: [
        `file.inFolder("${databaseName}")`,
        'file.ext == "md"',
        'file.name != "_index"'
      ]
    };
  }

  // ============================================================================
  // PROPERTY GENERATION
  // ============================================================================

  /**
   * Converts all Notion properties to Base properties
   */
  private generateProperties(notionProperties: Record<string, any>): Record<string, BaseProperty> {
    const baseProperties: Record<string, BaseProperty> = {};

    // Always include the file name as primary identifier
    baseProperties['file.name'] = {
      displayName: 'Name',
      type: 'text',
      validation: { required: true },
      description: 'File name (auto-generated)'
    };

    // Convert each Notion property
    for (const [propertyName, notionProperty] of Object.entries(notionProperties)) {
      const propertyType = notionProperty.type;
      const mapping = NOTION_TO_BASE_MAPPING[propertyType];

      if (mapping) {
        const sanitizedName = this.sanitizePropertyName(propertyName);
        const baseProperty = {
          ...mapping.converter(notionProperty),
          displayName: notionProperty.name || propertyName
        } as BaseProperty;

        baseProperties[sanitizedName] = baseProperty;
      } else {
        // Fallback for unknown property types
        console.warn(`Unknown Notion property type: ${propertyType}`);
        const sanitizedName = this.sanitizePropertyName(propertyName);
        baseProperties[sanitizedName] = {
          displayName: propertyName,
          type: 'text',
          description: `Unknown property type: ${propertyType}`
        };
      }
    }

    return baseProperties;
  }

  /**
   * Sanitizes property names for Base compatibility
   */
  private sanitizePropertyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '');
  }

  // ============================================================================
  // VIEW GENERATION
  // ============================================================================

  /**
   * Generates comprehensive views for the Base
   */
  private generateViews(database: NotionDatabase, pages: NotionPage[]): BaseView[] {
    const views: BaseView[] = [];
    const properties = Object.keys(database.properties);
    const databaseName = database.title;

    // 1. Default Table View
    views.push({
      type: 'table',
      name: databaseName,
      columns: this.selectTableColumns(properties),
      sort: this.generateDefaultSort(properties)
    });

    // 2. Cards View (if suitable properties exist)
    const cardableProperties = this.findCardableProperties(database.properties);
    if (cardableProperties.length > 0) {
      views.push({
        type: 'cards',
        name: 'Card View',
        group: cardableProperties[0],
        cardSize: 'medium',
        showPreview: true
      });
    }

    // 3. List View
    views.push({
      type: 'list',
      name: 'List View',
      sort: this.generateDefaultSort(properties)
    });

    // 4. Status/Select-based views
    const selectProperties = this.findSelectProperties(database.properties);
    for (const selectProp of selectProperties.slice(0, 2)) { // Limit to 2 to avoid clutter
      views.push({
        type: 'cards',
        name: `By ${selectProp}`,
        group: this.sanitizePropertyName(selectProp),
        cardSize: 'small'
      });
    }

    // 5. Calendar view (if date properties exist)
    const dateProperties = this.findDateProperties(database.properties);
    if (dateProperties.length > 0) {
      views.push({
        type: 'calendar',
        name: 'Calendar',
        sort: [{ field: dateProperties[0], direction: 'asc' }]
      });
    }

    return views;
  }

  /**
   * Selects appropriate columns for table view
   */
  private selectTableColumns(properties: string[]): string[] {
    const priorityOrder = ['title', 'status', 'priority', 'due_date', 'created_time'];
    const columns = ['file.name']; // Always include file name

    // Add priority properties first
    for (const priority of priorityOrder) {
      const found = properties.find(p =>
        this.sanitizePropertyName(p).includes(priority) ||
        p.toLowerCase().includes(priority)
      );
      if (found) {
        columns.push(this.sanitizePropertyName(found));
      }
    }

    // Add remaining properties (up to 6 total)
    for (const prop of properties) {
      const sanitized = this.sanitizePropertyName(prop);
      if (!columns.includes(sanitized) && columns.length < 6) {
        columns.push(sanitized);
      }
    }

    return columns;
  }

  /**
   * Generates default sorting for views
   */
  private generateDefaultSort(properties: string[]): Array<{ field: string; direction: 'asc' | 'desc' }> {
    // Priority sorting order
    const priorityFields = ['priority', 'status', 'due_date', 'created_time', 'title'];

    for (const priority of priorityFields) {
      const found = properties.find(p =>
        this.sanitizePropertyName(p).includes(priority) ||
        p.toLowerCase().includes(priority)
      );
      if (found) {
        const direction = priority === 'priority' ? 'desc' : 'asc';
        return [{ field: this.sanitizePropertyName(found), direction }];
      }
    }

    // Fallback to file name
    return [{ field: 'file.name', direction: 'asc' }];
  }

  /**
   * Finds properties suitable for card grouping
   */
  private findCardableProperties(properties: Record<string, any>): string[] {
    const cardable = [];
    for (const [name, prop] of Object.entries(properties)) {
      if (['select', 'status', 'multi_select'].includes(prop.type)) {
        cardable.push(this.sanitizePropertyName(name));
      }
    }
    return cardable;
  }

  /**
   * Finds select and status properties
   */
  private findSelectProperties(properties: Record<string, any>): string[] {
    const selectProps = [];
    for (const [name, prop] of Object.entries(properties)) {
      if (['select', 'status'].includes(prop.type)) {
        selectProps.push(name);
      }
    }
    return selectProps;
  }

  /**
   * Finds date properties for calendar views
   */
  private findDateProperties(properties: Record<string, any>): string[] {
    const dateProps = [];
    for (const [name, prop] of Object.entries(properties)) {
      if (['date', 'created_time', 'last_edited_time'].includes(prop.type)) {
        dateProps.push(this.sanitizePropertyName(name));
      }
    }
    return dateProps;
  }

  // ============================================================================
  // DATABASE OVERVIEW GENERATION
  // ============================================================================

  /**
   * Generates database overview metadata
   */
  private generateDatabaseOverview(database: NotionDatabase, pages: NotionPage[]): DatabaseOverview {
    const propertyMap: Record<string, string> = {};

    for (const [name, prop] of Object.entries(database.properties)) {
      const mapping = NOTION_TO_BASE_MAPPING[prop.type];
      propertyMap[name] = mapping ? mapping.type : 'text';
    }

    return {
      title: database.title,
      description: database.description,
      totalEntries: pages.length,
      properties: propertyMap,
      lastUpdated: new Date().toISOString(),
      notionUrl: database.url,
      createdTime: database.createdTime,
      lastEditedTime: database.lastEditedTime
    };
  }

  // ============================================================================
  // SERIALIZATION METHODS
  // ============================================================================

  /**
   * Serializes Base configuration to YAML format
   */
  public serializeBaseConfig(config: BaseConfig): string {
    // Validate configuration before serializing
    const validation = this.validateBaseConfig(config);
    if (!validation.valid) {
      console.warn('Base configuration validation failed:', validation.errors);
    }

    // Custom YAML serialization for Base files
    let yaml = '';

    // Filters section
    yaml += 'filters:\n';
    yaml += '  and:\n';
    for (const filter of config.filters.and) {
      if (typeof filter === 'string') {
        yaml += `    - ${filter}\n`;
      } else {
        yaml += `    - ${JSON.stringify(filter)}\n`;
      }
    }

    yaml += '\n';

    // Properties section
    yaml += 'properties:\n';
    for (const [name, prop] of Object.entries(config.properties)) {
      yaml += `  ${this.sanitizePropertyName(name)}:\n`;
      yaml += `    displayName: "${this.escapeYamlString(prop.displayName)}"\n`;
      yaml += `    type: ${prop.type}\n`;

      if (prop.format) {
        yaml += `    format: "${this.escapeYamlString(prop.format)}"\n`;
      }

      if (prop.default !== undefined) {
        yaml += `    default: ${this.serializeYamlValue(prop.default)}\n`;
      }

      if (prop.description) {
        yaml += `    description: "${this.escapeYamlString(prop.description)}"\n`;
      }

      if (prop.validation) {
        yaml += '    validation:\n';
        for (const [key, value] of Object.entries(prop.validation)) {
          yaml += `      ${key}: ${this.serializeYamlValue(value)}\n`;
        }
      }

      if (prop.options && prop.options.length > 0) {
        yaml += '    options:\n';
        for (const option of prop.options) {
          yaml += `      - value: "${this.escapeYamlString(option.value)}"\n`;
          yaml += `        label: "${this.escapeYamlString(option.label)}"\n`;
          if (option.color) {
            yaml += `        color: "${this.escapeYamlString(option.color)}"\n`;
          }
          if (option.description) {
            yaml += `        description: "${this.escapeYamlString(option.description)}"\n`;
          }
        }
      }

      yaml += '\n';
    }

    // Views section
    yaml += 'views:\n';
    for (const view of config.views) {
      yaml += `  - type: ${view.type}\n`;
      yaml += `    name: "${this.escapeYamlString(view.name)}"\n`;

      if (view.columns) {
        yaml += '    columns:\n';
        for (const column of view.columns) {
          yaml += `      - ${column}\n`;
        }
      }

      if (view.group) {
        yaml += `    group: ${view.group}\n`;
      }

      if (view.sort && view.sort.length > 0) {
        yaml += '    sort:\n';
        for (const sort of view.sort) {
          yaml += `      - field: ${sort.field}\n`;
          yaml += `        direction: ${sort.direction}\n`;
        }
      }

      if (view.cardSize) {
        yaml += `    cardSize: ${view.cardSize}\n`;
      }

      if (view.showPreview !== undefined) {
        yaml += `    showPreview: ${view.showPreview}\n`;
      }

      if (view.limit) {
        yaml += `    limit: ${view.limit}\n`;
      }

      yaml += '\n';
    }

    return yaml.trim();
  }

  /**
   * Escape YAML string values
   */
  private escapeYamlString(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  /**
   * Serialize YAML value with proper type handling
   */
  private serializeYamlValue(value: any): string {
    if (typeof value === 'string') {
      return `"${this.escapeYamlString(value)}"`;
    }
    if (typeof value === 'boolean') {
      return value.toString();
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    if (value === null || value === undefined) {
      return 'null';
    }
    return JSON.stringify(value);
  }

  /**
   * Serializes database overview to Markdown
   */
  private serializeDatabaseOverview(overview: DatabaseOverview): string {
    let md = `# ${overview.title}\n\n`;

    if (overview.description) {
      md += `${overview.description}\n\n`;
    }

    md += '## Database Information\n\n';
    md += `- **Total Entries**: ${overview.totalEntries}\n`;
    md += `- **Created**: ${new Date(overview.createdTime).toLocaleDateString()}\n`;
    md += `- **Last Modified**: ${new Date(overview.lastEditedTime).toLocaleDateString()}\n`;
    md += `- **Notion URL**: [Open in Notion](${overview.notionUrl})\n`;
    md += `- **Imported**: ${new Date(overview.lastUpdated).toLocaleDateString()}\n\n`;

    md += '## Properties\n\n';
    md += '| Property | Type |\n';
    md += '|----------|------|\n';
    for (const [name, type] of Object.entries(overview.properties)) {
      md += `| ${name} | ${type} |\n`;
    }

    md += '\n## Usage\n\n';
    md += 'This folder contains all entries from the Notion database. ';
    md += 'The `.base` file configures how these entries are displayed and organized in Obsidian.\n\n';
    md += '### Available Views\n\n';
    md += '- **Table View**: Complete data in tabular format\n';
    md += '- **Card View**: Visual cards grouped by categories\n';
    md += '- **List View**: Simple list format\n';
    md += '- **Calendar View**: Date-based visualization (if applicable)\n\n';
    md += '---\n\n';
    md += '*This overview was automatically generated by the Notion API Importer.*\n';

    return md;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Sanitizes folder names for cross-platform compatibility
   */
  private sanitizeFolderName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100); // Limit length
  }

  /**
   * Ensures folder exists in vault (mobile-safe)
   */
  private async ensureFolderExists(path: string): Promise<void> {
    try {
      const exists = await this.vault.adapter.exists(path);
      if (!exists) {
        await this.vault.createFolder(path);
      }
    } catch (error) {
      // Folder might already exist or parent path issue
      throw new Error(`Failed to create folder ${path}: ${error.message}`);
    }
  }

  /**
   * Validates Base configuration before serialization
   */
  public validateBaseConfig(config: BaseConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate filters
    if (!config.filters || !config.filters.and || !Array.isArray(config.filters.and)) {
      errors.push('Missing or invalid filters.and array');
    }

    // Validate properties
    if (!config.properties || typeof config.properties !== 'object') {
      errors.push('Missing or invalid properties object');
    } else {
      for (const [name, prop] of Object.entries(config.properties)) {
        if (!prop.displayName) {
          errors.push(`Property ${name} missing displayName`);
        }
        if (!prop.type) {
          errors.push(`Property ${name} missing type`);
        }
      }
    }

    // Validate views
    if (!config.views || !Array.isArray(config.views)) {
      errors.push('Missing or invalid views array');
    } else {
      for (const view of config.views) {
        if (!view.type || !view.name) {
          errors.push('View missing type or name');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// ============================================================================
// EXPORT DEFAULT INSTANCE CREATOR
// ============================================================================

/**
 * Creates a new BaseGenerator instance
 */
export function createBaseGenerator(
  settings: NotionImporterSettings,
  context: ConversionContext,
  vault: any
): BaseGenerator {
  return new BaseGenerator(settings, context, vault);
}

/**
 * Export mapping for external use
 */
export { NOTION_TO_BASE_MAPPING, mapNotionColor };

/**
 * Export types for external use
 */
export type {
  BaseConfig,
  BaseProperty,
  BasePropertyType,
  BasePropertyOption,
  BaseView,
  DatabaseOverview,
  PropertyValidation
};