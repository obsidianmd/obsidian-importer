/**
 * Formula converter for Notion to Obsidian
 * Attempts to convert Notion formulas to Obsidian base formula syntax
 * Falls back to text representation if conversion is not possible
 */

/**
 * Notion functions that can be directly mapped to Obsidian
 */
const DIRECT_MAPPING: Record<string, string> = {
	// Math functions
	'abs': 'abs',
	'ceil': 'ceil',
	'floor': 'floor',
	'max': 'max',
	'min': 'min',
	'round': 'round',
	'sqrt': 'sqrt',
	
	// String functions
	'length': 'length',
	'replace': 'replace',
	'contains': 'contains',
	'empty': 'length',  // empty(x) -> length(x) == 0
	
	// Date functions
	'now': 'now',
	
	// Logical functions
	'if': 'if',
	'and': 'and',
	'or': 'or',
	'not': 'not',
};

/**
 * Notion functions that are NOT supported in Obsidian
 */
const UNSUPPORTED_FUNCTIONS = [
	// Math
	'cbrt', 'exp', 'ln', 'log10', 'log2', 'sign',
	
	// String
	'concat', 'format', 'join', 'replaceAll', 'slice', 'split', 'test',
	
	// Date
	'dateSubtract', 'dateBetween', 'formatDate', 'fromTimestamp', 'timestamp',
	'minute', 'hour', 'day', 'date', 'month', 'year',
	
	// Logical/Comparison
	'equal', 'unequal', 'larger', 'largerEq', 'smaller', 'smallerEq',
	
	// Other
	'toNumber', 'id', 'style',
];

/**
 * Check if a Notion formula can be converted to Obsidian formula
 * Returns true if the formula only uses supported functions
 */
export function canConvertFormula(notionFormula: string): boolean {
	if (!notionFormula || typeof notionFormula !== 'string') {
		return false;
	}
	
	// Extract function names from the formula
	// Match pattern: functionName(
	const functionPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
	const matches = notionFormula.matchAll(functionPattern);
	
	for (const match of matches) {
		const funcName = match[1].toLowerCase();
		
		// Check if this function is unsupported
		if (UNSUPPORTED_FUNCTIONS.includes(funcName)) {
			return false;
		}
		
		// Check if this function is not in our direct mapping
		// (might be a property reference, which is OK)
		if (!DIRECT_MAPPING[funcName] && !isPropertyReference(funcName)) {
			return false;
		}
	}
	
	return true;
}

/**
 * Check if a name is likely a property reference rather than a function
 * Property references in Notion use the format: prop("Property Name")
 */
function isPropertyReference(name: string): boolean {
	return name === 'prop';
}

/**
 * Convert a Notion formula to Obsidian formula syntax
 * Returns null if conversion is not possible
 */
export function convertNotionFormulaToObsidian(notionFormula: string): string | null {
	if (!canConvertFormula(notionFormula)) {
		return null;
	}
	
	let obsidianFormula = notionFormula;
	
	// Convert property references
	// Notion: prop("Property Name")
	// Obsidian: note["Property Name"] or just PropertyName if no spaces
	obsidianFormula = obsidianFormula.replace(
		/prop\s*\(\s*"([^"]+)"\s*\)/g,
		(match, propName) => {
			// If property name has spaces or special chars, use bracket notation
			if (/[\s\-\.]/.test(propName)) {
				return `note["${propName}"]`;
			}
			return propName;
		}
	);
	
	// Convert comparison operators
	// Notion uses functions like equal(), larger(), etc.
	// Obsidian uses operators like ==, >, etc.
	obsidianFormula = convertComparisonOperators(obsidianFormula);
	
	// Convert empty() to length() == 0
	obsidianFormula = obsidianFormula.replace(
		/empty\s*\(([^)]+)\)/g,
		'length($1) == 0'
	);
	
	// Convert dateAdd if present
	// Notion: dateAdd(date, number, "unit")
	// Obsidian: dateAdd(date, number, "unit") - same syntax!
	
	return obsidianFormula;
}

/**
 * Convert Notion comparison functions to Obsidian operators
 */
function convertComparisonOperators(formula: string): string {
	let result = formula;
	
	// equal(a, b) -> a == b
	result = result.replace(
		/equal\s*\(([^,]+),\s*([^)]+)\)/g,
		'($1 == $2)'
	);
	
	// unequal(a, b) -> a != b
	result = result.replace(
		/unequal\s*\(([^,]+),\s*([^)]+)\)/g,
		'($1 != $2)'
	);
	
	// larger(a, b) -> a > b
	result = result.replace(
		/larger\s*\(([^,]+),\s*([^)]+)\)/g,
		'($1 > $2)'
	);
	
	// largerEq(a, b) -> a >= b
	result = result.replace(
		/largerEq\s*\(([^,]+),\s*([^)]+)\)/g,
		'($1 >= $2)'
	);
	
	// smaller(a, b) -> a < b
	result = result.replace(
		/smaller\s*\(([^,]+),\s*([^)]+)\)/g,
		'($1 < $2)'
	);
	
	// smallerEq(a, b) -> a <= b
	result = result.replace(
		/smallerEq\s*\(([^,]+),\s*([^)]+)\)/g,
		'($1 <= $2)'
	);
	
	return result;
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

