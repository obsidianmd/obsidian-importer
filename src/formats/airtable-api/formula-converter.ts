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
 * - UPPER(x) -> x.upper() (method)
 * - REGEX_MATCH(str, pattern) -> /pattern/.matches(str)
 * - ERROR() -> "!ERROR", BLANK() -> ""
 * - Many functions convert from global functions to methods/properties
 * 
 * Important notes:
 * - Obsidian uses 'value' as the fixed parameter name in filter/map, not arrow functions:
 *   Example: array.filter(value > 2) NOT array.filter(v => v > 2)
 * - Obsidian only supports one regex function: /pattern/.matches(string)
 *   REGEX_EXTRACT and REGEX_REPLACE are NOT supported
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

import type { ImportContext } from '../../main';

interface ConversionInfo {
	type: 'global' | 'method' | 'property' | 'operator' | 'unsupported' | 'special';
	obsidianName?: string;
	argCount?: number;
	note?: string;
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
	'ABS': { type: 'method', obsidianName: 'abs', argCount: 1 },
	'CEILING': { type: 'special' }, // CEILING(value) -> ceil, CEILING(value, significance) -> unsupported
	'FLOOR': { type: 'special' }, // FLOOR(value) -> floor, FLOOR(value, significance) -> unsupported
	'ROUND': { type: 'method', obsidianName: 'round', argCount: 2 }, // ROUND(value, precision)
	'ROUNDUP': { type: 'unsupported' }, // Obsidian ceil() doesn't support precision parameter
	'ROUNDDOWN': { type: 'unsupported' }, // Obsidian floor() doesn't support precision parameter
	'INT': { type: 'method', obsidianName: 'floor', argCount: 1 }, // INT = floor
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
	'TRIM': { type: 'method', obsidianName: 'trim', argCount: 1 },
	'UPPER': { type: 'method', obsidianName: 'upper', argCount: 1 },
	'LOWER': { type: 'method', obsidianName: 'lower', argCount: 1 },
	'LEN': { type: 'property', obsidianName: 'length', argCount: 1 },
	
	// String manipulation - need special handling
	'CONCATENATE': { type: 'operator' }, // Convert to + operator
	'LEFT': { type: 'operator' }, // LEFT(str, n) -> str.slice(0, n)
	'RIGHT': { type: 'operator' }, // RIGHT(str, n) -> str.slice(-n)
	'MID': { type: 'operator' }, // MID(str, start, count) -> str.slice(start-1, start-1+count)
	'FIND': { type: 'unsupported' }, // No indexOf() in Obsidian
	'SEARCH': { type: 'unsupported' }, // No indexOf() in Obsidian
	'SUBSTITUTE': { type: 'operator' }, // SUBSTITUTE(str, old, new, index?) -> str.replace(old, new) - index not supported
	'REPLACE': { type: 'operator' }, // REPLACE(str, start, count, replacement)
	'REPT': { type: 'method', obsidianName: 'repeat', argCount: 2 }, // REPT(str, count) -> str.repeat(count)
	'ENCODE_URL_COMPONENT': { type: 'unsupported' },
	
	// ============================================================
	// Date/Time extraction -> Properties
	// ============================================================
	'YEAR': { type: 'property', obsidianName: 'year', argCount: 1 },
	'MONTH': { type: 'property', obsidianName: 'month', argCount: 1 },
	'DAY': { type: 'property', obsidianName: 'day', argCount: 1 },
	'HOUR': { type: 'property', obsidianName: 'hour', argCount: 1 },
	'MINUTE': { type: 'property', obsidianName: 'minute', argCount: 1 },
	'SECOND': { type: 'property', obsidianName: 'second', argCount: 1 },
	'WEEKDAY': { type: 'unsupported' }, // Obsidian doesn't support weekday property
	'WEEKNUM': { type: 'unsupported' }, // ISO week number
	
	// Date/Time formatting and manipulation
	'DATETIME_FORMAT': { type: 'method', obsidianName: 'format', argCount: 2 }, // DATETIME_FORMAT(date, format) -> date.format(format)
	'DATETIME_PARSE': { type: 'unsupported' }, // Returns date type, format is fixed, locale not supported
	'DATEADD': { type: 'operator' }, // DATEADD(date, amount, unit) -> date + 'amount+unit'
	'DATETIME_DIFF': { type: 'unsupported' }, // Complex date diff
	'DATESTR': { type: 'special' }, // DATESTR(date) -> date.format("YYYY-MM-DD")
	'TIMESTR': { type: 'method', obsidianName: 'time', argCount: 1 }, // TIMESTR(date) -> date.time()
	
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
	'ARRAYJOIN': { type: 'method', obsidianName: 'join', argCount: 2 },
	'ARRAYFLATTEN': { type: 'method', obsidianName: 'flat', argCount: 1 },
	'ARRAYUNIQUE': { type: 'method', obsidianName: 'unique', argCount: 1 },
	'ARRAYCOMPACT': { type: 'operator' }, // Remove null/undefined/empty -> array.filter(!value.isEmpty())
	
