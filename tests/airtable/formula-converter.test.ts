import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertAirtableFormulaToObsidian } from '../../src/formats/airtable-api/formula-converter';

/**
 * The converter rewrites Airtable formula syntax into Obsidian Bases syntax.
 * It returns null when a formula cannot be converted, which tells the importer
 * to fall back to the value Airtable already computed.
 */

test('converts field references to note lookups', () => {
	assert.equal(convertAirtableFormulaToObsidian('{Name}'), 'note["Name"]');
});

test('resolves field IDs to field names when a map is supplied', () => {
	const map = new Map([['fldABC123', 'Due date']]);
	assert.equal(convertAirtableFormulaToObsidian('{fldABC123}', map), 'note["Due date"]');
});

test('leaves an unmapped field reference as-is', () => {
	assert.equal(convertAirtableFormulaToObsidian('{fldUnknown}', new Map()), 'note["fldUnknown"]');
});

test('converts & concatenation to +', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('{First} & " " & {Last}'),
		'note["First"] + " " + note["Last"]'
	);
});

test('does not convert & inside a string literal', () => {
	assert.equal(convertAirtableFormulaToObsidian('"A & B"'), '"A & B"');
});

test('converts single = to ==', () => {
	assert.equal(convertAirtableFormulaToObsidian('{Status} = "Done"'), 'note["Status"] == "Done"');
});

test('leaves !=, >= and <= alone', () => {
	assert.equal(convertAirtableFormulaToObsidian('{A} != {B}'), 'note["A"] != note["B"]');
	assert.equal(convertAirtableFormulaToObsidian('{A} >= {B}'), 'note["A"] >= note["B"]');
	assert.equal(convertAirtableFormulaToObsidian('{A} <= {B}'), 'note["A"] <= note["B"]');
});

test('does not convert = inside a string literal', () => {
	assert.equal(convertAirtableFormulaToObsidian('"a = b"'), '"a = b"');
});

// Regression: the function pattern is case-insensitive, so IF -> if used to
// re-match its own output every pass, burn through the iteration cap and get
// discarded. Global functions that keep their shape must still convert.
test('converts IF, which rewrites to a same-shaped global function', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('IF({Done}, "yes", "no")'),
		'if(note["Done"], "yes", "no")'
	);
});

test('converts nested calls inside IF', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('IF(AND({A},{B}), LOWER({C}), TRIM({D}))'),
		'if(((note["A"]).isTruthy() && (note["B"]).isTruthy()), (note["C"]).lower(), (note["D"]).trim())'
	);
});

test('converts string functions to methods', () => {
	assert.equal(convertAirtableFormulaToObsidian('LOWER({Name})'), '(note["Name"]).lower()');
	assert.equal(convertAirtableFormulaToObsidian('TRIM({Name})'), '(note["Name"]).trim()');
});

test('converts LEN to a property rather than a method', () => {
	assert.equal(convertAirtableFormulaToObsidian('LEN({Name})'), '(note["Name"]).length');
});

test('converts nested string functions inside out', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('LOWER(TRIM({Name}))'),
		'((note["Name"]).trim()).lower()'
	);
});

test('converts logical functions using isTruthy', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('AND({A}, {B})'),
		'((note["A"]).isTruthy() && (note["B"]).isTruthy())'
	);
	assert.equal(
		convertAirtableFormulaToObsidian('OR({A}, {B})'),
		'((note["A"]).isTruthy() || (note["B"]).isTruthy())'
	);
	assert.equal(convertAirtableFormulaToObsidian('NOT({A})'), '!(note["A"]).isTruthy()');
});

test('converts aggregations to array methods', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('SUM({A}, {B})'),
		'[note["A"], note["B"]].flat().sum()'
	);
	assert.equal(
		convertAirtableFormulaToObsidian('AVERAGE({A}, {B})'),
		'[note["A"], note["B"]].flat().mean()'
	);
});

test('distinguishes COUNT, COUNTA and COUNTALL', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('COUNT({A})'),
		'[note["A"]].flat().filter(value.isType("number")).length'
	);
	assert.equal(
		convertAirtableFormulaToObsidian('COUNTA({A})'),
		'[note["A"]].flat().filter(!value.isEmpty()).length'
	);
	assert.equal(convertAirtableFormulaToObsidian('COUNTALL({A})'), '[note["A"]].flat().length');
});

test('converts number functions', () => {
	assert.equal(convertAirtableFormulaToObsidian('ABS({N})'), '(note["N"]).abs()');
	assert.equal(convertAirtableFormulaToObsidian('INT({N})'), '(note["N"]).floor()');
	assert.equal(convertAirtableFormulaToObsidian('ROUND({Price}, 2)'), '(note["Price"]).round(2)');
	assert.equal(convertAirtableFormulaToObsidian('MOD({A}, 2)'), '(note["A"] % 2)');
});

