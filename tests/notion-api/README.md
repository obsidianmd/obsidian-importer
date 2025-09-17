# Notion API Importer Tests

This directory contains test data and documentation for the Notion API importer.

## Test Strategy

### Manual Testing Required
Since this importer uses the live Notion API with OAuth, automated testing requires:
1. Test Notion workspace with sample data
2. Valid Notion Integration Token
3. Database structures for conversion testing

### Test Cases to Verify

#### Database to Bases Conversion
- [ ] Simple database with text properties
- [ ] Database with all property types (21+ supported)
- [ ] Database with relations and formulas
- [ ] Empty database
- [ ] Database with special characters in names

#### Page Import
- [ ] Simple page with basic formatting
- [ ] Page with nested blocks
- [ ] Page with images and attachments
- [ ] Page with database embeds
- [ ] Empty page

#### Error Handling
- [ ] Invalid API token
- [ ] Network timeout
- [ ] Rate limiting (3 req/sec)
- [ ] Malformed API responses
- [ ] Permission denied pages

#### Performance
- [ ] Large workspace (100+ pages)
- [ ] Progress tracking accuracy
- [ ] Memory usage with large imports
- [ ] Cancellation functionality

## Dogfooding Results

✅ **Build Success**: TypeScript compilation passes
✅ **Integration**: Properly integrated into main importer
✅ **UI**: Settings panel renders correctly
⏳ **API Testing**: Requires live workspace testing
⏳ **Conversion**: Database to Bases needs validation

## Next Steps for Complete Testing

1. Set up test Notion workspace
2. Create sample databases with various property types
3. Test OAuth integration flow
4. Verify Database to Bases conversion output
5. Test with large datasets for performance