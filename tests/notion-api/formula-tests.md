# Formula Conversion Test Cases

This file contains test cases for verifying Notion formula conversion to Obsidian Bases format.

## Critical: prop() Function Handling

### Test 1: Simple prop() reference
**Notion Formula:**
```
prop("Name")
```
**Expected Obsidian Output:**
```
Name
```

### Test 2: prop() in conditional
**Notion Formula:**
```
if(prop("Status") == "Done", true, false)
```
**Expected Obsidian Output:**
```
if(Status == "Done", true, false)
```

### Test 3: prop() in arithmetic
**Notion Formula:**
```
prop("Price") * prop("Quantity")
```
**Expected Obsidian Output:**
```
(Price * Quantity)
```

### Test 4: Multiple prop() in concat
**Notion Formula:**
```
concat(prop("FirstName"), " ", prop("LastName"))
```
**Expected Obsidian Output:**
```
concat(FirstName, " ", LastName)
```

### Test 5: prop() with spaces in property name
**Notion Formula:**
```
prop("First Name")
```
**Expected Obsidian Output:**
```
First Name
```

## Function Mappings

### Test 6: add() function
**Notion Formula:**
```
add(prop("A"), prop("B"))
```
**Expected Obsidian Output:**
```
(A + B)
```

### Test 7: Multiple add() arguments
**Notion Formula:**
```
add(1, 2, 3, 4)
```
**Expected Obsidian Output:**
```
sum(1, 2, 3, 4)
```

### Test 8: Date formatting
**Notion Formula:**
```
formatDate(prop("Created"), "YYYY-MM-DD")
```
**Expected Obsidian Output:**
```
dateformat(Created, "YYYY-MM-DD")
```

### Test 9: today() function
**Notion Formula:**
```
today()
```
**Expected Obsidian Output:**
```
dateonly(now())
```

### Test 10: String operations
**Notion Formula:**
```
upper(prop("Name"))
```
**Expected Obsidian Output:**
```
upper(Name)
```

### Test 11: Comparison operators
**Notion Formula:**
```
prop("Score") >= 90
```
**Expected Obsidian Output:**
```
(Score >= 90)
```

### Test 12: Boolean logic
**Notion Formula:**
```
and(prop("IsActive"), prop("IsVerified"))
```
**Expected Obsidian Output:**
```
and(IsActive, IsVerified)
```

### Test 13: Complex nested formula
**Notion Formula:**
```
if(prop("Price") > 100, concat("$", formatDate(prop("ExpensiveDate"), "MM/DD/YYYY")), concat("$", formatDate(prop("CheapDate"), "MM/DD/YYYY")))
```
**Expected Obsidian Output:**
```
if((Price > 100), concat("$", dateformat(ExpensiveDate, "MM/DD/YYYY")), concat("$", dateformat(CheapDate, "MM/DD/YYYY")))
```

## Edge Cases

### Test 14: Direct property reference (no prop() wrapper)
**Notion Formula:**
```
Name
```
**Expected Obsidian Output:**
```
Name
```

### Test 15: String literals with quotes
**Notion Formula:**
```
concat(prop("Name"), " - ", "Active")
```
**Expected Obsidian Output:**
```
concat(Name, " - ", "Active")
```

### Test 16: Numeric literals
**Notion Formula:**
```
prop("Price") * 1.08
```
**Expected Obsidian Output:**
```
(Price * 1.08)
```

### Test 17: Boolean literals
**Notion Formula:**
```
if(prop("IsActive"), true, false)
```
**Expected Obsidian Output:**
```
if(IsActive, true, false)
```

## Testing Instructions

To test these conversions:

1. Open the TypeScript console or create a test file
2. Import the `convertNotionFormula` function from `formula-converter.ts`
3. For each test case:
   ```typescript
   import { convertNotionFormula } from '../src/formats/notion-api/formula-converter';

   const result = convertNotionFormula('prop("Name")');
   console.log(result);
   // Expected: { success: true, formula: 'Name', warnings: [] }
   ```
4. Verify the output matches the expected result
5. Check for any warnings in the result

## Known Limitations

- Notion Formulas 2.0 introduced complex types (lists, objects) that may not fully map to Obsidian Bases
- Some Notion functions may not have Obsidian equivalents
- Property references with special characters may need sanitization
