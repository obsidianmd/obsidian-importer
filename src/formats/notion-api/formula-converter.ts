/**
 * Formula converter for Notion to Obsidian Bases
 * 
 * This converter intelligently transforms Notion's function-based syntax
 * to Obsidian Base's syntax.
 * 
 * Key transformations:
 * - prop("Name") -> note["Name"]
 * - length(x) -> (x).length (property access)
 * - abs(x) -> (x).abs() (method call)
 * - contains(x, y) -> (x).contains(y) (method call)
 * - unique(x) -> (x).unique() (method call)
 * - Global functions stay as-is: max(), min(), if()
 * 
 * Important notes:
 * - length is a PROPERTY (x.length), not a function
 * - unique() is a METHOD (x.unique()), not a global function
 * - sum() and average() are NOT supported in Obsidian Bases
 * - median() is NOT supported in Obsidian Bases
 * - Many date/time functions are not supported
 * 
 * Based on:
 * - Notion: https://www.notion.com/help/formula-syntax
 * - Obsidian: https://help.obsidian.md/bases/functions
 */

import { ConversionInfo } from './types';

const FUNCTION_MAPPING: Record<string, ConversionInfo> = {
	// Global functions (same in both Notion and Obsidian)
	'if': { type: 'global' },
	'max': { type: 'global' },
	'min': { type: 'global' },
	'now': { type: 'global' }, // Both have now()
	'today': { type: 'global' }, // Both have today()
	
	// Function name mapping (different names, same functionality)
	// Notion: toNumber(x), Obsidian: number(x)
	'toNumber': { type: 'global', obsidianName: 'number' },
	
	// Notion global functions that need conversion to Obsidian methods/properties
	// In Notion: length(x), In Obsidian: x.length
	'length': { type: 'property', obsidianName: 'length', argCount: 1 },
	
	// In Notion: format(x), In Obsidian: x.toString()
	'format': { type: 'method', obsidianName: 'toString', argCount: 1 },
	
	// In Notion: contains(x, y), In Obsidian: x.contains(y)
	'contains': { type: 'method', obsidianName: 'contains', argCount: 2 },
	
	// In Notion: lower(x), In Obsidian: x.lower()
	'lower': { type: 'method', obsidianName: 'lower', argCount: 1 },
	'upper': { type: 'method', obsidianName: 'upper', argCount: 1 },
	
	// In Notion: replace(x, old, new), In Obsidian: x.replace(old, new)
	'replace': { type: 'method', obsidianName: 'replace', argCount: 3 },
	
	// In Notion: substring(x, start, end?), In Obsidian: x.slice(start, end)
	'substring': { type: 'method', obsidianName: 'slice', argCount: 3 }, // argCount 3 but end is optional
	
	// In Notion: reverse(x), In Obsidian: x.reverse()
	'reverse': { type: 'method', obsidianName: 'reverse', argCount: 1 },
	'sort': { type: 'method', obsidianName: 'sort', argCount: 1 },
	'unique': { type: 'method', obsidianName: 'unique', argCount: 1 },
	
	// In Notion: flat(x), In Obsidian: x.flat()
	'flat': { type: 'method', obsidianName: 'flat', argCount: 1 },
	
	// In Notion: join(x, sep), In Obsidian: x.join(sep)
	'join': { type: 'method', obsidianName: 'join', argCount: 2 },
	
	// In Notion: includes(x, val), In Obsidian: x.contains(val)
	'includes': { type: 'method', obsidianName: 'contains', argCount: 2 },
	
	// In Notion: slice(x, start, end), In Obsidian: x.slice(start, end)
	'slice': { type: 'method', obsidianName: 'slice', argCount: 3 },
	
	// List iteration functions - need special handling for variable names
	// In Notion: map(list, current + 1), In Obsidian: list.map(value + 1)
	'map': { type: 'method', obsidianName: 'map', argCount: 2 },
	// In Notion: filter(list, current > 1), In Obsidian: list.filter(value > 1)
	'filter': { type: 'method', obsidianName: 'filter', argCount: 2 },
	
	// Number functions - In Notion: abs(x), In Obsidian: x.abs()
	'abs': { type: 'method', obsidianName: 'abs', argCount: 1 },
	'ceil': { type: 'method', obsidianName: 'ceil', argCount: 1 },
	'floor': { type: 'method', obsidianName: 'floor', argCount: 1 },
	'round': { type: 'method', obsidianName: 'round', argCount: 1 },
	
	// Date functions - In Notion: formatDate(x, fmt), In Obsidian: x.format(fmt)
	'formatDate': { type: 'method', obsidianName: 'format', argCount: 2 },
	
	// Date parsing and extraction
	// parseDate is a special case that maps to Obsidian's date() global function
	'parseDate': { type: 'global', obsidianName: 'date' },
	
	// Notion's date() extracts day of month (1-31), Obsidian uses .day property
	// This is handled specially in conversion logic to avoid conflict with date() global function
	// Note: We need to distinguish between parseDate() (which becomes date()) and date() (which becomes .day)
	// We mark date() as 'property' type so it's recognized as convertible
	'date': { type: 'property', obsidianName: 'day', argCount: 1 },
	'year': { type: 'property', obsidianName: 'year', argCount: 1 },
	'month': { type: 'property', obsidianName: 'month', argCount: 1 },
	'hour': { type: 'property', obsidianName: 'hour', argCount: 1 },
	'minute': { type: 'property', obsidianName: 'minute', argCount: 1 },
	
	// List accessors - convert to array notation
	'at': { type: 'operator', argCount: 2 }, // at(list, index) -> list[index]
	'first': { type: 'operator', argCount: 1 }, // first(list) -> list[0]
	'last': { type: 'operator', argCount: 1 }, // last(list) -> list[-1]
	
	// Operators - convert to operator syntax
	'add': { type: 'operator', argCount: 2 }, // add(a, b) -> a + b
	'subtract': { type: 'operator', argCount: 2 }, // subtract(a, b) -> a - b
	'multiply': { type: 'operator', argCount: 2 }, // multiply(a, b) -> a * b
	'divide': { type: 'operator', argCount: 2 }, // divide(a, b) -> a / b
	'mod': { type: 'operator', argCount: 2 }, // mod(a, b) -> a % b
	'equal': { type: 'operator', argCount: 2 }, // equal(a, b) -> a == b
	'unequal': { type: 'operator', argCount: 2 }, // unequal(a, b) -> a != b
	// Note: pow() is NOT supported - Obsidian has no exponentiation operator
};

