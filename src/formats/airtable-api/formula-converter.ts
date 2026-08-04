/**
 * Formula converter for Airtable to Obsidian Bases
 *
 * This converter intelligently transforms Airtable's function-based syntax
 * to Obsidian Base's syntax.
 *
 * Key transformations:
 * - {Field Name} -> note["Field Name"]
 * - & (string concatenation) -> + operator
 * - = (equality) -> == operator (avoiding !=, >=, <=)
 * - AND(a, b) -> (a).isTruthy() && (b).isTruthy(), OR(a, b) -> (a).isTruthy() || (b).isTruthy(), NOT(a) -> !(a).isTruthy()
 * - SUM(a, b, c) -> [a, b, c].flat().sum()
 * - COUNT(a, b, c) -> [a, b, c].flat().filter(value.isType("number")).length (only numbers)
 * - COUNTA(a, b, c) -> [a, b, c].flat().filter(!value.isEmpty()).length (non-empty)
 * - COUNTALL(a, b, c) -> [a, b, c].flat().length (all elements)
 * - ARRAYJOIN(array, sep) -> array.join(sep)
 * - LEN(x) -> x.length (property, not method)
 * - LOWER(x) -> x.lower() (method; Bases has no uppercase equivalent)
 * - REGEX_MATCH(str, pattern) -> /pattern/.matches(str)
 * - REGEX_REPLACE(str, pattern, x) -> str.replace(/pattern/g, x)
 * - ERROR() -> "!ERROR", BLANK() -> ""
 * - Many functions convert from global functions to methods/properties
 *
 * Important notes:
 * - Obsidian uses 'value' as the fixed parameter name in filter/map, not arrow functions:
 *   Example: array.filter(value > 2) NOT array.filter(v => v > 2)
 * - Regex support is /pattern/.matches(string) and string.replace(/pattern/, "x").
 *   REGEX_EXTRACT has no equivalent: replace() only substitutes, and its
 *   replacement is a literal string rather than a callback.
 * - ERROR() and BLANK() are converted to literal values:
 *   ERROR() -> "!ERROR" (string literal to indicate error)
 *   BLANK() -> "" (empty string)
 * - String search functions FIND and SEARCH are NOT supported (no indexOf method)
 * - SUBSTITUTE with 4 arguments (index parameter) is NOT supported, only 3-arg version works
 *
 * Obsidian global functions (only 7):
 * - if(condition, trueValue, falseValue)
 * - now()
 * - today()
 * - max(a, b, c, ...) - maximum value
 * - min(a, b, c, ...) - minimum value
 * - number(value) - type conversion
 * - date(string) - date parsing
 *
 * Coverage:
 * - Total items in Airtable: 98
 *   * 84 functions (mapped in FUNCTION_MAPPING)
 *   * 11 operators (+, -, *, /, &, >, =, !=, >=, <, <=) - handled natively or in Step 2
 *   * 2 literals ('\n', "") - string literals, no conversion needed
 *   * 1 syntax ({Field Name}) - handled in Step 1
 *
 * Based on:
 * - Airtable: https://support.airtable.com/docs/formula-field-reference
 * - Obsidian: https://help.obsidian.md/bases/functions
 */

import { findMatchingParen, mapOutsideStrings, parseArguments } from '../../formula-utils';

