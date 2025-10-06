# Notion API Importer Tests

This directory contains test data and verification files for the Notion API importer.

## Directory Structure

- `mock-data/` - JSON files representing Notion API responses
- `expected-outputs/` - Expected output files (.base and .md) that the importer should produce
- `formula-tests.md` - Manual formula conversion test cases
- `test-checklist.md` - Manual testing checklist

## Running Tests

Since this project doesn't use automated unit tests, testing is manual:

1. Review the test cases in `formula-tests.md`
2. Compare actual outputs with files in `expected-outputs/`
3. Use the checklist in `test-checklist.md` to verify all functionality

## Test Coverage

- Formula conversion (Notion formulas → Obsidian Bases formulas)
- Property type mappings (Notion property types → Base property types)
- Base schema generation and YAML serialization
- API client rate limiting and pagination
- Page title extraction from RichTextItemResponse
- Block-to-markdown conversion
