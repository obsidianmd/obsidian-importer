# Notion API Importer - Testing Guide

## Table of Contents

1. [Manual Testing Setup](#manual-testing-setup)
2. [Creating Test Data](#creating-test-data)
3. [Running the Converter](#running-the-converter)
4. [Automated E2E Testing](#automated-e2e-testing)

---

## 1. Manual Testing Setup

### Prerequisites

- Obsidian app installed
- Obsidian Importer plugin built and loaded
- A Notion account

### Step 1: Create a Notion Integration

1. Go to https://www.notion.so/my-integrations
2. Click **"+ New integration"**
3. Give it a name: `Obsidian Importer Test`
4. Select the workspace you want to test with
5. Leave capabilities as default (Read content, Update content, Insert content)
6. Click **"Submit"**
7. Copy the **Integration Token** (starts with `secret_`)
   - ⚠️ **Save this token securely** - you'll need it for the importer

### Step 2: Share Databases with the Integration

**Important:** Notion integrations can only access pages and databases that are explicitly shared with them.

For each database you want to import:

1. Open the database in Notion
2. Click the `•••` menu in the top-right corner
3. Scroll to **"Connections"** or **"Add connections"**
4. Find and select your integration (`Obsidian Importer Test`)
5. The database is now accessible to the integration

### Step 3: Configure the Importer in Obsidian

1. Open Obsidian
2. Open Command Palette (`Cmd/Ctrl + P`)
3. Search for **"Obsidian Importer: Open Importer"**
4. Select **"Notion (API)"** from the format dropdown
5. **Enter your Integration Token** in the token field
6. **Select an output folder** in your vault
7. Click **"Import"**

The importer will:

- Search your workspace for all accessible databases
- Convert each database to a `.base` file
- Convert all pages in each database to `.md` files with proper frontmatter
- Download and embed all attachments

---

## 2. Creating Test Data

To thoroughly test the converter, create a comprehensive test database in Notion with the following elements:

### Database Setup: "Importer Test Database"

#### Property Types to Include:

Create properties of each type to test conversion:

1. **Title** - `Name` (every database has this by default)
2. **Text** - `Description`
3. **Number** - `Price`, `Quantity`
4. **Select** - `Status` with options: `To Do`, `In Progress`, `Done`
5. **Multi-select** - `Tags` with options: `Important`, `Urgent`, `Follow-up`
6. **Date** - `Due Date`, `Created Date`
7. **Checkbox** - `Is Complete`
8. **URL** - `Website`
9. **Email** - `Contact Email`
10. **Phone** - `Phone Number`
11. **Files** - `Attachments`
12. **Formula** - `Total` with expression: `prop("Price") * prop("Quantity")`
13. **Relation** - Link to another database
14. **Rollup** - Aggregate from related database
15. **People** - `Assigned To`
16. **Created time** - (auto-generated)
17. **Last edited time** - (auto-generated)

#### Test Pages to Create:

**Page 1: "Rich Text Kitchen Sink"**

- Test all text formatting:
  - **Bold text**
  - _Italic text_
  - ~~Strikethrough~~
  - `Inline code`
  - [Links](https://example.com)
  - Nested formatting: **_bold and italic_**
- All heading levels (H1, H2, H3)
- Multiple paragraph blocks
- Equation: $E = mc^2$

**Page 2: "Lists and Tasks"**

- Bulleted lists with 3 levels of nesting
- Numbered lists with sub-items
- To-do lists:
  - [ ] Unchecked task
  - [x] Checked task
  - [ ] Task with nested content
    - More details here
- Toggle blocks with hidden content

**Page 3: "Code and Quotes"**

- Code blocks in multiple languages:
  ```python
  def hello():
      print("Hello, World!")
  ```
  ```javascript
  const greet = () => console.log("Hello!");
  ```
- Block quotes with multiple paragraphs
- Callouts with emojis

**Page 4: "Tables and Dividers"**

- Simple table with headers:
  | Name | Age | City |
  |------|-----|------|
  | John | 30 | NYC |
  | Jane | 25 | LA |
- Table without headers
- Tables with empty cells
- Horizontal dividers (---) between sections

**Page 5: "Media and Attachments"**

- External images with captions
- Uploaded images
- PDF attachment
- Video file
- Multiple file attachments
- Bookmarks to external websites

**Page 6: "Complex Formulas"**
Create a page in the database with complex formula values:

- Simple arithmetic: `prop("Price") * prop("Quantity")`
- Conditionals: `if(prop("Price") > 100, "Expensive", "Cheap")`
- Nested conditions: `if(prop("Status") == "Done", "✓", if(prop("Status") == "In Progress", "⚠", "○"))`
- String operations: `concat(prop("Name"), " - ", prop("Status"))`
- Date operations: `formatDate(prop("Due Date"), "YYYY-MM-DD")`
- Math functions: `round(prop("Price") * 1.08)`

**Page 7: "Edge Cases"**

- Empty content blocks
- Very long text (3000+ words)
- Special characters in title: `Test / Page \ With * Special ? Characters`
- Emoji in content: 🚀 🎉 ✨
- Multiple images in sequence
- Nested lists 5 levels deep
- Tables inside toggle blocks

**Page 8: "Child Pages and Databases"**

- Reference to child page
- Reference to another database
- Multiple internal links

### Additional Test Databases

**Database 2: "Formula Edge Cases"**
Test all formula types from Notion's documentation:

- `add()`, `subtract()`, `multiply()`, `divide()`
- `pow()`, `sqrt()`, `abs()`, `round()`, `ceil()`, `floor()`
- `min()`, `max()`, `sum()`
- `length()`, `concat()`, `upper()`, `lower()`
- `contains()`, `replace()`, `split()`
- `now()`, `today()`, `dateAdd()`, `dateSubtract()`, `dateBetween()`
- `if()`, `and()`, `or()`, `not()`
- `at()`, `first()`, `last()`

**Database 3: "Nested Structure Test"**

- Pages with deeply nested content (10+ levels)
- Toggle blocks containing everything
- Lists with mixed bulleted/numbered/todo items

---

## 3. Running the Converter

### Method 1: Through Obsidian UI (Recommended for Manual Testing)

1. Build the plugin:

   ```bash
   cd /path/to/obsidian-importer
   npm run build
   ```

2. Load the plugin in Obsidian:

   - Copy `main.js`, `manifest.json`, `styles.css` to your vault's `.obsidian/plugins/obsidian-importer/`
   - Reload Obsidian
   - Enable the plugin in Settings → Community Plugins

3. Run the importer:

   - `Cmd/Ctrl + P` → "Obsidian Importer: Open Importer"
   - Select "Notion (API)"
   - Enter token and select output folder
   - Click "Import"

4. Monitor progress:
   - Watch the status bar for progress
   - Check the output folder for created files
   - Review the console (Cmd/Ctrl + Shift + I) for errors/warnings

### Method 2: Programmatic Testing (for Development)

Create a test script: `test-notion-api.ts`

```typescript
import { NotionApiClient } from "./src/formats/notion-api/api-client";
import { convertDatabaseToBase } from "./src/formats/notion-api/base-converter";
import { BlockConverter } from "./src/formats/notion-api/block-converter";
import * as fs from "fs";

async function testImporter() {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error("NOTION_TOKEN environment variable required");
  }

  const client = new NotionApiClient({ auth: token });

  // Search for databases
  const searchResults = await client.searchAll();
  console.log(`Found ${searchResults.length} items`);

  // Filter to databases
  const databases = searchResults.filter(
    (r) =>
      "object" in r && (r.object === "database" || r.object === "data_source"),
  );
  console.log(`Found ${databases.length} databases`);

  // Convert first database
  if (databases.length > 0) {
    const db = databases[0] as any;
    const result = convertDatabaseToBase(db);

    console.log("Database:", result.databaseTitle);
    console.log("Properties:", Object.keys(result.schema.properties || {}));
    console.log("Formulas:", Object.keys(result.schema.formulas || {}));
    console.log("Warnings:", result.warnings);

    // Save to file
    fs.writeFileSync("test-output.json", JSON.stringify(result, null, 2));
  }
}

testImporter().catch(console.error);
```

Run with:

```bash
NOTION_TOKEN=secret_your_token_here npx tsx test-notion-api.ts
```

---

## 4. Automated E2E Testing

### Setup for CI/CD

#### Step 1: Create a Notion Test Workspace

1. Create a separate Notion workspace for testing
2. Create an integration with `NOTION_TEST_TOKEN`
3. Store the token as a GitHub Secret or CI environment variable

#### Step 2: Populate Test Data Programmatically

Create `tests/e2e/setup-notion-test-data.ts`:

```typescript
import { Client } from "@notionhq/client";

async function setupTestData(token: string) {
  const notion = new Client({ auth: token });

  // Create parent page for all test content
  const parentPage = await notion.pages.create({
    parent: { type: "workspace", workspace: true },
    properties: {
      title: {
        title: [{ text: { content: "E2E Test Suite" } }],
      },
    },
  });

  // Create test database
  const database = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPage.id },
    title: [{ text: { content: "Test Database" } }],
    properties: {
      Name: { title: {} },
      Status: {
        select: {
          options: [
            { name: "To Do", color: "red" },
            { name: "In Progress", color: "yellow" },
            { name: "Done", color: "green" },
          ],
        },
      },
      Price: { number: { format: "dollar" } },
      Quantity: { number: {} },
      Total: {
        formula: {
          expression: 'prop("Price") * prop("Quantity")',
        },
      },
      Description: { rich_text: {} },
      "Due Date": { date: {} },
      "Is Complete": { checkbox: {} },
      Tags: {
        multi_select: {
          options: [
            { name: "Important", color: "red" },
            { name: "Urgent", color: "orange" },
          ],
        },
      },
    },
  });

  // Create test pages with various content
  const testPages = [
    {
      title: "Rich Text Test",
      properties: {
        Name: { title: [{ text: { content: "Rich Text Test" } }] },
        Price: { number: 99.99 },
        Quantity: { number: 3 },
      },
      content: [
        {
          object: "block",
          type: "heading_1",
          heading_1: {
            rich_text: [{ text: { content: "Main Heading" } }],
          },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              { text: { content: "Bold text", annotations: { bold: true } } },
              { text: { content: " and " } },
              {
                text: { content: "italic text", annotations: { italic: true } },
              },
            ],
          },
        },
        {
          object: "block",
          type: "code",
          code: {
            language: "javascript",
            rich_text: [{ text: { content: "const x = 42;" } }],
          },
        },
      ],
    },
    {
      title: "Table Test",
      properties: {
        Name: { title: [{ text: { content: "Table Test" } }] },
        Status: { select: { name: "Done" } },
      },
      content: [
        {
          object: "block",
          type: "table",
          table: {
            table_width: 3,
            has_column_header: true,
            has_row_header: false,
            children: [
              {
                type: "table_row",
                table_row: {
                  cells: [
                    [{ text: { content: "Name" } }],
                    [{ text: { content: "Age" } }],
                    [{ text: { content: "City" } }],
                  ],
                },
              },
              {
                type: "table_row",
                table_row: {
                  cells: [
                    [{ text: { content: "John" } }],
                    [{ text: { content: "30" } }],
                    [{ text: { content: "NYC" } }],
                  ],
                },
              },
            ],
          },
        },
      ],
    },
    {
      title: "Media Test",
      properties: {
        Name: { title: [{ text: { content: "Media Test" } }] },
      },
      content: [
        {
          object: "block",
          type: "image",
          image: {
            type: "external",
            external: {
              url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400",
            },
            caption: [{ text: { content: "Test Image" } }],
          },
        },
        {
          object: "block",
          type: "bookmark",
          bookmark: {
            url: "https://obsidian.md",
            caption: [{ text: { content: "Obsidian Website" } }],
          },
        },
      ],
    },
  ];

  // Create all test pages
  for (const pageData of testPages) {
    const page = await notion.pages.create({
      parent: { database_id: database.id },
      properties: pageData.properties as any,
    });

    // Add content blocks
    for (const block of pageData.content) {
      await notion.blocks.children.append({
        block_id: page.id,
        children: [block as any],
      });
    }
  }

  return {
    parentPageId: parentPage.id,
    databaseId: database.id,
    pageCount: testPages.length,
  };
}

if (require.main === module) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error("NOTION_TOKEN environment variable required");
    process.exit(1);
  }

  setupTestData(token)
    .then((result) => {
      console.log("Test data created successfully:");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("Failed to create test data:", error);
      process.exit(1);
    });
}

export { setupTestData };
```

#### Step 3: Create E2E Test Runner

Create `tests/e2e/run-e2e-tests.ts`:

```typescript
import { NotionApiClient } from "../../src/formats/notion-api/api-client";
import { convertDatabaseToBase } from "../../src/formats/notion-api/base-converter";
import { BlockConverter } from "../../src/formats/notion-api/block-converter";
import { setupTestData } from "./setup-notion-test-data";
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

interface TestResult {
  passed: boolean;
  name: string;
  error?: string;
}

class E2ETestRunner {
  private client: NotionApiClient;
  private results: TestResult[] = [];
  private outputDir: string;

  constructor(token: string, outputDir: string) {
    this.client = new NotionApiClient({ auth: token });
    this.outputDir = outputDir;

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  async test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.results.push({ passed: true, name });
      console.log(`✓ ${name}`);
    } catch (error) {
      this.results.push({
        passed: false,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ ${name}`);
      console.error(
        `  Error: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async runAll(): Promise<void> {
    console.log("Setting up test data...");
    const testData = await setupTestData(process.env.NOTION_TOKEN!);
    console.log(`Created test database: ${testData.databaseId}\n`);

    // Test 1: Database Discovery
    await this.test("Discovers databases in workspace", async () => {
      const results = await this.client.searchAll();
      const databases = results.filter(
        (r) =>
          "object" in r &&
          (r.object === "database" || r.object === "data_source"),
      );
      assert.ok(databases.length > 0, "Should find at least one database");
    });

    // Test 2: Database Conversion
    await this.test("Converts database to Base schema", async () => {
      const database = await this.client.getDatabase(testData.databaseId);
      const result = convertDatabaseToBase(database as any);

      assert.strictEqual(result.databaseId, testData.databaseId);
      assert.ok(result.schema.properties, "Should have properties");
      assert.ok(result.schema.formulas, "Should have formulas");
      assert.ok(result.schema.formulas!["total"], "Should have total formula");

      // Save for inspection
      fs.writeFileSync(
        path.join(this.outputDir, "database-schema.json"),
        JSON.stringify(result, null, 2),
      );
    });

    // Test 3: Formula Conversion
    await this.test("Converts formulas correctly", async () => {
      const database = await this.client.getDatabase(testData.databaseId);
      const result = convertDatabaseToBase(database as any);

      const totalFormula = result.schema.formulas!["total"];
      assert.ok(totalFormula, "Total formula should exist");
      assert.strictEqual(
        totalFormula.expression,
        "(Price * Quantity)",
        "Formula should be converted correctly",
      );
    });

    // Test 4: Page Conversion
    await this.test("Converts pages to markdown", async () => {
      const pages = await this.client.getAllDatabasePages(testData.databaseId);
      assert.ok(pages.length >= 3, "Should have at least 3 test pages");

      // Test rich text page
      const richTextPage = pages.find((p) => {
        const props = p.properties;
        for (const prop of Object.values(props)) {
          if (
            typeof prop === "object" &&
            prop !== null &&
            "type" in prop &&
            prop.type === "title" &&
            "title" in prop
          ) {
            const title = (prop.title as any[])
              .map((t) => t.plain_text)
              .join("");
            return title === "Rich Text Test";
          }
        }
        return false;
      });

      assert.ok(richTextPage, "Should find Rich Text Test page");
    });

    // Test 5: Block Conversion
    await this.test("Converts blocks to markdown", async () => {
      const pages = await this.client.getAllDatabasePages(testData.databaseId);
      const testPage = pages[0];

      const mockVault = {
        createBinary: async () => {},
        create: async () => {},
        exists: async () => false,
      } as any;

      const converter = new BlockConverter(
        this.client,
        mockVault,
        this.outputDir,
      );
      const markdown = await converter.convertBlocksToMarkdown(testPage.id);

      assert.ok(markdown, "Should generate markdown content");

      // Save for inspection
      fs.writeFileSync(path.join(this.outputDir, "page-markdown.md"), markdown);
    });

    // Test 6: Table Conversion
    await this.test("Converts tables correctly", async () => {
      const pages = await this.client.getAllDatabasePages(testData.databaseId);
      const tablePage = pages.find((p) => {
        const props = p.properties;
        for (const prop of Object.values(props)) {
          if (
            typeof prop === "object" &&
            prop !== null &&
            "type" in prop &&
            prop.type === "title" &&
            "title" in prop
          ) {
            const title = (prop.title as any[])
              .map((t) => t.plain_text)
              .join("");
            return title === "Table Test";
          }
        }
        return false;
      });

      if (tablePage) {
        const mockVault = { createBinary: async () => {} } as any;
        const converter = new BlockConverter(
          this.client,
          mockVault,
          this.outputDir,
        );
        const markdown = await converter.convertBlocksToMarkdown(tablePage.id);

        assert.ok(markdown.includes("|"), "Should contain table syntax");
        assert.ok(markdown.includes("---"), "Should contain table separator");
      }
    });

    // Test 7: Image Handling
    await this.test("Handles images correctly", async () => {
      const pages = await this.client.getAllDatabasePages(testData.databaseId);
      const mediaPage = pages.find((p) => {
        const props = p.properties;
        for (const prop of Object.values(props)) {
          if (
            typeof prop === "object" &&
            prop !== null &&
            "type" in prop &&
            prop.type === "title" &&
            "title" in prop
          ) {
            const title = (prop.title as any[])
              .map((t) => t.plain_text)
              .join("");
            return title === "Media Test";
          }
        }
        return false;
      });

      if (mediaPage) {
        const mockVault = { createBinary: async () => {} } as any;
        const converter = new BlockConverter(
          this.client,
          mockVault,
          this.outputDir,
        );
        const markdown = await converter.convertBlocksToMarkdown(mediaPage.id);

        assert.ok(markdown.includes("!["), "Should contain image embed");
      }
    });

    // Print summary
    console.log("\n" + "=".repeat(50));
    console.log("Test Results Summary");
    console.log("=".repeat(50));

    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;

    console.log(`Total: ${this.results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log("\nFailed Tests:");
      this.results
        .filter((r) => !r.passed)
        .forEach((r) => {
          console.log(`  - ${r.name}: ${r.error}`);
        });
      process.exit(1);
    }

    // Save results
    fs.writeFileSync(
      path.join(this.outputDir, "test-results.json"),
      JSON.stringify(this.results, null, 2),
    );
  }
}

if (require.main === module) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error("NOTION_TOKEN environment variable required");
    process.exit(1);
  }

  const outputDir = path.join(__dirname, "../../test-output");
  const runner = new E2ETestRunner(token, outputDir);

  runner
    .runAll()
    .then(() => {
      console.log("\n✓ All tests passed!");
    })
    .catch((error) => {
      console.error("\nTest runner failed:", error);
      process.exit(1);
    });
}
```

#### Step 4: GitHub Actions Workflow

Create `.github/workflows/e2e-notion-api.yml`:

```yaml
name: E2E Notion API Tests

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]
  schedule:
    - cron: "0 0 * * 0" # Weekly on Sundays

