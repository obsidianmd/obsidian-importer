# Notion API Importer

This is a custom extension to the official Obsidian Importer plugin that adds support for importing Notion databases directly via the Notion API, without requiring file exports.

## Features

- **Live API Import**: Import directly from Notion using API tokens
- **Database Selection**: Browse and select from your available Notion databases
- **Individual Notes**: Creates separate markdown files for each database row
- **Obsidian Base Files**: Optional .base file generation for native Obsidian database views
- **Rich Property Support**: Handles all Notion property types (text, select, date, etc.)
- **Progress Tracking**: Real-time progress reporting during import

## Setup

### 1. Create a Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name (e.g., "Obsidian Importer")
4. Select your workspace
5. Click "Submit"
6. Copy the "Internal Integration Token" (starts with `secret_`)

### 2. Share Databases with Integration

For each database you want to import:
1. Open the database in Notion
2. Click the "..." menu in the top right
3. Select "Add connections"
4. Find and select your integration
5. Click "Confirm"

### 3. Use the Importer

1. Open Obsidian
2. Open Command Palette (Ctrl/Cmd + P)
3. Run "Importer: Open importer"
4. Select "Notion (Live API)" from the format dropdown
5. Enter your Integration Token
6. Select a database from the dropdown
7. Choose output location
8. Enable/disable .base file creation
9. Click "Import"

## Output Format

### Individual Markdown Files

Each database row becomes a markdown file with:

```markdown
---
notion_id: 12345678-1234-1234-1234-123456789abc
created: 2025-01-15T10:30:00.000Z
updated: 2025-01-15T15:45:00.000Z
Status: In Progress
Priority: High
Tags: Research, Important
---

# Page Title

Content goes here...
```

### Obsidian Base Files (.base)

When enabled, creates a `.base` file for native Obsidian database views:

```yaml
# Obsidian Base file for My Database
# Generated from Notion API

properties:
  Status:
    displayName: "Status"
  Priority:
    displayName: "Priority"
  Tags:
    displayName: "Tags"

views:
  - type: table
    name: "My Database Table"
    limit: 100
    filters:
      file.ext == "md"
    order:
      - file.name
      - Status
      - Priority
      - Tags
```

## Supported Property Types

- **Rich Text**: Plain text content
- **Number**: Numeric values
- **Select**: Single selection values
- **Multi-select**: Comma-separated multiple selections
- **Date**: ISO date strings
- **Checkbox**: Boolean values
- **URL**: Web links
- **Email**: Email addresses
- **Phone**: Phone numbers
- **People**: User names/IDs
- **Files**: File names and URLs
- **Relation**: Related page IDs
- **Formula**: Computed values
- **Rollup**: Aggregated values

## Requirements

- Obsidian with Importer plugin installed
- Desktop environment (not mobile)
- Network access to Notion API
- Notion Integration Token with database access
- For .base files: Obsidian 1.7+ with Bases feature enabled

## Troubleshooting

### "Failed to load databases"
- Check your Integration Token is correct
- Ensure the integration has access to your workspace
- Verify network connectivity

### "No databases found"
- Make sure you've shared at least one database with your integration
- Check that the integration has the correct permissions

### "Import failed"
- Verify the selected database still exists and is accessible
- Check that the integration hasn't been revoked
- Ensure sufficient disk space for the import

### ".base files not working"
- Requires Obsidian 1.7+ with Bases feature enabled
- Check that the .base file has proper YAML syntax
- Verify the markdown files have frontmatter at the beginning

## Comparison with File-Based Import

| Feature | API Import | File Export Import |
|---------|------------|-------------------|
| Setup | Integration token | Export → Download → Import |
| Real-time | ✅ Always current | ❌ Snapshot in time |
| Large databases | ✅ Handles pagination | ❌ May hit export limits |
| Attachments | ❌ Links only | ✅ Full file import |
| Nested pages | ❌ Database rows only | ✅ Full page hierarchy |
| Block content | ❌ Properties only | ✅ Full rich content |

## Contributing

This importer is part of the notiontoobsidian project. To contribute:

1. Fork the repository
2. Make changes to `obsidian-importer/src/formats/notion-api.ts`
3. Test with `npx tsc --noEmit`
4. Submit a pull request

## License

Same as the parent Obsidian Importer plugin (MIT License).
