# Notion API Integration for Obsidian Importer

This document describes the integration of the Notion API importer into the official obsidian-importer plugin.

## Overview

The Notion API importer provides live integration with Notion's API, allowing users to import their Notion content directly without needing to export it first. This is different from the existing Notion importer which works with exported ZIP files.

## Features

- **Live API Integration**: Import directly from Notion using an integration token
- **Database-to-Bases Conversion**: Converts Notion databases to Obsidian Base files
- **Mobile Compatibility**: Works on both desktop and mobile platforms
- **Rate Limiting**: Respects Notion API rate limits (3 requests/second)
- **Comprehensive Block Support**: Handles 15+ Notion block types
- **Property Type Mapping**: Supports all 21 Notion property types
- **Progressive Download**: Handles large workspaces with resume capability

## Files Structure

### Core Integration
- `src/formats/notion-api.ts` - Main importer class extending FormatImporter
- Registration in `src/main.ts` - Added to importers registry as 'notion-api'

### Dependencies
- `@notionhq/client`: Official Notion JavaScript SDK

### Documentation
- `docs/development/` - Contains original development documentation and requirements
- `docs/development/lib-reference/` - Reference implementations of utility functions
- `tests/notion-api-tests/` - Test files for the Notion API functionality

## Usage

1. User selects "Notion API (Live Import)" from the importer dropdown
2. Enters their Notion integration token
3. Configures import options (images, metadata, output folder)
4. Runs the import to fetch content directly from Notion

## Integration Details

### Importer Registration
The importer is registered in `src/main.ts` as:

```typescript
'notion-api': {
    name: 'Notion API',
    optionText: 'Notion API (Live Import)',
    importer: NotionApiImporter,
    helpPermalink: 'import/notion-api',
    formatDescription: 'Import directly from Notion using API integration token.',
}
```

### Key Differences from Standard Notion Importer
- No file input required - connects directly to API
- Real-time content fetching with rate limiting
- Database schema analysis and Base file generation
- Mobile-safe implementation without Node.js dependencies

### Error Handling
- `NotionAPIError`: API-specific errors
- `ValidationError`: Input validation errors
- `NotionImporterError`: General importer errors

## Development History

The original development files are preserved in `docs/development/` for reference:
- PRD.md - Product Requirements Document
- PROJECT-PLAN_and_TASKS-TRACKER.md - Development planning
- REQUIREMENTS-of-SOLUTION.md - Technical requirements
- RESEARCH_HISTORY_DETAILS.md - Research findings

## Future Enhancements

- Enhanced property type mapping
- Incremental sync capabilities
- Advanced filtering options
- Custom Base template support