	// ============================================================
	// Regular expression functions
	// ============================================================
	'REGEX_MATCH': { type: 'operator' }, // REGEX_MATCH(str, regex) -> /regex/.matches(str)
	'REGEX_EXTRACT': { type: 'unsupported' }, // Obsidian only has matches(), no extract
	'REGEX_REPLACE': { type: 'unsupported' }, // Obsidian only has matches(), no replace
	
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
export function canConvertFormula(airtableFormula: string): boolean {
	if (!airtableFormula || typeof airtableFormula !== 'string') {
		return false;
	}
	
	// Extract function names (case-insensitive)
	const functionPattern = /([A-Z_][A-Z0-9_]*)\s*\(/gi;
	const matches = airtableFormula.matchAll(functionPattern);
	
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
 * @param ctx - Import context
 */
export function convertAirtableFormulaToObsidian(
	airtableFormula: string,
	fieldIdToNameMap?: Map<string, string>,
	ctx?: ImportContext
): string | null {
	let result = airtableFormula;
	
	if (!canConvertFormula(result)) {
		return null;
	}
	
	// Step 1: Convert field references {Field ID or Name} -> note["Field Name"]
	// Airtable formulas use field IDs internally, but we need to convert to field names
	result = result.replace(
		/\{([^}]+)\}/g,
		(match, fieldIdOrName) => {
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
		const funcNamePattern = /(?<![.\w])([A-Z_][A-Z0-9_]*)\s*\(/gi;
		
		let match;
		let foundMatch = false;
		
		while ((match = funcNamePattern.exec(result)) !== null && !foundMatch) {
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
						const args = parseArguments(argsStr);
						if (args.length >= 1) {
							const obj = args[0];
							const methodArgs = args.slice(1);
							if (methodArgs.length > 0) {
								replacement = `(${obj}).${mapping.obsidianName}(${methodArgs.join(', ')})`;
							}
							else {
								replacement = `(${obj}).${mapping.obsidianName}()`;
							}
						}
					}
				}
			}
			
			// Apply replacement
			if (replacement !== null) {
				changed = true;
				foundMatch = true;
				result = result.substring(0, start) + replacement + result.substring(end);
				break;
			}
		}
	}
	
	return result;
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
				let pattern = args[1].trim();
				if ((pattern.startsWith('"') && pattern.endsWith('"')) || 
				    (pattern.startsWith('\'') && pattern.endsWith('\''))) {
					pattern = pattern.slice(1, -1);
				}
				return `/${pattern}/.matches(${args[0]})`;
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
	let result = '';
	let inString = false;
	let stringChar = '';
	
	for (let i = 0; i < formula.length; i++) {
		const char = formula[i];
		const prevChar = i > 0 ? formula[i - 1] : '';
		
		if (inString) {
			result += char;
			if (char === stringChar && prevChar !== '\\') {
				inString = false;
			}
		}
		else {
			if (char === '"' || char === '\'') {
				inString = true;
				stringChar = char;
				result += char;
			}
			else if (char === '&') {
				// Replace & with +
				result += '+';
			}
			else {
				result += char;
			}
		}
	}
	
	return result;
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
	let result = '';
	let inString = false;
	let stringChar = '';
	
	for (let i = 0; i < formula.length; i++) {
		const char = formula[i];
		const prevChar = i > 0 ? formula[i - 1] : '';
		const nextChar = i < formula.length - 1 ? formula[i + 1] : '';
		
		if (inString) {
			result += char;
			if (char === stringChar && prevChar !== '\\') {
				inString = false;
			}
		}
		else {
			if (char === '"' || char === '\'') {
				inString = true;
				stringChar = char;
				result += char;
			}
			else if (char === '=') {
				// Check if it's part of !=, >=, <=, or already ==
				if (prevChar === '!' || prevChar === '>' || prevChar === '<' || prevChar === '=') {
					// Part of !=, >=, <=, or ==, keep as is
					result += char;
				}
				else if (nextChar === '=') {
					// Already ==, keep as is
					result += char;
				}
				else {
					// Single = for equality, convert to ==
					result += '==';
				}
			}
			else {
				result += char;
			}
		}
	}
	
	return result;
}

/**
 * Parse comma-separated arguments
 */
function parseArguments(argsStr: string): string[] {
	if (!argsStr.trim()) {
		return [];
	}
	
	const args: string[] = [];
	let current = '';
	let depth = 0;
	let inString = false;
	let stringChar = '';
	
	for (let i = 0; i < argsStr.length; i++) {
		const char = argsStr[i];
		
		if (inString) {
			current += char;
			if (char === stringChar && argsStr[i - 1] !== '\\') {
				inString = false;
			}
		}
		else {
			if (char === '"' || char === '\'') {
				inString = true;
				stringChar = char;
				current += char;
			}
			else if (char === '(' || char === '[') {
				depth++;
				current += char;
			}
			else if (char === ')' || char === ']') {
				depth--;
				current += char;
			}
			else if (char === ',' && depth === 0) {
				args.push(current.trim());
				current = '';
			}
			else {
				current += char;
			}
		}
	}
	
	if (current.trim()) {
		args.push(current.trim());
	}
	
	return args;
}

/**
 * Find the matching closing parenthesis for an opening parenthesis
 */
function findMatchingParen(str: string, openPos: number): number {
	let depth = 1;
	let inString = false;
	let stringChar = '';
	
	for (let i = openPos + 1; i < str.length; i++) {
		const char = str[i];
		const prevChar = i > 0 ? str[i - 1] : '';
		
		if (inString) {
			if (char === stringChar && prevChar !== '\\') {
				inString = false;
			}
		}
		else {
			if (char === '"' || char === '\'') {
				inString = true;
				stringChar = char;
			}
			else if (char === '(') {
				depth++;
			}
			else if (char === ')') {
				depth--;
				if (depth === 0) {
					return i;
				}
			}
		}
	}
	
	return -1;
}

