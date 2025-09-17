# Notion API Importer Tests

This directory contains test cases for the Notion API importer.

## Test Setup

To test the Notion API importer, you'll need:

1. A Notion workspace with test content
2. A Notion integration token with appropriate permissions
3. Test pages and databases in your workspace

## Creating a Test Integration

1. Go to https://www.notion.so/my-integrations
2. Click "New integration"
3. Give it a name like "Obsidian Importer Test"
4. Select your workspace
5. Copy the integration token (starts with `secret_`)

## Required Permissions

Your integration needs the following capabilities:
- Read content
- Read user information without email addresses

## Test Content Structure

For comprehensive testing, create the following in your Notion workspace:

### Pages
- Simple text page with headings, paragraphs, lists
- Page with images and attachments
- Page with tables
- Page with code blocks and equations
- Page with callouts and toggles
- Page with to-do lists (checkboxes)

### Databases
- Simple database with various property types:
  - Title (text)
  - Number
  - Select
  - Multi-select
  - Date
  - Checkbox
  - URL
  - Email
  - Files & media
- Database with multiple data sources (if available in your workspace)

### Property Types to Test
- [x] Title/Rich text
- [x] Number
- [x] Select
- [x] Multi-select
- [x] Date
- [x] Checkbox
- [x] URL
- [x] Email
- [x] Phone number
- [x] Files & media
- [x] People
- [x] Formula
- [x] Relation
- [x] Rollup
- [x] Created time
- [x] Created by
- [x] Last edited time
- [x] Last edited by

### Block Types to Test
- [x] Paragraph
- [x] Headings (H1, H2, H3)
- [x] Bulleted list
- [x] Numbered list
- [x] To-do list
- [x] Toggle
- [x] Quote
- [x] Code block
- [x] Equation
- [x] Divider
- [x] Table
- [x] Image
- [x] File
- [x] Video
- [x] Audio
- [x] Bookmark
- [x] Embed
- [x] Callout
- [x] Synced block
- [x] Column layout

## Running Tests

1. Build the plugin: `npm run build`
2. Load the plugin in Obsidian
3. Open the Importer
4. Select "Notion (via API)"
5. Enter your integration token
6. Test the connection
7. Run the import

## Expected Results

The importer should:
- Successfully authenticate with your integration token
- Fetch all accessible pages and databases
- Convert Notion blocks to proper Obsidian Markdown
- Download and embed images/attachments
- Create Obsidian Base files for databases
- Preserve formatting and structure
- Handle errors gracefully

## Known Limitations

- Notion's API has rate limits (3 requests per second)
- Some advanced Notion features may not have direct Obsidian equivalents
- File downloads depend on Notion's temporary URLs
- Database views are simplified in the conversion process