import { convertDatabaseToBase, createBaseFileContent } from '../../src/formats/notion-api/base-converter';
import type { NotionDatabaseWithProperties } from '../../src/formats/notion-api/notion-types';
import * as fs from 'fs';
import * as path from 'path';

console.log('=== Base Converter Test Suite ===\n');

let passed = 0;
let failed = 0;

const mockDataDir = path.join(__dirname, 'mock-data');
const expectedOutputsDir = path.join(__dirname, 'expected-outputs');

async function testDatabase(name: string, mockFile: string, expectedFile: string) {
	try {
		const mockPath = path.join(mockDataDir, mockFile);
		const expectedPath = path.join(expectedOutputsDir, expectedFile);

		const mockData = JSON.parse(fs.readFileSync(mockPath, 'utf-8')) as NotionDatabaseWithProperties;

		const result = convertDatabaseToBase(mockData);
		const actualContent = createBaseFileContent(result.schema, result.databaseTitle);

		const expectedContent = fs.readFileSync(expectedPath, 'utf-8');

		if (actualContent.trim() === expectedContent.trim()) {
			console.log(`✅ ${name}`);
			console.log(`   Database: ${result.databaseTitle}`);
			console.log(`   Properties: ${Object.keys(result.schema.properties || {}).length}`);
			console.log(`   Formulas: ${Object.keys(result.schema.formulas || {}).length}`);
			if (result.warnings.length > 0) {
				console.log(`   Warnings: ${result.warnings.length}`);
			}
			console.log('');
			passed++;
		} else {
			console.log(`❌ ${name}`);
			console.log(`   Output doesn't match expected`);
			console.log('\n   === EXPECTED ===');
			console.log(expectedContent);
			console.log('\n   === ACTUAL ===');
			console.log(actualContent);
			console.log('');
			failed++;
		}
	} catch (error) {
		console.log(`❌ ${name}`);
		console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
		console.log('');
		failed++;
	}
}

async function runTests() {
	console.log('Testing simple database conversion...');
	await testDatabase(
		'Simple Database',
		'database-simple.json',
		'simple-database.base'
	);

	console.log('Testing database with formulas conversion...');
	await testDatabase(
		'Database with Formulas',
		'database-with-formulas.json',
		'formula-database.base'
	);

	console.log('\n=== Summary ===');
	console.log(`Passed: ${passed}/2`);
	console.log(`Failed: ${failed}/2`);

	if (failed === 0) {
		console.log('\n✅ All Base converter tests passed!');
	} else {
		console.log(`\n❌ ${failed} test(s) failed`);
	}
}

runTests();