jobs:
  e2e-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"
          cache: "npm"

      - name: Install dependencies
        run: npm ci --legacy-peer-deps

      - name: Build project
        run: npm run build

      - name: Run E2E tests
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TEST_TOKEN }}
        run: npx tsx tests/e2e/run-e2e-tests.ts

      - name: Upload test artifacts
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: e2e-test-results
          path: test-output/

      - name: Comment PR with results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const results = JSON.parse(fs.readFileSync('test-output/test-results.json', 'utf8'));

            const passed = results.filter(r => r.passed).length;
            const failed = results.filter(r => !r.passed).length;

            const body = `## E2E Test Results

            - ✅ Passed: ${passed}
            - ❌ Failed: ${failed}

            ${failed > 0 ? '### Failed Tests\n' + results.filter(r => !r.passed).map(r => `- ${r.name}: ${r.error}`).join('\n') : ''}
            `;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });
```

#### Step 5: Local Testing Script

Create `package.json` scripts:

```json
{
  "scripts": {
    "test": "vitest",
    "test:e2e": "tsx tests/e2e/run-e2e-tests.ts",
    "test:e2e:setup": "tsx tests/e2e/setup-notion-test-data.ts",
    "test:all": "npm test && npm run test:e2e"
  }
}
```

Run locally:

```bash
export NOTION_TOKEN=secret_your_token_here
npm run test:e2e:setup  # Creates test data
npm run test:e2e        # Runs E2E tests
```

---

## Verification Checklist

After running the importer, verify:

### Base Files (`.base`)

- [ ] File created in output folder
- [ ] Contains YAML schema in code block
- [ ] Has correct property types
- [ ] Formulas are converted properly
- [ ] Options for select/multi-select preserved

### Markdown Files (`.md`)

- [ ] Frontmatter includes `notion-database` tag
- [ ] Page title is correct (H1)
- [ ] Rich text formatting preserved
- [ ] All text styles work (bold, italic, strikethrough, code)
- [ ] Links are clickable
- [ ] Headings at correct levels

### Lists

- [ ] Bulleted lists formatted correctly
- [ ] Numbered lists have proper numbering
- [ ] To-do items show `[ ]` or `[x]`
- [ ] Nested lists indented properly

### Tables

- [ ] Rendered with pipe syntax `| ... |`
- [ ] Headers have separator line `| --- |`
- [ ] All cells present
- [ ] Empty cells handled

### Media

- [ ] Images downloaded to attachment folder
- [ ] Images embedded with `![caption](path)`
- [ ] Attachments downloaded
- [ ] Captions preserved
- [ ] External URLs work as fallback

### Code and Math

- [ ] Code blocks have language specified
- [ ] Inline code uses backticks
- [ ] Block equations use `$$...$$`
- [ ] Inline equations use `$...$`

### Edge Cases

- [ ] Empty blocks don't create extra whitespace
- [ ] Special characters in filenames handled
- [ ] Very long content doesn't break
- [ ] Nested structures preserved
- [ ] No data loss

---

## Troubleshooting

### "No databases found"

- Ensure databases are shared with the integration
- Check integration has correct permissions
- Verify token is correct

### "Failed to download attachment"

- Check internet connection
- Notion URLs may have expired (they expire after 1 hour)
- Re-run the import to get fresh URLs

### Formula conversion warnings

- Check console for specific formula errors
- Verify formula uses supported Notion functions
- Some complex formulas may need manual adjustment

### Build errors

- Run `npm install --legacy-peer-deps`
- Clear node_modules and reinstall
- Check Node.js version (18+ recommended)

---

## Performance Notes

Import speed depends on:

- Number of databases: ~1-2 seconds per database
- Number of pages: ~0.5 seconds per page
- Number of blocks: ~10ms per block
- Attachments: ~1-5 seconds per file (depends on size)

For large workspaces (100+ pages), expect 5-10 minutes for complete import.

---

## Next Steps

After successful testing:

1. Document any issues found
2. Create test cases for edge cases
3. Add regression tests for fixed bugs
4. Update this guide with new findings
5. Share feedback with the development team