// Regex patterns (compiled once, reuse with lastIndex reset)
const FUNCTION_CALL_PATTERN = /([A-Z_][A-Z0-9_]*)\s*\(/gi;
const FUNCTION_CALL_PATTERN_STRICT = /(?<![.\w])([A-Z_][A-Z0-9_]*)\s*\(/gi;

interface ConversionInfo {
	type: 'global' | 'method' | 'property' | 'operator' | 'unsupported' | 'special';
	obsidianName?: string;
}

const FUNCTION_MAPPING: Record<string, ConversionInfo> = {
	// ============================================================
	// Global functions (same in both Airtable and Obsidian)
	// ============================================================
	'IF': { type: 'global', obsidianName: 'if' },
	'NOW': { type: 'global', obsidianName: 'now' },
	'TODAY': { type: 'global', obsidianName: 'today' },
	'MAX': { type: 'global', obsidianName: 'max' }, // max(a, b, c, ...)
	'MIN': { type: 'global', obsidianName: 'min' }, // min(a, b, c, ...)

	// ============================================================
	// Logical operators (convert to operators)
	// ============================================================
	'AND': { type: 'operator' }, // AND(a, b, ...) -> (a).isTruthy() && (b).isTruthy() && ...
	'OR': { type: 'operator' }, // OR(a, b, ...) -> (a).isTruthy() || (b).isTruthy() || ...
	'NOT': { type: 'operator' }, // NOT(a) -> !(a).isTruthy()

	// ============================================================
	// Number functions -> Methods
	// ============================================================
	'ABS': { type: 'method', obsidianName: 'abs' },
	'CEILING': { type: 'special' }, // CEILING(value) -> ceil, CEILING(value, significance) -> unsupported
	'FLOOR': { type: 'special' }, // FLOOR(value) -> floor, FLOOR(value, significance) -> unsupported
	'ROUND': { type: 'method', obsidianName: 'round' }, // ROUND(value, precision)
	'ROUNDUP': { type: 'unsupported' }, // Obsidian ceil() doesn't support precision parameter
	'ROUNDDOWN': { type: 'unsupported' }, // Obsidian floor() doesn't support precision parameter
	'INT': { type: 'method', obsidianName: 'floor' }, // INT = floor
	'EVEN': { type: 'unsupported' }, // Return the nearest even number
	'ODD': { type: 'unsupported' }, // Return the nearest odd number

	// Aggregation functions - special handling for those not global in Obsidian
	// Note: SUM/AVERAGE/COUNT need special handling - converted to array methods
	'SUM': { type: 'operator' }, // SUM(a, b, ...) -> [a, b, ...].flat().sum()
	'AVERAGE': { type: 'operator' }, // AVERAGE(a, b, ...) -> [a, b, ...].flat().mean()
	'COUNT': { type: 'operator' }, // COUNT(a, b, ...) -> [a, b, ...].flat().filter(value.isType("number")).length (only numbers)
	'COUNTA': { type: 'operator' }, // COUNTA(a, b, ...) -> [a, b, ...].flat().filter(!value.isEmpty()).length (non-empty)
	'COUNTALL': { type: 'operator' }, // COUNTALL(a, b, ...) -> [a, b, ...].flat().length (all elements)

	// ============================================================
	// String functions
	// ============================================================
	// String methods
	'TRIM': { type: 'method', obsidianName: 'trim' },
	// Bases has lower() and title() but no uppercase equivalent
	'UPPER': { type: 'unsupported' },
	'LOWER': { type: 'method', obsidianName: 'lower' },
	'LEN': { type: 'property', obsidianName: 'length' },

	// String manipulation - need special handling
	'CONCATENATE': { type: 'operator' }, // Convert to + operator
	'LEFT': { type: 'operator' }, // LEFT(str, n) -> str.slice(0, n)
	'RIGHT': { type: 'operator' }, // RIGHT(str, n) -> str.slice(-n)
	'MID': { type: 'operator' }, // MID(str, start, count) -> str.slice(start-1, start-1+count)
	'FIND': { type: 'unsupported' }, // No indexOf() in Obsidian
	'SEARCH': { type: 'unsupported' }, // No indexOf() in Obsidian
	'SUBSTITUTE': { type: 'operator' }, // SUBSTITUTE(str, old, new, index?) -> str.replace(old, new) - index not supported
	'REPLACE': { type: 'operator' }, // REPLACE(str, start, count, replacement)
	'REPT': { type: 'method', obsidianName: 'repeat' }, // REPT(str, count) -> str.repeat(count)
	'ENCODE_URL_COMPONENT': { type: 'unsupported' },

	// ============================================================
	// Date/Time extraction -> Properties
	// ============================================================
	'YEAR': { type: 'property', obsidianName: 'year' },
	'MONTH': { type: 'property', obsidianName: 'month' },
	'DAY': { type: 'property', obsidianName: 'day' },
	'HOUR': { type: 'property', obsidianName: 'hour' },
	'MINUTE': { type: 'property', obsidianName: 'minute' },
	'SECOND': { type: 'property', obsidianName: 'second' },
	'WEEKDAY': { type: 'unsupported' }, // Obsidian doesn't support weekday property
	'WEEKNUM': { type: 'unsupported' }, // ISO week number

	// Date/Time formatting and manipulation
	'DATETIME_FORMAT': { type: 'method', obsidianName: 'format' }, // DATETIME_FORMAT(date, format) -> date.format(format)
	'DATETIME_PARSE': { type: 'unsupported' }, // Returns date type, format is fixed, locale not supported
	'DATEADD': { type: 'operator' }, // DATEADD(date, amount, unit) -> date + 'amount+unit'
	'DATETIME_DIFF': { type: 'unsupported' }, // Complex date diff
	'DATESTR': { type: 'special' }, // DATESTR(date) -> date.format("YYYY-MM-DD")
	'TIMESTR': { type: 'method', obsidianName: 'time' }, // TIMESTR(date) -> date.time()

	// Date comparison functions
	'IS_BEFORE': { type: 'operator' }, // IS_BEFORE(date1, date2) -> date1 < date2
	'IS_AFTER': { type: 'operator' }, // IS_AFTER(date1, date2) -> date1 > date2
	'IS_SAME': { type: 'operator' }, // IS_SAME(date1, date2) -> date1 == date2
	'TONOW': { type: 'unsupported' }, // Duration from date to now
	'FROMNOW': { type: 'unsupported' }, // Duration from now to date

	// Date utilities
	'SET_TIMEZONE': { type: 'unsupported' },
	'SET_LOCALE': { type: 'unsupported' },
	'WORKDAY': { type: 'unsupported' },
	'WORKDAY_DIFF': { type: 'unsupported' },

	// ============================================================
	// Array functions -> Methods
	// ============================================================
	'ARRAYJOIN': { type: 'method', obsidianName: 'join' },
	'ARRAYFLATTEN': { type: 'method', obsidianName: 'flat' },
	'ARRAYUNIQUE': { type: 'method', obsidianName: 'unique' },
	'ARRAYCOMPACT': { type: 'operator' }, // Remove null/undefined/empty -> array.filter(!value.isEmpty())

	// ============================================================
	// Regular expression functions
	// ============================================================
	'REGEX_MATCH': { type: 'operator' }, // REGEX_MATCH(str, regex) -> /regex/.matches(str)
	'REGEX_EXTRACT': { type: 'unsupported' }, // Obsidian only has matches(), no extract
	'REGEX_REPLACE': { type: 'operator' }, // REGEX_REPLACE(s, re, x) -> s.replace(/re/g, x)

	// ============================================================
	// Mathematical functions (not supported in Obsidian)
	// ============================================================
	'SQRT': { type: 'unsupported' },
	'EXP': { type: 'unsupported' },
	'LOG': { type: 'unsupported' },
	'POWER': { type: 'unsupported' },
	'MOD': { type: 'operator' }, // MOD(a, b) -> a % b

	// ============================================================
	// Special Airtable functions
	// ============================================================
	'RECORD_ID': { type: 'unsupported' }, // No equivalent in Obsidian
	'CREATED_TIME': { type: 'special' }, // CREATED_TIME() -> file.ctime
	'LAST_MODIFIED_TIME': { type: 'special' }, // LAST_MODIFIED_TIME() -> file.mtime, with args -> unsupported

	// ============================================================
	// Type/value functions
	// ============================================================
	'VALUE': { type: 'global', obsidianName: 'number' }, // Convert to number
	'T': { type: 'unsupported' }, // Returns text or empty string
	'BLANK': { type: 'operator' }, // BLANK() -> ""
	'ERROR': { type: 'operator' }, // ERROR() -> "!ERROR"
	'ISERROR': { type: 'unsupported' },
	// Note: TRUE() and FALSE() are handled in Step 3 (converted to true/false literals)

	// Switch statement
	'SWITCH': { type: 'unsupported' }, // Complex control flow
	'XOR': { type: 'unsupported' }, // Exclusive OR
};

/**
 * Check if an Airtable formula can be converted to Obsidian
 */
function canConvertFormula(airtableFormula: string): boolean {
	if (!airtableFormula || typeof airtableFormula !== 'string') {
		return false;
	}

	// Extract function names (case-insensitive)
	const matches = airtableFormula.matchAll(FUNCTION_CALL_PATTERN);

	for (const match of matches) {
		const funcName = match[1].toUpperCase();

		// Skip functions handled in Step 3 as literal conversions
		if (funcName === 'TRUE' || funcName === 'FALSE' || funcName === 'ERROR' || funcName === 'BLANK') {
			continue;
		}

		const mapping = FUNCTION_MAPPING[funcName];
		if (!mapping) {
			// Unknown function
			return false;
		}

		if (mapping.type === 'unsupported') {
			return false;
		}
	}

	return true;
}

/**
 * Convert an Airtable formula to Obsidian Bases formula syntax
 * @param airtableFormula - The Airtable formula expression
 * @param fieldIdToNameMap - Map of field IDs to field names (for resolving field references)
 */
export function convertAirtableFormulaToObsidian(
	airtableFormula: string,
	fieldIdToNameMap?: Map<string, string>
): string | null {
	let result = airtableFormula;

	if (!canConvertFormula(result)) {
		return null;
	}

	// Step 1: Convert field references {Field ID or Name} -> note["Field Name"]
	// Airtable formulas use field IDs internally, but we need to convert to field names
	result = result.replace(
		/\{([^}]+)\}/g,
		(_, fieldIdOrName) => {
			// Try to resolve field ID to field name
			const fieldName = fieldIdToNameMap?.get(fieldIdOrName) || fieldIdOrName;
			return `note["${fieldName}"]`;
		}
	);

	// Step 2: Convert string concatenation operator & to +
	// Need to be careful not to replace & inside strings
	result = convertConcatenationOperator(result);

	// Step 2.5: Convert Airtable's = operator to == for equality comparison
	// Need to be careful not to replace = inside strings or != operator
	result = convertEqualityOperator(result);

	// Step 3: Convert TRUE() and FALSE() to lowercase
	result = result.replace(/\bTRUE\s*\(\s*\)/gi, 'true');
	result = result.replace(/\bFALSE\s*\(\s*\)/gi, 'false');

	// Step 3.5: Convert ERROR() and BLANK() to literal values
	result = result.replace(/\bERROR\s*\(\s*\)/gi, '"!ERROR"');
	result = result.replace(/\bBLANK\s*\(\s*\)/gi, '""');

	// Step 4: Convert functions to methods/properties/operators
	let changed = true;
	let maxIterations = 20;
	let iterations = 0;

	while (changed && iterations < maxIterations) {
		changed = false;
		iterations++;

		// Find function calls (case-insensitive)
		FUNCTION_CALL_PATTERN_STRICT.lastIndex = 0;

		let match;
		let foundMatch = false;

		while ((match = FUNCTION_CALL_PATTERN_STRICT.exec(result)) !== null && !foundMatch) {
			const funcName = match[1].toUpperCase();
			const start = match.index;
			const openParenPos = match.index + match[0].length - 1;

			// Find matching closing parenthesis
			const closeParenPos = findMatchingParen(result, openParenPos);
			if (closeParenPos === -1) {
				continue;
			}

			const end = closeParenPos + 1;
			const argsStr = result.substring(openParenPos + 1, closeParenPos);

			let replacement: string | null = null;

			// Special case handlers
			replacement = handleSpecialCases(funcName, argsStr);

			// If no special case, use mapping
			if (replacement === null) {
				const mapping = FUNCTION_MAPPING[funcName];

				if (mapping) {
					if (mapping.type === 'global') {
						const args = parseArguments(argsStr);
						const targetName = mapping.obsidianName || funcName.toLowerCase();
						replacement = `${targetName}(${args.join(', ')})`;
					}
					else if (mapping.type === 'property') {
						const args = parseArguments(argsStr);
						if (args.length === 1) {
							replacement = `(${args[0]}).${mapping.obsidianName}`;
						}
					}
					else if (mapping.type === 'method') {
						const [obj, ...methodArgs] = parseArguments(argsStr);
						if (obj !== undefined) {
							replacement = `(${obj}).${mapping.obsidianName}(${methodArgs.join(', ')})`;
						}
					}
				}
			}

			// Apply replacement.
			// The function pattern is case-insensitive, so a global function that
			// keeps its shape (IF -> if, MAX -> max) re-matches its own output.
			// Treating a no-op rewrite as progress would loop until the iteration
			// cap and discard an otherwise valid formula.
			if (replacement !== null && replacement !== result.substring(start, end)) {
				changed = true;
				foundMatch = true;
				result = result.substring(0, start) + replacement + result.substring(end);
				break;
			}
		}
	}

	// The loop rewrites one call per pass. If it was still making progress when it
	// hit the cap, the formula is only half-translated and would emit a mix of
	// Airtable and Bases syntax - bail out and let the caller use static values.
	if (changed) {
		console.warn(`[Airtable] Formula too deeply nested to convert: ${airtableFormula}`);
		return null;
	}

	return result;
}

/** Strip surrounding quotes from a literal argument */
function unquote(arg: string): string {
	const trimmed = arg.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * Handle special case conversions
 */
function handleSpecialCases(funcName: string, argsStr: string): string | null {
	const args = parseArguments(argsStr);

	switch (funcName) {
		// Logical operators
		// AND(a, b, c, ...) -> (a).isTruthy() && (b).isTruthy() && ...
		// Use isTruthy() to handle nullValue correctly
		case 'AND':
			if (args.length > 0) {
				const truthyArgs = args.map(arg => `(${arg}).isTruthy()`);
				return `(${truthyArgs.join(' && ')})`;
			}
			break;

		// OR(a, b, c, ...) -> (a).isTruthy() || (b).isTruthy() || ...
		// Use isTruthy() to handle nullValue correctly
		case 'OR':
			if (args.length > 0) {
				const truthyArgs = args.map(arg => `(${arg}).isTruthy()`);
				return `(${truthyArgs.join(' || ')})`;
			}
			break;

		// NOT(a) -> !(a).isTruthy()
		// Use isTruthy() to handle nullValue correctly (nullValue.isTruthy() returns false)
		case 'NOT':
			if (args.length === 1) {
				return `!(${args[0]}).isTruthy()`;
			}
			break;

		// CEILING(value) -> value.ceil()
		// CEILING(value, significance) -> unsupported (Obsidian ceil() doesn't support significance)
		case 'CEILING':
			if (args.length === 1) {
				return `(${args[0]}).ceil()`;
			}
			// 2 arguments (with significance) - not supported
			return `"!UNSUPPORTED:CEILING with significance"`;

		// FLOOR(value) -> value.floor()
		// FLOOR(value, significance) -> unsupported (Obsidian floor() doesn't support significance)
		case 'FLOOR':
			if (args.length === 1) {
				return `(${args[0]}).floor()`;
			}
			// 2 arguments (with significance) - not supported
			return `"!UNSUPPORTED:FLOOR with significance"`;

		// DATESTR(date) -> date.format("YYYY-MM-DD")
		case 'DATESTR':
			if (args.length === 1) {
				return `(${args[0]}).format("YYYY-MM-DD")`;
			}
			break;

		// CREATED_TIME() -> file.ctime
		case 'CREATED_TIME':
			if (args.length === 0) {
				return 'file.ctime';
			}
			break;

		// LAST_MODIFIED_TIME() -> file.mtime
		// LAST_MODIFIED_TIME({field}) -> unsupported (can't track field-level modification time)
		case 'LAST_MODIFIED_TIME':
			if (args.length === 0) {
				return 'file.mtime';
			}
			// With arguments (specific field modification time) - not supported
			return `"!UNSUPPORTED:LAST_MODIFIED_TIME with field"`;

		// Aggregation functions
		// SUM(a, b, c, ...) -> [a, b, c].flat().sum()
		case 'SUM':
			if (args.length > 0) {
				return `[${args.join(', ')}].flat().sum()`;
			}
			break;

		// AVERAGE(a, b, c, ...) -> [a, b, c].flat().mean()
		case 'AVERAGE':
			if (args.length > 0) {
				return `[${args.join(', ')}].flat().mean()`;
			}
			break;

		// COUNT(a, b, c, ...) -> [a, b, c].flat().filter(value.isType("number")).length
		// Only counts numeric items
		case 'COUNT':
			if (args.length > 0) {
				return `[${args.join(', ')}].flat().filter(value.isType("number")).length`;
			}
			break;

		// COUNTA(a, b, c, ...) -> [a, b, c].flat().filter(!value.isEmpty()).length
		// Counts non-empty values (excludes null/undefined/empty)
		case 'COUNTA':
			if (args.length > 0) {
				return `[${args.join(', ')}].flat().filter(!value.isEmpty()).length`;
			}
			break;

		// COUNTALL(a, b, c, ...) -> [a, b, c].flat().length
		// Counts all elements including blanks
		case 'COUNTALL':
			if (args.length > 0) {
				return `[${args.join(', ')}].flat().length`;
			}
			break;

		// CONCATENATE(a, b, c, ...) -> a + b + c + ...
		case 'CONCATENATE':
			if (args.length > 0) {
				return `(${args.join(' + ')})`;
			}
			break;

		// LEFT(str, n) -> str.slice(0, n)
		case 'LEFT':
			if (args.length === 2) {
				return `(${args[0]}).slice(0, ${args[1]})`;
			}
			break;

		// RIGHT(str, n) -> str.slice(-n)
		case 'RIGHT':
			if (args.length === 2) {
				return `(${args[0]}).slice(-(${args[1]}))`;
			}
			break;

		// MID(str, start, count) -> str.slice(start-1, start-1+count)
		// Note: Airtable uses 1-based indexing, Obsidian uses 0-based
		case 'MID':
			if (args.length === 3) {
				return `(${args[0]}).slice((${args[1]}) - 1, (${args[1]}) - 1 + (${args[2]}))`;
			}
			break;

			// Note: FIND and SEARCH are not supported because Obsidian doesn't have indexOf()

		// SUBSTITUTE(str, old, new, index?) -> str.replace(old, new)
		// Note: index parameter (4th arg) for nth occurrence is not supported
		case 'SUBSTITUTE':
			if (args.length === 3) {
				// Simple replace (all occurrences with g flag)
				return `(${args[0]}).replace(${args[1]}, ${args[2]})`;
			}
			// If 4 args (with index parameter), cannot convert - return null to use static value
			break;

		// REPLACE(str, start, count, replacement) -> manual slicing and concatenation
		case 'REPLACE':
			if (args.length === 4) {
				// str.slice(0, start-1) + replacement + str.slice(start-1+count)
				return `(${args[0]}).slice(0, (${args[1]}) - 1) + (${args[3]}) + (${args[0]}).slice((${args[1]}) - 1 + (${args[2]}))`;
			}
			break;

		// MOD(a, b) -> a % b
		case 'MOD':
			if (args.length === 2) {
				return `(${args[0]} % ${args[1]})`;
			}
			break;

		// DATEADD(date, amount, unit) -> date + 'amount+unit'
		case 'DATEADD':
			if (args.length === 3) {
				let unit = args[2].trim();
				// Remove quotes
				if ((unit.startsWith('"') && unit.endsWith('"')) ||
				    (unit.startsWith('\'') && unit.endsWith('\''))) {
					unit = unit.slice(1, -1);
				}

				// Map Airtable units to Obsidian units
				const unitMap: Record<string, string> = {
					'years': 'y',
					'year': 'y',
					'months': 'M',
					'month': 'M',
					'weeks': 'w',
					'week': 'w',
					'days': 'd',
					'day': 'd',
					'hours': 'h',
					'hour': 'h',
					'minutes': 'm',
					'minute': 'm',
					'seconds': 's',
					'second': 's',
				};
				const obsidianUnit = unitMap[unit.toLowerCase()] || unit;

				return `(${args[0]}) + '${args[1]}${obsidianUnit}'`;
			}
			break;

		// IS_BEFORE(date1, date2) -> date1 < date2
		case 'IS_BEFORE':
			if (args.length === 2) {
				return `(${args[0]} < ${args[1]})`;
			}
			break;

		// IS_AFTER(date1, date2) -> date1 > date2
		case 'IS_AFTER':
			if (args.length === 2) {
				return `(${args[0]} > ${args[1]})`;
			}
			break;

		// IS_SAME(date1, date2, unit?) -> date1 == date2
		// Note: unit parameter for comparing specific components not supported
		case 'IS_SAME':
			if (args.length >= 2) {
				return `(${args[0]} == ${args[1]})`;
			}
			break;

		// ARRAYCOMPACT(array) -> array.filter(!value.isEmpty())
		case 'ARRAYCOMPACT':
			if (args.length === 1) {
				return `(${args[0]}).filter(!value.isEmpty())`;
			}
			break;

		// REGEX_MATCH(str, regex) -> /regex/.matches(str)
		case 'REGEX_MATCH':
			if (args.length === 2) {
				const pattern = unquote(args[1]);
				return `/${pattern}/.matches(${args[0]})`;
			}
			break;

		// REGEX_REPLACE(string, regex, replacement) -> string.replace(/regex/g, replacement)
		// Bases' replace() takes a regex as well as a plain string. The g flag is
		// needed because Airtable replaces every match, while String.replace with
		// a bare regex would stop after the first.
		case 'REGEX_REPLACE':
			if (args.length === 3) {
				const pattern = unquote(args[1]);
				return `(${args[0]}).replace(/${pattern}/g, ${args[2]})`;
			}
			break;
	}

	return null;
}

/**
 * Convert & concatenation operator to + operator
 * Careful not to replace & inside strings
 */
function convertConcatenationOperator(formula: string): string {
	return mapOutsideStrings(formula, char => char === '&' ? '+' : char);
}

/**
 * Convert Airtable's = operator to == for equality comparison
 * Need to avoid replacing:
 * - = inside strings
 * - != (not equal)
 * - >= (greater than or equal)
 * - <= (less than or equal)
 */
function convertEqualityOperator(formula: string): string {
	return mapOutsideStrings(formula, (char, i, source) => {
		if (char !== '=') return char;

		// Leave !=, >=, <= and an existing == alone
		const prevChar = source[i - 1] ?? '';
		if (prevChar === '!' || prevChar === '>' || prevChar === '<' || prevChar === '=') return char;
		if (source[i + 1] === '=') return char;

		return '==';
	});
}