/**
 * Check if a Notion formula can be converted to Obsidian
 */
export function canConvertFormula(notionFormula: string): boolean {
	if (!notionFormula || typeof notionFormula !== 'string') {
		return false;
	}
	
	// List of Notion functions we cannot convert to Obsidian Bases
	const unsupportedFunctions = [
		// Math functions not in Obsidian Bases
		'sqrt', 'exp', 'ln', 'log10', 'log2', 'sign', 'cbrt', 'pi', 'e', 'pow',
		
		// Statistical/aggregation functions not in Obsidian Bases
		'sum', 'mean', 'median', // Obsidian Bases does not support these
		
		// String functions not in Obsidian Bases or with incompatible syntax
		'replaceAll', 'match',
		// Note: 'substring' is supported and converted to slice() method
		// Note: 'concat' for lists is not supported in Obsidian (no list concatenation method)
		'repeat', 'split', 'trim', // These exist in Obsidian but Notion uses global functions
		'style', 'unstyle', // Notion-specific formatting
		// Note: Notion doesn't have startsWith, endsWith, containsAny, containsAll, title, isEmpty as global functions
		// Note: 'test' is supported and converted to /pattern/.matches(string)
		
		// Boolean/conditional functions
		'empty', 'ifs', // Not in Obsidian Bases
		// Note: 'equal' and 'unequal' are supported and converted to == and != operators
		
		// Date/time functions (most are incompatible)
		// Note: 'now' and 'today' are supported and mapped
		// Note: 'formatDate' is supported and mapped to 'format' method
		// Note: 'parseDate' is supported and mapped to 'date' global function
		// Note: 'date', 'year', 'month', 'hour', 'minute' are handled specially and converted to properties
		// Note: 'dateAdd' and 'dateSubtract' are supported and converted to date arithmetic
		'dateBetween', 'dateRange', 'dateStart', 'dateEnd',
		'timestamp', 'fromTimestamp', // fromTimestamp not supported - date() doesn't accept numbers
		'day', 'week', // day = day of week (1-7), week = ISO week number - no Obsidian equivalent
		
		// Person functions
		'name', 'email',
		
		// Advanced list functions
		// Note: 'map' and 'filter' are supported but need variable name conversion (current -> value)
		'find', 'findIndex', 'some', 'every',
		
		// Conversion functions
		// Note: 'toNumber' is supported and mapped to 'number'
		// Note: 'format' is supported and mapped to 'toString'
		
		// Variable binding
		'let', 'lets',
		
		// Notion-specific functions
		'id', // Notion page ID function
		'link', // Notion link() has different parameters than Obsidian link()
	];
	
	// Extract function names
	const functionPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
	const matches = notionFormula.matchAll(functionPattern);
	
	for (const match of matches) {
		const funcName = match[1];
		
		// Skip prop() - we handle this
		if (funcName === 'prop') {
			continue;
		}
		
		// Check if we can convert it
		if (FUNCTION_MAPPING[funcName]) {
			continue;
		}
		
		// Check if it's unsupported
		if (unsupportedFunctions.includes(funcName)) {
			return false;
		}
		
		// Unknown function
		return false;
	}
	
	return true;
}

