import { convertNotionFormula } from '../../src/formats/notion-api/formula-converter';

interface TestCase {
	name: string;
	input: string;
	expected: string;
}

const testCases: TestCase[] = [
	{
		name: 'Test 1: Simple prop() reference',
		input: 'prop("Name")',
		expected: 'Name',
	},
	{
		name: 'Test 2: prop() in conditional',
		input: 'if(prop("Status") == "Done", true, false)',
		expected: 'if((Status == "Done"), true, false)',
	},
	{
		name: 'Test 3: prop() in arithmetic',
		input: 'prop("Price") * prop("Quantity")',
		expected: '(Price * Quantity)',
	},
	{
		name: 'Test 4: Multiple prop() in concat',
		input: 'concat(prop("FirstName"), " ", prop("LastName"))',
		expected: 'concat(FirstName, " ", LastName)',
	},
	{
		name: 'Test 5: prop() with spaces',
		input: 'prop("First Name")',
		expected: 'First Name',
	},
	{
		name: 'Test 6: add() function',
		input: 'add(prop("A"), prop("B"))',
		expected: '(A + B)',
	},
	{
		name: 'Test 7: Multiple add() arguments',
		input: 'add(1, 2, 3, 4)',
		expected: 'sum(1, 2, 3, 4)',
	},
	{
		name: 'Test 8: Date formatting',
		input: 'formatDate(prop("Created"), "YYYY-MM-DD")',
		expected: 'dateformat(Created, "YYYY-MM-DD")',
	},
	{
		name: 'Test 9: today() function',
		input: 'today()',
		expected: 'dateonly(now())',
	},
	{
		name: 'Test 10: String operations',
		input: 'upper(prop("Name"))',
		expected: 'upper(Name)',
	},
	{
		name: 'Test 11: Comparison operators',
		input: 'prop("Score") >= 90',
		expected: '(Score >= 90)',
	},
	{
		name: 'Test 12: Boolean logic',
		input: 'and(prop("IsActive"), prop("IsVerified"))',
		expected: 'and(IsActive, IsVerified)',
	},
	{
		name: 'Test 13: Complex nested formula',
		input: 'if(prop("Price") > 100, concat("$", formatDate(prop("ExpensiveDate"), "MM/DD/YYYY")), concat("$", formatDate(prop("CheapDate"), "MM/DD/YYYY")))',
		expected: 'if((Price > 100), concat("$", dateformat(ExpensiveDate, "MM/DD/YYYY")), concat("$", dateformat(CheapDate, "MM/DD/YYYY")))',
	},
	{
		name: 'Test 14: Direct property reference',
		input: 'Name',
		expected: 'Name',
	},
	{
		name: 'Test 15: String literals with quotes',
		input: 'concat(prop("Name"), " - ", "Active")',
		expected: 'concat(Name, " - ", "Active")',
	},
	{
		name: 'Test 16: Numeric literals',
		input: 'prop("Price") * 1.08',
		expected: '(Price * 1.08)',
	},
	{
		name: 'Test 17: Boolean literals',
		input: 'if(prop("IsActive"), true, false)',
		expected: 'if(IsActive, true, false)',
	},
];

console.log('=== Notion Formula Converter Test Suite ===\n');

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const test of testCases) {
	const result = convertNotionFormula(test.input);

	if (!result.success) {
		console.log(`❌ ${test.name}`);
		console.log(`   Input:    ${test.input}`);
		console.log(`   Error:    ${result.error}`);
		console.log('');
		failed++;
		failures.push(`${test.name}: ${result.error}`);
		continue;
	}

	if (result.formula === test.expected) {
		console.log(`✅ ${test.name}`);
		passed++;
	} else {
		console.log(`❌ ${test.name}`);
		console.log(`   Input:    ${test.input}`);
		console.log(`   Expected: ${test.expected}`);
		console.log(`   Got:      ${result.formula}`);
		if (result.warnings && result.warnings.length > 0) {
			console.log(`   Warnings: ${result.warnings.join(', ')}`);
		}
		console.log('');
		failed++;
		failures.push(`${test.name}: Expected "${test.expected}", got "${result.formula}"`);
	}
}

console.log(`\n=== Summary ===`);
console.log(`Passed: ${passed}/${testCases.length}`);
console.log(`Failed: ${failed}/${testCases.length}`);

if (failed > 0) {
	console.log('\n=== Failures ===');
	failures.forEach(f => console.log(`  - ${f}`));
}

if (failed === 0) {
	console.log('\n✅ All tests passed!');
} else {
	console.log(`\n❌ ${failed} test(s) failed`);
}
