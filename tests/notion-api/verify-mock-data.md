# Mock Data Verification Guide

This guide explains how to manually verify the converters using the mock data files.

## Testing Base Converter

### Test 1: Simple Database

**Input:** `mock-data/database-simple.json`

**Expected Output:** `expected-outputs/simple-database.base`

**Steps:**
1. Load the database JSON
2. Pass through `convertDatabaseToBase()`
3. Use `createBaseFileContent()` to generate markdown
4. Compare with expected output

**Verification Points:**
- Database ID in filters matches: `abc123-456def-789ghi`
- All 5 properties present (Name, Status, Priority, Due Date, Completed)
- Property types mapped correctly:
  - title → text
  - select → select (with 3 options for Status, 3 for Priority)
  - date → date
  - checkbox → checkbox
- No formulas section (database has none)
- Views array has one table view

### Test 2: Database with Formulas

**Input:** `mock-data/database-with-formulas.json`

**Expected Output:** `expected-outputs/formula-database.base`

**Steps:**
1. Load the database JSON
2. Pass through `convertDatabaseToBase()`
3. Use `createBaseFileContent()` to generate markdown
4. Compare with expected output

**Verification Points:**
- Database ID matches: `formula-test-123`
- 3 regular properties (Product Name, Price, Quantity)
- 4 formula properties converted correctly:
  - `prop("Price") * prop("Quantity")` → `(Price * Quantity)`
  - `if(prop("Price") > 100, "Expensive", "Affordable")` → `if((Price > 100), "Expensive", "Affordable")`
  - `concat(prop("Product Name"), " ($", prop("Price"), ")")` → `concat(Product Name, " ($", Price, ")")`
  - Complex nested if statement converted correctly
- Formulas section exists with all 4 formulas
- Formula expressions have correct syntax

## Testing Page Converter

### Test 3: Sample Page

**Input:** `mock-data/page-sample.json`

**Expected Output:** `expected-outputs/sample-page.md`

**Steps:**
1. Load the page JSON
2. Pass through `extractPageTitle()` to get title
3. Use `convertPage()` logic to generate markdown
4. Compare with expected output

**Verification Points:**
- Title extracted correctly: "Sample Task"
- Frontmatter has database tag
- Heading has title

## Testing Formula Converter Directly

Use the Node.js test script:

```bash
cd tests/notion-api
node verify-formulas.js
```

This will run all 17 formula test cases and report results.

## Manual Testing with TypeScript Console

You can also test individual functions in a TypeScript REPL:

```typescript
// Test formula converter
import { convertNotionFormula } from '../../src/formats/notion-api/formula-converter';

const result = convertNotionFormula('prop("Name")');
console.log(result);
// Expected: { success: true, formula: 'Name', warnings: [] }

// Test database converter
import { convertDatabaseToBase } from '../../src/formats/notion-api/base-converter';
import databaseJson from './mock-data/database-simple.json';

const result = convertDatabaseToBase(databaseJson as any);
console.log(result);
// Should have schema with properties, no warnings

// Test base serialization
import { createBaseFileContent } from '../../src/formats/notion-api/base-converter';

const content = createBaseFileContent(result.schema, result.databaseTitle);
console.log(content);
// Compare with expected-outputs/simple-database.base
```

## Common Issues to Check

### Formula Conversion Issues
- [ ] `prop()` not removed (shows as UNSUPPORTED_FUNCTION)
- [ ] Property names in quotes in output (should be bare names)
- [ ] Missing spaces around operators: `a*b` instead of `(a * b)`
- [ ] Wrong function names (Notion vs Obsidian differences)

### Base Schema Issues
- [ ] Missing database ID in filters
- [ ] Wrong property types
- [ ] Missing options for select properties
- [ ] Formulas in properties section (should be separate)
- [ ] YAML formatting issues (quotes, indentation)

### Page Conversion Issues
- [ ] Title extraction fails (returns "Untitled" incorrectly)
- [ ] Frontmatter missing or malformed
- [ ] Wrong database ID in frontmatter

## Debugging Tips

1. **Enable verbose logging:** Add console.log statements to see intermediate values
2. **Check AST:** In formula converter, log the AST before translation
3. **Compare character-by-character:** Use a diff tool to find exact differences
4. **Test incrementally:** Start with simple cases, then add complexity
5. **Check warnings:** Formula converter may add warnings for unsupported features
