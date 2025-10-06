# Notion API Importer Test Checklist

## Formula Conversion Tests

### Critical prop() Function Tests
- [ ] Test 1: Simple `prop("Name")` → `Name`
- [ ] Test 2: `prop()` in conditional statement
- [ ] Test 3: `prop()` in arithmetic operations
- [ ] Test 4: Multiple `prop()` calls in one formula
- [ ] Test 5: `prop()` with property names containing spaces

### Function Mapping Tests
- [ ] Test 6: `add()` with 2 arguments → `(A + B)`
- [ ] Test 7: `add()` with 3+ arguments → `sum()`
- [ ] Test 8: Date formatting functions
- [ ] Test 9: `today()` → `dateonly(now())`
- [ ] Test 10: String manipulation functions
- [ ] Test 11: Comparison operators
- [ ] Test 12: Boolean logic (and/or/not)
- [ ] Test 13: Complex nested formulas

### Edge Cases
- [ ] Test 14: Direct property reference (no `prop()`)
- [ ] Test 15: String literals with quotes
- [ ] Test 16: Numeric literals
- [ ] Test 17: Boolean literals

## Property Type Mapping Tests

### Basic Types
- [ ] Title property → text
- [ ] Rich text property → text
- [ ] Number property → number
- [ ] Checkbox property → checkbox
- [ ] Date property → date
- [ ] URL property → link
- [ ] Email property → text
- [ ] Phone number property → text

### Select Types (with options extraction)
- [ ] Select property → select with options array
- [ ] Multi-select property → multi-select with options array
- [ ] Status property → select with options array

### Unsupported Types (should generate warnings)
- [ ] Relation property → warning
- [ ] Rollup property → warning
- [ ] Files property → file (or warning?)
- [ ] Formula property → goes to formulas section

## Base Schema Generation Tests

### YAML Structure
- [ ] `version` field is set to "1.0"
- [ ] `filters` object references database ID correctly
- [ ] `properties` section exists when database has properties
- [ ] `formulas` section exists when database has formulas
- [ ] `views` array contains default table view
- [ ] Properties have correct structure (type, name, displayName)
- [ ] Formulas have correct structure (name, displayName, expression)

### YAML Formatting
- [ ] Text literals use double quotes
- [ ] Formula expressions properly formatted
- [ ] Arithmetic operators have spaces: `a * b` not `a*b`
- [ ] Line width unlimited (no wrapping)
- [ ] Property names preserved exactly (including spaces)

## API Client Tests

### Rate Limiting
- [ ] Rate limiter enforces 3 requests/second
- [ ] Multiple rapid requests are properly throttled
- [ ] No requests lost during throttling

### Pagination
- [ ] `searchAll()` handles `has_more` correctly
- [ ] `searchAll()` uses `next_cursor` for subsequent pages
- [ ] All results aggregated across multiple pages
- [ ] `getAllDatabasePages()` fetches all pages from database
- [ ] Pagination handles empty result sets

### Error Handling
- [ ] Invalid API token returns user-friendly error
- [ ] Network failures handled gracefully
- [ ] API rate limit errors handled
- [ ] Invalid database ID handled

## Page Processing Tests

### Title Extraction
- [ ] Extract title from PageObjectResponse with single text part
- [ ] Extract title with multiple RichTextItemResponse parts
- [ ] Handle pages with no title → "Untitled"
- [ ] Handle pages with empty string title → "Untitled"
- [ ] Concatenate multiple title parts correctly

### File Creation
- [ ] Create markdown file with proper frontmatter
- [ ] Database tag in frontmatter: `notion-database: "id"`
- [ ] Title in markdown heading: `# Title`
- [ ] Handle duplicate filenames (append number)
- [ ] Sanitize file paths (remove invalid characters)

## Integration Tests

### End-to-End Workflow
- [ ] Search for databases in workspace
- [ ] Filter results to only databases
- [ ] Convert each database to .base file
- [ ] Fetch pages from each database
- [ ] Convert each page to .md file
- [ ] Report progress correctly
- [ ] Handle cancellation gracefully

### Mock Data Tests
- [ ] Load `database-simple.json` → produces `simple-database.base`
- [ ] Load `database-with-formulas.json` → produces `formula-database.base`
- [ ] Load `page-sample.json` → produces `sample-page.md`
- [ ] Compare actual vs expected outputs byte-by-byte

## Known Issues and Limitations

### Current Implementation Gaps
- [ ] **CRITICAL**: Page content (blocks) not converted - only stub pages created
- [ ] **IMPORTANT**: No rich text formatting conversion
- [ ] **IMPORTANT**: No nested block handling
- [ ] **IMPORTANT**: No attachment downloading
- [ ] Formulas 2.0 complex types (lists, objects) may not fully map

### Future Enhancements Needed
- [ ] Implement block-to-markdown conversion
- [ ] Implement rich text formatting (bold, italic, code, etc.)
- [ ] Implement nested blocks (indentation)
- [ ] Implement block types (paragraph, heading, list, code, etc.)
- [ ] Implement attachment downloading
- [ ] Implement synced blocks
- [ ] Implement database views
- [ ] Implement page property values conversion

## Testing Instructions

1. **Manual Formula Testing:**
   - Copy test formulas from `formula-tests.md`
   - Use TypeScript/Node console to test `convertNotionFormula()`
   - Verify output matches expected result

2. **Mock Data Testing:**
   - Load mock JSON files
   - Pass through converter functions
   - Compare output with expected output files
   - Use diff tool to check for discrepancies

3. **Live API Testing:**
   - Create test Notion workspace
   - Add databases with various property types
   - Add formulas to test conversion
   - Run importer with actual API token
   - Verify generated .base and .md files

4. **Regression Testing:**
   - Keep expected output files in version control
   - After code changes, re-run tests
   - Ensure outputs still match expected files
