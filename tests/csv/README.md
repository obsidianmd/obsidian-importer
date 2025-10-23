# CSV Import Test Files

This directory contains test CSV files for the CSV importer feature.

## Test Files

### sample.csv
A simple CSV file with basic data types including:
- Text fields
- Dates
- Boolean values
- Numeric values
- Multi-line content

### comprehensive-test.csv
A more comprehensive test file that includes edge cases:
- Unicode characters (你好世界, emoji 🌟, café)
- Escaped quotes within quoted fields
- Multi-line content within fields
- Empty fields
- Special characters
- Various data types (strings, numbers, booleans, dates)

## Using the CSV Importer

1. Open Obsidian Importer
2. Select "CSV (.csv)" from the format dropdown
3. Choose a CSV file to import
4. Configure the import settings:
   - **Note title**: Template for the note filename (e.g., `{{Title}}`)
   - **Note location**: Template for organizing notes in folders (e.g., `{{Category}}/{{Subcategory}}`)
   - **Note body**: Template for the note content (e.g., `{{Content}}`)
   - **Frontmatter Properties**: Toggle which columns to include as YAML frontmatter (all selected by default)

### Template Syntax

Use double curly braces to reference CSV columns:
- `{{Column_Name}}` - Inserts the value from that column
- You can combine multiple columns: `{{Category}} - {{Title}}`
- You can use columns in paths: `{{Category}}/{{Subcategory}}`

### Examples

**Title Template:**
```
{{Title}}
```

**Location Template:**
```
{{Category}}/{{Subcategory}}
```

**Body Template:**
```
{{Content}}

## Additional Information

Author: {{Author}}
Date: {{Date}}

### Notes
{{Notes}}
```

**Frontmatter:**
Select which columns should be included as YAML properties (all columns are selected by default). The importer will:
- Convert numbers to numeric values
- Convert "true"/"false" to boolean values
- Preserve dates in ISO format
- Quote strings with special characters

## Expected Output

For a row with:
- Title: "Meeting Notes"
- Category: "Work"
- Author: "John Doe"
- Date: "2024-01-15"
- Priority: "High"
- Completed: "true"

The output would be:
```markdown
---
category: Work
author: John Doe
date: 2024-01-15
priority: High
completed: true
---

Meeting content here...
```

