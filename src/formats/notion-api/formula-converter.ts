/**
 * Formula converter for Notion to Obsidian Base
 * 
 * This converter intelligently transforms Notion's function-based syntax
 * to Obsidian's method-based syntax.
 * 
 * Key transformations:
 * - prop("Name") -> note["Name"]
 * - abs(x) -> (x).abs()
 * - length(x) -> (x).length
 * - contains(x, y) -> (x).contains(y)
 * - reverse(x) -> (x).reverse()
 * 
 * Based on:
 * - Notion: https://www.notion.com/help/formula-syntax
 * - Obsidian: https://help.obsidian.md/bases/functions
 */

/**
 * Function mapping: Notion function name -> Obsidian conversion info
 */
interface ConversionInfo {
	type: 'method' | 'property' | 'global' | 'operator';
	obsidianName?: string;
	argCount?: number; // Expected number of arguments
}

const FUNCTION_MAPPING: Record<string, ConversionInfo> = {
	// Global functions (same in both)
	'if': { type: 'global' },
	'max': { type: 'global' },
	'min': { type: 'global' },
	'now': { type: 'global' },
	
	// Number methods
	'abs': { type: 'method', obsidianName: 'abs', argCount: 1 },
	'ceil': { type: 'method', obsidianName: 'ceil', argCount: 1 },
	'floor': { type: 'method', obsidianName: 'floor', argCount: 1 },
	'round': { type: 'method', obsidianName: 'round', argCount: 1 },
	'toFixed': { type: 'method', obsidianName: 'toFixed', argCount: 2 },
	
	// String properties
	'length': { type: 'property', obsidianName: 'length', argCount: 1 },
	
	// String methods
	'contains': { type: 'method', obsidianName: 'contains', argCount: 2 },
	'slice': { type: 'method', obsidianName: 'slice', argCount: 3 }, // text, start, end (end optional)
	'split': { type: 'method', obsidianName: 'split', argCount: 2 },
	'replace': { type: 'method', obsidianName: 'replace', argCount: 3 },
	'lower': { type: 'method', obsidianName: 'lower', argCount: 1 },
	'upper': { type: 'method', obsidianName: 'upper', argCount: 1 },
	'trim': { type: 'method', obsidianName: 'trim', argCount: 1 },
	'startsWith': { type: 'method', obsidianName: 'startsWith', argCount: 2 },
	'endsWith': { type: 'method', obsidianName: 'endsWith', argCount: 2 },
	
	// List methods
	'reverse': { type: 'method', obsidianName: 'reverse', argCount: 1 },
	'sort': { type: 'method', obsidianName: 'sort', argCount: 1 },
	'unique': { type: 'method', obsidianName: 'unique', argCount: 1 },
	'flat': { type: 'method', obsidianName: 'flat', argCount: 1 },
	'flatten': { type: 'method', obsidianName: 'flat', argCount: 1 }, // Notion uses flatten, Obsidian uses flat
	'join': { type: 'method', obsidianName: 'join', argCount: 2 },
	'includes': { type: 'method', obsidianName: 'includes', argCount: 2 },
	'containsAny': { type: 'method', obsidianName: 'containsAny', argCount: 2 },
	'containsAll': { type: 'method', obsidianName: 'containsAll', argCount: 2 },
	
	// Special cases
	'empty': { type: 'method', obsidianName: 'isEmpty', argCount: 1 },
	'isEmpty': { type: 'method', obsidianName: 'isEmpty', argCount: 1 },
	
	// List accessors - convert to array notation
	'at': { type: 'operator', argCount: 2 }, // at(list, index) -> list[index]
	'first': { type: 'operator', argCount: 1 }, // first(list) -> list[0]
	'last': { type: 'operator', argCount: 1 }, // last(list) -> list[-1]
	
	// Operators - convert to operator syntax
	'add': { type: 'operator', argCount: 2 }, // add(a, b) -> a + b
	'subtract': { type: 'operator', argCount: 2 }, // subtract(a, b) -> a - b
	'multiply': { type: 'operator', argCount: 2 }, // multiply(a, b) -> a * b
	'divide': { type: 'operator', argCount: 2 }, // divide(a, b) -> a / b
	'pow': { type: 'operator', argCount: 2 }, // pow(a, b) -> a ^ b
	'mod': { type: 'operator', argCount: 2 }, // mod(a, b) -> a % b
};

/**
 * Check if a Notion formula can be converted to Obsidian
 */
export function canConvertFormula(notionFormula: string): boolean {
	if (!notionFormula || typeof notionFormula !== 'string') {
		return false;
	}
	
	// List of functions we cannot convert
	const unsupportedFunctions = [
		// Math functions not in Obsidian
		'sqrt', 'exp', 'ln', 'log10', 'log2', 'sign', 'cbrt',
		
		// String functions not in Obsidian
		'substring', 'concat', 'format', 'replaceAll', 'test', 'match',
		
		// Date functions
		'dateAdd', 'dateSubtract', 'dateBetween', 'formatDate',
		'fromTimestamp', 'timestamp',
		'minute', 'hour', 'day', 'date', 'month', 'year',
		'time', 'relative', 'duration',
		
		// Advanced list functions with different syntax
		'filter', 'map', 'find', 'some', 'every',
		
		// Other
		'ifs', 'let', 'lets', 'toNumber', 'toString', 'id', 'style', 'link',
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
 * Convert a Notion formula to Obsidian Base formula syntax
 * 
 * @param notionFormula - The formula expression (may contain placeholders)
 * @param properties - The database properties schema (to resolve property IDs to names)
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
				for (const [key, prop] of Object.entries(properties)) {
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
		// We use a simple approach: match function calls without nested parentheses in args
		const funcPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^()]*)\)/g;
		
		result = result.replace(funcPattern, (match, funcName, argsStr) => {
			const mapping = FUNCTION_MAPPING[funcName];
			
			if (!mapping) {
				// Not a convertible function, keep as-is
				return match;
			}
			
			if (mapping.type === 'global') {
				// Global functions stay as-is
				return match;
			}
			
			// Parse arguments
			const args = parseArguments(argsStr);
			
			if (mapping.type === 'property') {
				// Convert: length(x) -> (x).length
				if (args.length === 1) {
					changed = true;
					return `(${args[0]}).${mapping.obsidianName}`;
				}
			}
			
			if (mapping.type === 'method') {
				// Convert: abs(x) -> (x).abs()
				// Convert: contains(x, y) -> (x).contains(y)
				if (args.length >= 1) {
					changed = true;
					const obj = args[0];
					const methodArgs = args.slice(1);
					
					if (methodArgs.length > 0) {
						return `(${obj}).${mapping.obsidianName}(${methodArgs.join(', ')})`;
					} else {
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
						'pow': '^',
						'mod': '%',
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
		} else {
			if (char === '"' || char === "'") {
				inString = true;
				stringChar = char;
				current += char;
			} else if (char === '(' || char === '[') {
				depth++;
				current += char;
			} else if (char === ')' || char === ']') {
				depth--;
				current += char;
			} else if (char === ',' && depth === 0) {
				args.push(current.trim());
				current = '';
			} else {
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
 * Get the formula expression from a Notion formula property config
 */
export function getNotionFormulaExpression(formulaConfig: any): string | null {
	if (!formulaConfig || typeof formulaConfig !== 'object') {
		return null;
	}
	
	// In Notion API, formula config has an 'expression' field
	return formulaConfig.expression || null;
}
