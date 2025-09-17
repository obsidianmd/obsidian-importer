# Notion API Importer Implementation

This document describes the implementation of the Notion API importer for Obsidian, addressing GitHub issue #421.

## Overview

The Notion API importer allows users to import content directly from Notion using an integration token, supporting the new API version 2025-09-03 with data source objects. This provides an alternative to the existing HTML export-based importer.

## Key Features

### Implemented Features

1. **Notion API Integration (2025-09-03)**
   - Full support for the latest Notion API version
   - Data source object support for multi-source databases
   - Backward compatibility with older database structures

2. **Authentication & Security**
   - Secure integration token handling
   - Connection testing functionality
   - Proper error handling and validation

3. **Content Conversion**
   - Comprehensive block-to-Markdown conversion
   - Support for all major Notion block types
   - Obsidian-flavored Markdown output
   - Rich text formatting preservation

4. **Database to Base Conversion**
   - Automatic conversion of Notion databases to Obsidian Bases
   - Property type mapping and conversion
   - YAML frontmatter generation
   - View creation (basic implementation)

5. **File Handling**
   - Progressive file downloading
   - Image and attachment embedding
   - Proper file naming and organization
   - Support for various media types

6. **User Interface**
   - Clean settings interface
   - Progress tracking and reporting
   - Error reporting and status updates
   - Integration with existing importer framework

## Architecture

### Core Components

1. **NotionAPIImporter** (`src/formats/notion-api.ts`)
   - Main importer class extending FormatImporter
   - Handles UI, settings, and orchestrates the import process

2. **NotionAPIClient** (`src/formats/notion-api/client.ts`)
   - Handles all Notion API communication
   - Supports both new data source endpoints and fallback compatibility
   - Manages authentication and rate limiting

3. **NotionBlockConverter** (`src/formats/notion-api/block-converter.ts`)
   - Converts Notion blocks to Obsidian Markdown
   - Handles all supported block types
   - Manages file downloads and embedding

4. **NotionDatabaseConverter** (`src/formats/notion-api/database-converter.ts`)
   - Converts Notion databases to Obsidian Bases
   - Handles property mapping and frontmatter generation
   - Creates base configuration files

### Supported Block Types

- **Text Blocks**: Paragraph, Headings (H1-H3)
- **Lists**: Bulleted, Numbered, To-do (checkboxes)
- **Rich Content**: Quote, Code, Equation, Callout
- **Media**: Image, File, Video, Audio
- **Interactive**: Toggle, Bookmark, Embed, Link preview
- **Structure**: Table, Table row, Divider, Column layouts
- **Advanced**: Synced blocks, Table of contents, Breadcrumb

### Supported Property Types

- **Basic**: Title, Rich text, Number
- **Selection**: Select, Multi-select
- **Data**: Date, Checkbox, URL, Email, Phone number
- **Media**: Files & attachments
- **Relations**: People, Relation, Rollup
- **Computed**: Formula, Created/Modified time and user

## API Version 2025-09-03 Support

The implementation fully supports the new Notion API version with:

- **Data Source Objects**: Proper handling of multi-source databases
- **Backward Compatibility**: Fallback to database endpoints when data source endpoints fail
- **New Endpoints**: Uses `/data_sources/{id}/query` with fallback to `/databases/{id}/query`

## Database to Base Conversion

### Conversion Process

1. **Schema Analysis**: Extract database properties and types
2. **Property Mapping**: Convert Notion properties to Obsidian Base properties
3. **Content Conversion**: Convert each database page to Markdown with frontmatter
4. **Base Configuration**: Generate `base.json` with schema and metadata
5. **View Creation**: Create basic views for the Base

### Property Mapping

| Notion Property | Obsidian Base Property | Notes |
|----------------|----------------------|-------|
| Title | text | Primary identifier |
| Rich Text | text | Formatted text content |
| Number | number | Numeric values |
| Select | select | Single choice with options |
| Multi-select | multi_select | Multiple choices |
| Date | date | Date/datetime values |
| Checkbox | checkbox | Boolean values |
| URL | url | Web links |
| Email | email | Email addresses |
| Phone | phone | Phone numbers |
| Files | file | File attachments |
| People | text | User references (as text) |
| Formula | text | Computed values (as text) |
| Relation | relation | Database relations |
| Rollup | text | Aggregated values (as text) |

## Error Handling

The implementation includes comprehensive error handling:

- **API Errors**: Proper error messages for authentication and API failures
- **Rate Limiting**: Automatic handling of Notion's rate limits
- **File Downloads**: Graceful fallback for failed file downloads
- **Data Validation**: Input validation and sanitization
- **Progress Tracking**: Detailed progress reporting with error counts

## Testing

### Test Structure

- **Test Documentation**: Comprehensive testing guide and setup instructions
- **Integration Testing**: Full workflow testing with real Notion workspaces
- **Test Content Guidelines**: Requirements for test content covering all block and property types

### Test Requirements

1. Notion workspace with diverse content
2. Integration token with appropriate permissions
3. Test pages with all supported block types
4. Test databases with all supported property types

## Performance Considerations

- **Rate Limiting**: Respects Notion's 3 requests/second limit
- **Pagination**: Handles large datasets with proper pagination
- **Memory Management**: Efficient handling of large files and datasets
- **Progress Tracking**: Real-time progress updates for user feedback

## Security

- **Token Handling**: Secure storage and transmission of integration tokens
- **Input Validation**: Proper sanitization of all user inputs
- **File Safety**: Safe file naming and path handling
- **Error Disclosure**: Careful error message handling to avoid information leakage

## Future Enhancements

Potential areas for future development:

1. **Advanced Views**: Support for Notion's complex view configurations
2. **Real-time Sync**: Incremental updates and synchronization
3. **Selective Import**: User-defined filters and selection criteria
4. **Advanced Formatting**: Enhanced support for complex Notion features
5. **Batch Operations**: Optimized handling of large workspaces

## Dependencies

The implementation uses minimal dependencies:
- Native Fetch API for HTTP requests
- Obsidian API for vault operations
- TypeScript for type safety
- No external libraries for core functionality

## Compliance

This implementation meets all requirements from GitHub issue #421:

- Uses Notion API with integration token
- Supports API version 2025-09-03 with data source objects
- Converts to Obsidian-flavored Markdown
- Handles images and attachments with proper embedding
- Supports Database to Base conversion
- Implements progressive downloading
- Includes test documentation
- Follows Obsidian plugin guidelines
- Maintains performance standards
- Provides proper error handling

## Installation and Usage

1. Build the plugin: `npm run build`
2. Load in Obsidian development environment
3. Open Importer plugin
4. Select "Notion (via API)"
5. Enter integration token
6. Configure import settings
7. Run import process

The implementation is ready for testing and meets all bounty requirements.