test('converts date extraction to properties', () => {
	assert.equal(convertAirtableFormulaToObsidian('YEAR({Date})'), '(note["Date"]).year');
	assert.equal(convertAirtableFormulaToObsidian('MONTH({Date})'), '(note["Date"]).month');
});

test('converts DATEADD units to Obsidian duration shorthand', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('DATEADD({Date}, 7, "days")'),
		`(note["Date"]) + '7d'`
	);
	assert.equal(
		convertAirtableFormulaToObsidian('DATEADD({Date}, 3, "months")'),
		`(note["Date"]) + '3M'`
	);
});

test('converts date comparisons to operators', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('IS_BEFORE({A}, {B})'),
		'(note["A"] < note["B"])'
	);
	assert.equal(convertAirtableFormulaToObsidian('IS_AFTER({A}, {B})'), '(note["A"] > note["B"])');
});

test('converts array functions', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('ARRAYJOIN({Tags}, ", ")'),
		'(note["Tags"]).join(", ")'
	);
	assert.equal(convertAirtableFormulaToObsidian('ARRAYUNIQUE({Tags})'), '(note["Tags"]).unique()');
	assert.equal(
		convertAirtableFormulaToObsidian('ARRAYCOMPACT({Tags})'),
		'(note["Tags"]).filter(!value.isEmpty())'
	);
});

test('converts REGEX_MATCH to a regex literal with matches()', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('REGEX_MATCH({Email}, "@")'),
		'/@/.matches(note["Email"])'
	);
});

// Bases' replace() takes a regex as well as a plain string. The g flag matters:
// Airtable replaces every match, String.replace with a bare regex stops at the first.
test('converts REGEX_REPLACE, replacing globally', () => {
	assert.equal(
		convertAirtableFormulaToObsidian('REGEX_REPLACE({Name}, "[0-9]+", "")'),
		'(note["Name"]).replace(/[0-9]+/g, "")'
	);
});

test('leaves REGEX_EXTRACT unsupported, since replace() only substitutes', () => {
	assert.equal(convertAirtableFormulaToObsidian('REGEX_EXTRACT({A}, "x")'), null);
});

test('converts substring functions', () => {
	assert.equal(convertAirtableFormulaToObsidian('LEFT({Name}, 3)'), '(note["Name"]).slice(0, 3)');
	assert.equal(convertAirtableFormulaToObsidian('RIGHT({Name}, 3)'), '(note["Name"]).slice(-(3))');
	assert.equal(
		convertAirtableFormulaToObsidian('MID({Name}, 2, 3)'),
		'(note["Name"]).slice((2) - 1, (2) - 1 + (3))'
	);
});

test('converts literal-valued functions', () => {
	assert.equal(convertAirtableFormulaToObsidian('TRUE()'), 'true');
	assert.equal(convertAirtableFormulaToObsidian('FALSE()'), 'false');
	assert.equal(convertAirtableFormulaToObsidian('BLANK()'), '""');
	assert.equal(convertAirtableFormulaToObsidian('ERROR()'), '"!ERROR"');
});

test('returns null for functions Obsidian has no equivalent for', () => {
	// Bases has lower() and title() but nothing that uppercases
	assert.equal(convertAirtableFormulaToObsidian('UPPER({Name})'), null);
	assert.equal(convertAirtableFormulaToObsidian('SQRT({N})'), null);
	assert.equal(convertAirtableFormulaToObsidian('SWITCH({A}, 1, "a")'), null);
	assert.equal(convertAirtableFormulaToObsidian('FIND("x", {A})'), null);
});

test('returns null for an unrecognised function', () => {
	assert.equal(convertAirtableFormulaToObsidian('TOTALLY_MADE_UP({A})'), null);
});

test('never returns a formula still containing Airtable field-brace syntax', () => {
	const formulas = [
		'IF({Done}, LOWER({A}), TRIM({B}))',
		'{First} & " " & {Last}',
		'SUM({A}, {B})',
		'ARRAYJOIN(ARRAYUNIQUE({Tags}), ", ")',
	];
	for (const formula of formulas) {
		const converted = convertAirtableFormulaToObsidian(formula);
		assert.ok(converted !== null, `expected ${formula} to convert`);
		assert.ok(!converted!.includes('{'), `${formula} left brace syntax in: ${converted}`);
	}
});

test('handles a formula with no functions at all', () => {
	assert.equal(convertAirtableFormulaToObsidian('{Qty} * {Price}'), 'note["Qty"] * note["Price"]');
});
