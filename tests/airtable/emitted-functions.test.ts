import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertAirtableFormulaToObsidian } from '../../src/formats/airtable-api/formula-converter';

/**
 * Guard against emitting a function Obsidian Bases does not have.
 *
 * A converted formula is written into a .base file and only evaluated when the
 * user opens it, so a wrong function name fails silently at import time. The
 * converter previously emitted upper(), which Bases has no equivalent for -
 * Bases offers lower() and title() and nothing that uppercases.
 *
 * These are the names Bases exposes, from its function registry
 * (obsidian/src/app/model/func.ts) plus the properties reachable on values
 * (obsidian/src/app/model/values.ts). Update this list when Bases gains
 * functions; see https://obsidian.md/help/bases/functions
 */
const BASES_FUNCTIONS = new Set([
	'abs', 'asFile', 'asLink', 'ceil', 'contains', 'containsAll', 'containsAny',
	'date', 'duration', 'earliest', 'endsWith', 'escapeHTML', 'file', 'filter',
	'flat', 'floor', 'format', 'hasLink', 'hasProperty', 'hasTag', 'html',
	'icon', 'if', 'image', 'inFolder', 'isEmpty', 'isTruthy', 'isType', 'join',
	'keys', 'latest', 'link', 'linksTo', 'list', 'lower', 'map', 'matches',
	'max', 'mean', 'median', 'min', 'now', 'number', 'random', 'reduce',
	'relative', 'repeat', 'replace', 'reverse', 'round', 'slice', 'sort',
	'split', 'startsWith', 'stddev', 'sum', 'time', 'title', 'today', 'toFixed',
	'toString', 'trim', 'unique', 'values',
]);

const BASES_PROPERTIES = new Set([
	'length', 'year', 'month', 'day', 'hour', 'minute', 'second',
	'properties', 'ctime', 'mtime', 'name', 'folder',
]);

/**
 * Airtable formulas covering every mapping the converter can take, so anything
 * it emits shows up in the output being scanned.
 */
const FORMULAS = [
	'ABS({N})', 'CEILING({N})', 'FLOOR({N})', 'INT({N})', 'ROUND({N}, 2)', 'MOD({A}, 2)',
	'TRIM({S})', 'LOWER({S})', 'LEN({S})', 'REPT({S}, 2)', 'SUBSTITUTE({S}, "a", "b")',
	'LEFT({S}, 2)', 'RIGHT({S}, 2)', 'MID({S}, 2, 3)', 'REPLACE({S}, 1, 2, "x")',
	'CONCATENATE({A}, {B})', '{A} & {B}',
	'IF({A}, {B}, {C})', 'AND({A}, {B})', 'OR({A}, {B})', 'NOT({A})',
	'SUM({A}, {B})', 'AVERAGE({A}, {B})', 'COUNT({A})', 'COUNTA({A})', 'COUNTALL({A})',
	'MAX({A}, {B})', 'MIN({A}, {B})', 'VALUE({A})',
	'YEAR({D})', 'MONTH({D})', 'DAY({D})', 'HOUR({D})', 'MINUTE({D})', 'SECOND({D})',
	'DATETIME_FORMAT({D}, "YYYY")', 'DATESTR({D})', 'TIMESTR({D})', 'DATEADD({D}, 1, "days")',
	'IS_BEFORE({A}, {B})', 'IS_AFTER({A}, {B})', 'IS_SAME({A}, {B})',
	'ARRAYJOIN({L}, ",")', 'ARRAYFLATTEN({L})', 'ARRAYUNIQUE({L})', 'ARRAYCOMPACT({L})',
	'REGEX_MATCH({S}, "x")', 'REGEX_REPLACE({S}, "x", "y")', 'NOW()', 'TODAY()', 'TRUE()', 'FALSE()', 'BLANK()', 'ERROR()',
];

/** Identifiers that are syntax rather than functions */
const NOT_FUNCTIONS = new Set(['note', 'value', 'true', 'false']);

/**
 * Names used as `foo(` or `.foo(`, and properties used as `.foo`.
 *
 * Matches the identifier and whatever follows in one pass. A negative lookahead
 * would backtrack to a shorter prefix in order to succeed, reporting "ab" for
 * ".abs()".
 */
function namesUsedIn(formula: string): { calls: string[], properties: string[] } {
	// String and regex literals hold no function names
	const code = formula
		.replace(/"[^"]*"/g, '""')
		.replace(/'[^']*'/g, "''")
		.replace(/\/[^/]*\/(?=\.)/g, '//');

	const calls: string[] = [];
	const properties: string[] = [];

	for (const m of code.matchAll(/(\.)?\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(\()?/g)) {
		const [, dot, name, paren] = m;
		if (NOT_FUNCTIONS.has(name)) continue;
		if (paren) calls.push(name);
		else if (dot) properties.push(name);
	}

	return { calls, properties };
}

test('every function the converter emits exists in Bases', () => {
	const unknown = new Map<string, string>();

	for (const formula of FORMULAS) {
		const converted = convertAirtableFormulaToObsidian(formula);
		if (converted === null) continue; // deliberately unsupported

		const { calls, properties } = namesUsedIn(converted);
		for (const name of calls) {
			if (!BASES_FUNCTIONS.has(name)) unknown.set(name, formula);
		}
		for (const name of properties) {
			if (!BASES_FUNCTIONS.has(name) && !BASES_PROPERTIES.has(name)) unknown.set(name, formula);
		}
	}

	assert.deepEqual(
		[...unknown.entries()],
		[],
		`converter emitted names Bases does not have: ${[...unknown].map(([n, f]) => `${n} (from ${f})`).join(', ')}`
	);
});

test('UPPER is not converted, since Bases cannot uppercase', () => {
	assert.equal(convertAirtableFormulaToObsidian('UPPER({Name})'), null);
});
