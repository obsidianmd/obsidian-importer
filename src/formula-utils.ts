/**
 * String scanning shared by the formula converters.
 *
 * Both the Airtable and Notion importers translate a vendor formula language
 * into Obsidian Bases syntax. The vocabularies differ entirely, but the parsing
 * underneath is the same problem: walk an expression while keeping track of
 * string literals, so a comma, parenthesis, or operator inside "..." is never
 * mistaken for syntax. Those parts live here so a fix to quote or escape
 * handling reaches both converters.
 */

/**
 * Rewrite a formula character by character, leaving string literals untouched.
 *
 * @param source - Expression to rewrite
 * @param replace - Called for each character outside a string literal; return
 *   the text to emit in its place. `index` is the position in `source`, so a
 *   rule can look at neighbouring characters.
 */
export function mapOutsideStrings(
	source: string,
	replace: (char: string, index: number, source: string) => string
): string {
	let result = '';
	let inString = false;
	let stringChar = '';

	for (let i = 0; i < source.length; i++) {
		const char = source[i];

		if (inString) {
			result += char;
			if (char === stringChar && source[i - 1] !== '\\') {
				inString = false;
			}
		}
		else if (char === '"' || char === '\'') {
			inString = true;
			stringChar = char;
			result += char;
		}
		else {
			result += replace(char, i, source);
		}
	}

	return result;
}

/**
 * Split a function call's argument list on top-level commas.
 *
 * Commas inside nested calls, brackets, or string literals belong to those, not
 * to this argument list.
 */
export function parseArguments(argsStr: string): string[] {
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
 * Find the closing parenthesis matching the one at `openPos`.
 *
 * @returns Its index, or -1 if the expression is unbalanced.
 */
export function findMatchingParen(str: string, openPos: number): number {
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

	return -1; // No matching parenthesis found
}
