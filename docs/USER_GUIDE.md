# Obsidian Importer - User Guide

Welcome to the comprehensive user guide for the Obsidian Importer plugin! This guide will walk you through everything you need to know to successfully import your content into Obsidian.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Installation](#installation)
3. [Notion API Import Setup](#notion-api-import-setup)
4. [Step-by-Step Usage Guide](#step-by-step-usage-guide)
5. [Database-to-Bases Conversion](#database-to-bases-conversion)
6. [Other Import Formats](#other-import-formats)
7. [Troubleshooting](#troubleshooting)
8. [FAQ](#faq)
9. [Advanced Features](#advanced-features)

## Getting Started

The Obsidian Importer plugin allows you to import notes and content from various sources directly into your Obsidian vault. The plugin supports multiple formats including:

- **Notion API (Live Import)** - Direct integration with Notion's API
- **Notion (Export)** - Import from Notion export files
- Apple Notes
- Evernote
- Microsoft OneNote
- Google Keep
- Bear
- Roam Research
- HTML files
- Markdown files

## Installation

### Method 1: Community Plugins (Recommended)

1. Open Obsidian
2. Go to **Settings** → **Community Plugins**
3. Make sure **Safe mode** is turned OFF
4. Click **Browse** community plugins
5. Search for "Importer"
6. Click **Install** on the Obsidian Importer plugin
7. Once installed, click **Enable**

### Method 2: Manual Installation

1. Download the latest release from the [GitHub repository](https://github.com/obsidianmd/obsidian-importer)
2. Extract the files to your vault's `.obsidian/plugins/obsidian-importer/` folder
3. Reload Obsidian or restart the application
4. Enable the plugin in Settings → Community Plugins

## Notion API Import Setup

The Notion API importer is our newest and most powerful feature, allowing you to import content directly from Notion without needing to export files first.

### Step 1: Create a Notion Integration

1. Go to [Notion Developers](https://developers.notion.com/my-integrations)
2. Click **"+ New integration"**
3. Give your integration a name (e.g., "Obsidian Importer")
4. Select the workspace you want to import from
5. Click **Submit**
6. Copy the **Integration Token** (starts with `secret_`) - you'll need this later

### Step 2: Share Pages with Your Integration

**Important**: Your integration can only access pages that are explicitly shared with it.

1. Open the Notion page or database you want to import
2. Click **Share** in the top-right corner
3. Click **Invite**
4. Search for your integration name and select it
5. Choose appropriate permissions (usually **Read** is sufficient)
6. Click **Invite**

**Pro Tip**: To import your entire workspace, share your top-level pages with the integration. Child pages will be accessible automatically.

### Step 3: Get Your Integration Token

Your integration token is required for the import process. Keep it secure and never share it publicly.

## Step-by-Step Usage Guide

### Starting an Import

1. Open Obsidian
2. Open the **Command Palette** (Ctrl/Cmd + P)
3. Type "Import" and select **"Importer: Open"**
4. Choose your import format from the dropdown

### Notion API Import Process

1. **Select Format**: Choose "Notion API (Live Import)" from the dropdown
2. **Enter Token**: Paste your Notion integration token
3. **Configure Options**:
   - **Output folder**: Choose where to save imported files
   - **Include images**: Whether to download and import images
   - **Include metadata**: Whether to include Notion properties as YAML frontmatter
   - **Convert databases to Bases**: Enable to create Obsidian Base files from Notion databases
4. **Start Import**: Click **Import** to begin the process

### Import Progress

The importer will show real-time progress including:
- Number of pages processed
- Current page being imported
- Any errors encountered
- Estimated time remaining

### What Gets Imported

- **Pages**: All shared pages and their content
- **Databases**: Converted to Obsidian Base files (if enabled)
- **Blocks**: All supported Notion block types
- **Properties**: Notion properties as YAML frontmatter
- **Images**: Downloaded and linked (if enabled)
- **Files**: Attached files and media

## Database-to-Bases Conversion

One of the most powerful features of the Notion API importer is its ability to convert Notion databases into Obsidian Base files.

### What are Obsidian Bases?

Obsidian Bases are a way to define structured data schemas in Obsidian, similar to how databases work in Notion. They allow you to:
- Define property types and constraints
- Create templates for consistent note structure
- Use database-like queries and views

### How the Conversion Works

1. **Schema Analysis**: The importer analyzes your Notion database schema
2. **Property Mapping**: Maps Notion property types to equivalent Obsidian property types
3. **Base File Creation**: Creates a `.obsidian-base` file defining the schema
4. **Page Import**: Imports database entries as individual notes with proper frontmatter

### Supported Property Types

| Notion Property | Obsidian Equivalent | Notes |
|----------------|-------------------|-------|
| Title | Text | Primary identifier |
| Rich Text | Text | Formatted text content |
| Number | Number | Numeric values |
| Select | Enum | Single choice from predefined options |
| Multi-select | List | Multiple choices |
| Date | Date | Date/datetime values |
| Checkbox | Boolean | True/false values |
| URL | Text | Web links |
| Email | Text | Email addresses |
| Phone | Text | Phone numbers |
| Formula | Text | Computed values |
| Relation | Reference | Links to other database entries |
| Rollup | Text | Aggregated values |
| People | Text | User references |
| Files | File | File attachments |
| Created time | Date | Automatic creation timestamp |
| Created by | Text | Creator information |
| Last edited time | Date | Last modification timestamp |
| Last edited by | Text | Last editor information |

### Example: Project Database Conversion

**Notion Database**: "Projects"
- Title: Project Name
- Status: Select (Not Started, In Progress, Complete)
- Due Date: Date
- Assignee: Person
- Priority: Number

**Converted Obsidian Base**: `Projects.obsidian-base`
```yaml
schema:
  properties:
    title:
      type: text
      required: true
    status:
      type: enum
      options: ["Not Started", "In Progress", "Complete"]
    due_date:
      type: date
    assignee:
      type: text
    priority:
      type: number
```

## Other Import Formats

### Notion (Export)
For users who prefer to work with exported files:
1. Export your content from Notion as a ZIP file
2. Select "Notion" format in the importer
3. Choose your exported ZIP file
4. Configure import options
5. Start the import

### Evernote
1. Export your notebooks from Evernote as ENEX files
2. Select "Evernote" format
3. Choose your ENEX file(s)
4. Configure import settings
5. Begin import

### Other Formats
Similar processes apply to other supported formats. Each format has specific export/preparation requirements detailed in the official [Obsidian Help documentation](https://help.obsidian.md/import).

## Troubleshooting

### Common Issues and Solutions

#### "Authentication failed" Error
- **Cause**: Invalid or expired integration token
- **Solution**:
  1. Verify your token is correct (starts with `secret_`)
  2. Check that your integration hasn't been revoked
  3. Ensure you're using the right token for the workspace

#### "No pages found" Error
- **Cause**: Integration doesn't have access to any pages
- **Solution**:
  1. Share at least one page with your integration
  2. Make sure you've invited the integration with proper permissions
  3. Check that the pages you want to import are in the shared workspace

#### "Rate limit exceeded" Error
- **Cause**: Too many requests to Notion API
- **Solution**: The importer automatically handles rate limiting, but if you see this error:
  1. Wait a few minutes before retrying
  2. Avoid running multiple imports simultaneously
  3. Consider importing smaller sections at a time

#### Import Stops or Hangs
- **Cause**: Network issues, large files, or API timeouts
- **Solution**:
  1. Check your internet connection
  2. Try importing smaller sections
  3. Restart Obsidian and try again
  4. Check Obsidian's developer console for error details

#### Images Not Importing
- **Cause**: Image download issues or permission problems
- **Solution**:
  1. Ensure "Include images" is enabled
  2. Check your internet connection
  3. Verify images are accessible in Notion
  4. Try disabling image import if causing issues

#### Database Conversion Issues
- **Cause**: Complex database schemas or unsupported property types
- **Solution**:
  1. Check which property types are supported
  2. Simplify complex formulas or relations
  3. Consider manual conversion for complex cases

### Getting Help

If you encounter issues not covered here:

1. **Check the Console**: Open Obsidian's developer console (Ctrl/Cmd + Shift + I) for detailed error messages
2. **Community Forum**: Visit the [Obsidian Community Forum](https://forum.obsidian.md)
3. **GitHub Issues**: Report bugs on the [GitHub repository](https://github.com/obsidianmd/obsidian-importer/issues)
4. **Discord**: Join the Obsidian Discord for real-time help

## FAQ

### General Questions

**Q: Can I import my entire Notion workspace at once?**
A: Yes! Share your top-level pages with the integration, and all child pages will be imported automatically.

**Q: Will the import preserve my Notion formatting?**
A: Yes, the importer converts Notion formatting to equivalent Markdown syntax. Complex formatting may be simplified.

**Q: Can I run multiple imports simultaneously?**
A: No, it's recommended to run one import at a time to avoid rate limiting and conflicts.

**Q: What happens to my Notion links and references?**
A: Internal links are converted to Obsidian-style links. External links are preserved as-is.

### Technical Questions

**Q: Is my Notion data secure during import?**
A: Yes, the import happens directly between your device and Notion's API. Your integration token is stored locally and never shared.

**Q: Can I customize how content is imported?**
A: The importer provides several configuration options. For advanced customization, you can modify the source code.

**Q: Does the importer work on mobile?**
A: Yes, the Notion API importer is designed to work on both desktop and mobile versions of Obsidian.

**Q: How often can I import from Notion?**
A: You can import as often as needed, but each import fetches the current state of your Notion content. Consider using this for periodic syncing.

### Database and Bases Questions

**Q: What's the difference between importing as notes vs. Bases?**
A: Notes create individual Markdown files for each database entry. Bases create a structured schema that maintains the database-like properties and relationships.

**Q: Can I convert existing notes to use a Base schema?**
A: Yes, after importing with Base conversion, you can apply the schema to existing notes or create new notes that follow the structure.

**Q: Do Notion formulas work in Obsidian Bases?**
A: Notion formulas are imported as their calculated values. Obsidian Bases don't support dynamic formulas yet.

## Advanced Features

### Batch Processing
For large workspaces, the importer processes content in batches to manage memory usage and API rate limits effectively.

### Resume Capability
If an import is interrupted, you can often resume from where it left off by running the import again. The importer will skip already-imported content.

### Custom Output Organization
Use the output folder setting to organize imported content:
- Create separate folders for different Notion workspaces
- Use date-based folder names for periodic imports
- Organize by content type (pages, databases, etc.)

### Integration with Other Plugins
The imported content works seamlessly with other Obsidian plugins:
- **Dataview**: Query imported database content
- **Templater**: Create templates based on imported structures
- **Graph View**: Visualize connections between imported pages
- **Search**: Full-text search across all imported content

### Performance Optimization
For optimal performance:
- Import during off-peak hours when your internet connection is stable
- Consider importing in smaller chunks for very large workspaces
- Close unnecessary applications during large imports
- Ensure sufficient disk space for downloaded images and files

## Conclusion

The Obsidian Importer plugin provides a powerful and flexible way to bring your content into Obsidian. Whether you're migrating from Notion, Evernote, or another platform, the importer helps preserve your content structure and formatting while adapting it to Obsidian's powerful features.

For the latest updates and features, check the [GitHub repository](https://github.com/obsidianmd/obsidian-importer) and the [official Obsidian Help documentation](https://help.obsidian.md/import).

Happy importing!