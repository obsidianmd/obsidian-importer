# Notion API Importer

This is a new importer for Obsidian that allows you to import data directly from Notion using the Notion API, including support for the new data sources feature (2025-09-03 API version).

## Features

- **Direct API Integration**: Import directly from Notion without needing to export files
- **Database to Base Conversion**: Convert Notion databases to Obsidian Bases
- **Data Sources Support**: Handle the new Notion data sources feature
- **File Downloads**: Automatically download and convert Notion attachments
- **Rich Content**: Preserve formatting, tables, code blocks, and more

## Setup

### 1. Create a Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name (e.g., "Obsidian Importer")
4. Select the workspace you want to import from
5. Copy the "Internal Integration Token" (starts with `secret_`)

### 2. Grant Database Access

1. Go to each database you want to import
2. Click the "..." menu in the top right
3. Select "Add connections"
4. Find and select your integration
5. Click "Confirm"

## Usage

### In Obsidian

1. Open the Importer plugin
2. Select "Notion (API)" from the format dropdown
3. Enter your Notion integration token
4. Click "Load Databases" to see available databases
5. Select the databases you want to import
6. Choose your output folder and attachment folder
7. Click "Import"

### Testing the Integration

You can test the API integration directly:

```bash
# Set your Notion token
export NOTION_TOKEN="secret_your_token_here"

# Run the test script
node scripts/test-notion-api.mjs
```

## Technical Details

### API Version
- Uses Notion API version `2025-09-03`
- Supports the new `data_sources` feature
- Handles both single-source and multi-source databases

### File Structure
```
src/formats/notion-api/
├── notion-api.ts           # Main importer class
├── notion-client.ts        # Notion API client wrapper
├── notion-to-md.ts        # Markdown conversion
└── base-generator.ts       # Obsidian Base generation
```

### Supported Content Types

- **Text**: Paragraphs, headings, lists, quotes
- **Rich Text**: Bold, italic, strikethrough, code, links
- **Media**: Images, files, videos (downloaded locally)
- **Interactive**: Checkboxes, toggles, callouts
- **Code**: Code blocks with syntax highlighting
- **Tables**: Basic table support
- **Databases**: Converted to Obsidian Bases

### Property Mapping

| Notion Type | Obsidian Type | Notes |
|-------------|---------------|-------|
| title | text | Page titles |
| rich_text | text | Rich text content |
| number | number | Numeric values |
| select | select | Single selection |
| multi_select | multi_select | Multiple selections |
| date | date | Date/time values |
| checkbox | checkbox | Boolean values |
| url | url | Web links |
| files | text | File references |
| people | text | User mentions |
| formula | text | Calculated values |
| relation | text | Related pages |
| rollup | text | Aggregated data |

## Limitations

- **Complex Formulas**: Notion formulas are converted to text
- **Relations**: Relations are converted to text references
- **Advanced Views**: Only basic table views are supported in Bases
- **Rate Limits**: Respects Notion API rate limits
- **File Expiry**: Notion temporary URLs may expire

## Development

### Building
```bash
npm install
npm run build
```

### Testing
```bash
# Set your Notion token
export NOTION_TOKEN="secret_your_token_here"

# Test the API integration
node scripts/test-notion-api.mjs
```

### Adding New Features

1. **New Block Types**: Add cases to `convertBlock()` in `notion-to-md.ts`
2. **Property Types**: Add mappings in `mapNotionTypeToObsidian()` in `base-generator.ts`
3. **API Features**: Extend `NotionApiClient` class in `notion-client.ts`

## Troubleshooting

### Common Issues

1. **"Failed to fetch databases"**
   - Check your integration token
   - Ensure the integration has access to databases
   - Verify the integration is not expired

2. **"No databases found"**
   - Make sure you've granted database access to your integration
   - Check that the databases are not archived

3. **"Failed to download attachments"**
   - Check your internet connection
   - Verify the attachment URLs are still valid
   - Some Notion URLs may have expired

4. **"Data source not found"**
   - This is normal for older databases
   - The importer will fall back to direct database queries

### Debug Mode

Set `DEBUG=true` to see detailed logging:

```bash
DEBUG=true node scripts/test-notion-api.mjs
```

## Contributing

This importer is part of the Obsidian Importer plugin. To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This code is part of the Obsidian Importer plugin and follows the same license terms.