/**
 * Convert a Notion formula to Obsidian Bases formula syntax
 * 
 * @param notionFormula - The formula expression (may contain placeholders)
 * @param properties - The database properties schema (to resolve property IDs to names)
 */
/**
 * Convert Notion formula to Obsidian Dataview formula
 * @param properties - Using 'any' because property configurations have different structures by type
 */
export function convertNotionFormulaToObsidian(
	notionFormula: string,
	properties?: Record<string, any>
): string | null {
	let result = notionFormula;
	
	// Step 0: Replace Notion API 2025-09-03 placeholders with prop() calls
	// Format: {{notion:block_property:{property_id}:{data_source_id}:{some_id}}}
	if (properties) {
		result = result.replace(
			/\{\{notion:block_property:([^:]+):[^}]+\}\}/g,
			(match, propertyId) => {
				// Find the property name by ID
				for (const [, prop] of Object.entries(properties)) {
					if (prop.id === propertyId) {
						return `prop("${prop.name}")`;
					}
				}
				// If not found, keep the placeholder
				return match;
			}
		);
	}
	
	if (!canConvertFormula(result)) {
		return null;
	}
	
	// Step 1: Convert prop() to note[]
	result = result.replace(
		/prop\s*\(\s*"([^"]+)"\s*\)/g,
		(match, propName) => {
			return `note["${propName}"]`;
		}
	);
	
	// Step 1.5: Replace parseDate(...) with placeholders that don't contain parentheses
	// This allows outer date() functions to be matched and converted
	// We store the arguments and replace them back at the end
	const parseDatePlaceholders: string[] = [];
	result = result.replace(/parseDate\s*\(([^()]*)\)/g, (match, args) => {
		const index = parseDatePlaceholders.length;
		parseDatePlaceholders.push(args);
		return `__PARSEDATE_${index}__`;
	});
	
	// Step 2: Convert functions to methods/properties/operators
	// We need to be careful about nested function calls
	// Process from innermost to outermost
	let changed = true;
	let maxIterations = 20; // Prevent infinite loops
	let iterations = 0;
	
	while (changed && iterations < maxIterations) {
		changed = false;
		iterations++;
		
		// Match function calls with their arguments
		// This regex matches: functionName(arg1, arg2, ...)
		// Use negative lookbehind to avoid matching method calls like .contains()
		// We only want to match standalone function calls, not methods
		const funcPattern = /(?<![.\w])([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^()]*)\)/g;
		
		result = result.replace(funcPattern, (match, funcName, argsStr) => {
			// Skip parseDate placeholders - they will be converted back at the end
			if (funcName.startsWith('__PARSEDATE_')) {
				return match;
			}
		
			// Special case: Notion's test() function -> Obsidian's /pattern/.matches(string)
			// In Notion: test(string, pattern)
			// In Obsidian: /pattern/.matches(string)
			if (funcName === 'test') {
				changed = true;
				const args = parseArguments(argsStr);
				if (args.length === 2) {
					const stringArg = args[0];
					const patternArg = args[1];
				
					// Remove quotes from pattern if it's a string literal
					let pattern = patternArg.trim();
					if ((pattern.startsWith('"') && pattern.endsWith('"')) || 
				    (pattern.startsWith('\'') && pattern.endsWith('\''))) {
						pattern = pattern.slice(1, -1);
					}
				
					// Convert: test(string, pattern) -> /pattern/.matches(string)
					return `/${pattern}/.matches(${stringArg})`;
				}
				// Fallback: keep as-is if wrong number of arguments
				return match;
			}
		
			// Special case: Notion's dateAdd() function -> Obsidian date arithmetic
			// In Notion: dateAdd(date, amount, unit)
			// In Obsidian: date + 'amount+unit' (e.g., now() + '1d')
			if (funcName === 'dateAdd') {
				changed = true;
				const result = convertDateArithmetic(argsStr, '+');
				if (result) {
					return result;
				}
				// Fallback: keep as-is if wrong number of arguments
				return match;
			}
		
			// Special case: Notion's dateSubtract() function -> Obsidian date arithmetic
			// In Notion: dateSubtract(date, amount, unit)
			// In Obsidian: date - 'amount+unit' (e.g., now() - '1d')
			if (funcName === 'dateSubtract') {
				changed = true;
				const result = convertDateArithmetic(argsStr, '-');
				if (result) {
					return result;
				}
				// Fallback: keep as-is if wrong number of arguments
				return match;
			}
		
			// Special case: Notion's fromTimestamp() function
			// Note: Obsidian's date() function does NOT accept numeric timestamps
			// date() signature: date(input: string | date): date
			// Therefore, fromTimestamp() cannot be converted
			if (funcName === 'fromTimestamp') {
				// Keep as unsupported - will be caught by canConvertFormula
				return match;
			}
		
			const mapping = FUNCTION_MAPPING[funcName];
			
			if (!mapping) {
				// Not a convertible function, keep as-is
				return match;
			}
			
			if (mapping.type === 'global') {
				// Global functions - may need renaming
				if (mapping.obsidianName) {
					// Function needs to be renamed (e.g., toNumber -> number, parseDate -> date)
					changed = true;
					const args = parseArguments(argsStr);
					return `${mapping.obsidianName}(${args.join(', ')})`;
				}
				// Otherwise stay as-is (e.g., if(), max(), min(), now(), today())
				return match;
			}
			
			// Parse arguments
			const args = parseArguments(argsStr);
			
			if (mapping.type === 'property') {
				// Convert: length(x) -> (x).length
				// Properties are accessed without parentheses
				if (args.length === 1) {
					changed = true;
					return `(${args[0]}).${mapping.obsidianName}`;
				}
			}
			
			if (mapping.type === 'method') {
				// Convert: abs(x) -> (x).abs()
				// Convert: contains(x, y) -> (x).contains(y)
				// Convert: unique(x) -> (x).unique()
				if (args.length >= 1) {
					changed = true;
					const obj = args[0];
					let methodArgs = args.slice(1);
			
					// Special handling for map() and filter(): replace 'current' with 'value'
					if (funcName === 'map' || funcName === 'filter') {
						methodArgs = methodArgs.map(arg => {
							// Replace 'current' with 'value' in the expression
							// Use word boundaries to avoid replacing parts of other identifiers
							return arg.replace(/\bcurrent\b/g, 'value');
						});
					}
			
					if (methodArgs.length > 0) {
						return `(${obj}).${mapping.obsidianName}(${methodArgs.join(', ')})`;
					}
					else {
						return `(${obj}).${mapping.obsidianName}()`;
					}
				}
			}
			
			if (mapping.type === 'operator') {
				changed = true;
				
				// Special cases
				if (funcName === 'at' && args.length === 2) {
					// at(list, index) -> (list)[index]
					return `(${args[0]})[${args[1]}]`;
				}
				if (funcName === 'first' && args.length === 1) {
					// first(list) -> (list)[0]
					return `(${args[0]})[0]`;
				}
				if (funcName === 'last' && args.length === 1) {
					// last(list) -> (list)[-1]
					return `(${args[0]})[-1]`;
				}
				
				// Binary operators
				if (args.length === 2) {
					const operatorMap: Record<string, string> = {
						'add': '+',
						'subtract': '-',
						'multiply': '*',
						'divide': '/',
						'mod': '%',
						'equal': '==',
						'unequal': '!=',
						// Note: 'pow' is NOT included - Obsidian has no exponentiation operator
					};
					const op = operatorMap[funcName];
					if (op) {
						return `(${args[0]} ${op} ${args[1]})`;
					}
				}
			}
			
			// Fallback: keep as-is
			return match;
		});
	}
	
	// Step 3: Replace parseDate placeholders with date() calls
	// This happens AFTER all date() functions have been converted to .day property
	// So date(parseDate("2024-11-03")) becomes date(__PARSEDATE_0__) -> (__PARSEDATE_0__).day -> (date("2024-11-03")).day
	for (let i = 0; i < parseDatePlaceholders.length; i++) {
		result = result.replace(
			new RegExp(`__PARSEDATE_${i}__`, 'g'),
			`date(${parseDatePlaceholders[i]})`
		);
	}
	
	return result;
}

/**
 * Parse comma-separated arguments
 * This is a simple parser that doesn't handle nested parentheses well,
 * but works for the common cases after we've processed inner functions
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
 * Convert Notion date arithmetic functions to Obsidian syntax
 * @param argsStr - Arguments string from the function call
 * @param operator - The arithmetic operator ('+' for dateAdd, '-' for dateSubtract)
 * @returns Converted Obsidian date arithmetic expression, or null if invalid
 */
function convertDateArithmetic(argsStr: string, operator: '+' | '-'): string | null {
	const args = parseArguments(argsStr);
	if (args.length !== 3) {
		return null;
	}
	
	const dateArg = args[0];
	const amountArg = args[1];
	const unitArg = args[2];
	
	// Remove quotes from unit if it's a string literal
	let unit = unitArg.trim();
	if ((unit.startsWith('"') && unit.endsWith('"')) || 
	    (unit.startsWith('\'') && unit.endsWith('\''))) {
		unit = unit.slice(1, -1);
	}
	
	// Map Notion units to Obsidian units
	const unitMap: Record<string, string> = {
		'years': 'y',
		'quarters': 'q',
		'months': 'M',
		'weeks': 'w',
		'days': 'd',
		'hours': 'h',
		'minutes': 'm',
	};
	const obsidianUnit = unitMap[unit] || unit;
	
	// Convert: date ± 'amount+unit'
	return `(${dateArg}) ${operator} '${amountArg}${obsidianUnit}'`;
}

/**
 * Get the formula expression from a Notion formula property config
 * @param formulaConfig - Using 'any' because Notion's formula property config structure is complex
 *                        and may vary between API versions. We access the expression property safely.
 */
export function getNotionFormulaExpression(formulaConfig: any): string | null {
	if (!formulaConfig || typeof formulaConfig !== 'object') {
		return null;
	}
	
	// In Notion API, formula config has an 'expression' field
	return formulaConfig.expression || null;
}
