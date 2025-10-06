type FormulaASTNode =
	| LiteralNode
	| PropertyRefNode
	| FunctionCallNode
	| BinaryOpNode
	| UnaryOpNode;

interface LiteralNode {
	type: 'literal';
	valueType: 'string' | 'number' | 'boolean';
	value: string | number | boolean;
}

interface PropertyRefNode {
	type: 'property';
	name: string;
}

interface FunctionCallNode {
	type: 'function';
	name: string;
	args: FormulaASTNode[];
}

interface BinaryOpNode {
	type: 'binary';
	operator: '+' | '-' | '*' | '/' | '==' | '!=' | '>' | '<' | '>=' | '<=' | 'and' | 'or';
	left: FormulaASTNode;
	right: FormulaASTNode;
}

interface UnaryOpNode {
	type: 'unary';
	operator: 'not' | '-';
	operand: FormulaASTNode;
}

interface FormulaParseResult {
	success: boolean;
	ast?: FormulaASTNode;
	error?: string;
}

export interface FormulaConversionResult {
	success: boolean;
	formula?: string;
	error?: string;
	warnings?: string[];
}

const FUNCTION_MAPPINGS: Record<string, { obsidianName: string; requiresTransformation: boolean }> = {
	prop: { obsidianName: 'PROPERTY_REF', requiresTransformation: true },
	length: { obsidianName: 'length', requiresTransformation: false },
	substring: { obsidianName: 'substring', requiresTransformation: false },
	contains: { obsidianName: 'contains', requiresTransformation: false },
	lower: { obsidianName: 'lower', requiresTransformation: false },
	upper: { obsidianName: 'upper', requiresTransformation: false },
	replace: { obsidianName: 'replace', requiresTransformation: false },
	replaceAll: { obsidianName: 'regexreplace', requiresTransformation: true },
	concat: { obsidianName: 'concat', requiresTransformation: false },
	join: { obsidianName: 'join', requiresTransformation: false },
	add: { obsidianName: '+', requiresTransformation: true },
	subtract: { obsidianName: '-', requiresTransformation: true },
	multiply: { obsidianName: '*', requiresTransformation: true },
	divide: { obsidianName: '/', requiresTransformation: true },
	pow: { obsidianName: 'pow', requiresTransformation: false },
	sqrt: { obsidianName: 'sqrt', requiresTransformation: false },
	min: { obsidianName: 'min', requiresTransformation: false },
	max: { obsidianName: 'max', requiresTransformation: false },
	sum: { obsidianName: 'sum', requiresTransformation: false },
	round: { obsidianName: 'round', requiresTransformation: false },
	ceil: { obsidianName: 'ceil', requiresTransformation: false },
	floor: { obsidianName: 'floor', requiresTransformation: false },
	abs: { obsidianName: 'abs', requiresTransformation: false },
	if: { obsidianName: 'if', requiresTransformation: false },
	and: { obsidianName: 'and', requiresTransformation: false },
	or: { obsidianName: 'or', requiresTransformation: false },
	not: { obsidianName: 'not', requiresTransformation: false },
	equal: { obsidianName: '==', requiresTransformation: true },
	unequal: { obsidianName: '!=', requiresTransformation: true },
	larger: { obsidianName: '>', requiresTransformation: true },
	largerEq: { obsidianName: '>=', requiresTransformation: true },
	smaller: { obsidianName: '<', requiresTransformation: true },
	smallerEq: { obsidianName: '<=', requiresTransformation: true },
	now: { obsidianName: 'now', requiresTransformation: false },
	today: { obsidianName: 'dateonly', requiresTransformation: true },
	dateAdd: { obsidianName: 'dateadd', requiresTransformation: false },
	dateSubtract: { obsidianName: 'datesubtract', requiresTransformation: false },
	dateBetween: { obsidianName: 'datediff', requiresTransformation: false },
	formatDate: { obsidianName: 'dateformat', requiresTransformation: false },
	year: { obsidianName: 'year', requiresTransformation: false },
	month: { obsidianName: 'month', requiresTransformation: false },
	date: { obsidianName: 'day', requiresTransformation: false },
	day: { obsidianName: 'weekday', requiresTransformation: false },
	hour: { obsidianName: 'hour', requiresTransformation: false },
	minute: { obsidianName: 'minute', requiresTransformation: false },
	at: { obsidianName: 'at', requiresTransformation: false },
	first: { obsidianName: 'first', requiresTransformation: false },
	last: { obsidianName: 'last', requiresTransformation: false },
	sort: { obsidianName: 'sort', requiresTransformation: false },
	reverse: { obsidianName: 'reverse', requiresTransformation: false },
	map: { obsidianName: 'map', requiresTransformation: false },
	filter: { obsidianName: 'filter', requiresTransformation: false },
	split: { obsidianName: 'split', requiresTransformation: false },
	every: { obsidianName: 'all', requiresTransformation: false },
	some: { obsidianName: 'any', requiresTransformation: false },
};

class FormulaParser {
	private input: string;
	private position: number;
	private current: string;

	constructor(input: string) {
		this.input = input.trim();
		this.position = 0;
		this.current = this.input[0] || '';
	}

	parse(): FormulaParseResult {
		try {
			const ast = this.parseExpression();
			return { success: true, ast };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown parse error',
			};
		}
	}

	private advance(): void {
		this.position++;
		this.current = this.input[this.position] || '';
	}

	private skipWhitespace(): void {
		while (this.current && /\s/.test(this.current)) {
			this.advance();
		}
	}

	private peek(offset: number = 1): string {
		return this.input[this.position + offset] || '';
	}

	private parseExpression(): FormulaASTNode {
		return this.parseLogicalOr();
	}

	private parseLogicalOr(): FormulaASTNode {
		let left = this.parseLogicalAnd();

		while (this.matchKeyword('or')) {
			const operator = 'or';
			this.skipWhitespace();
			const right = this.parseLogicalAnd();
			left = { type: 'binary', operator, left, right };
		}

		return left;
	}

	private parseLogicalAnd(): FormulaASTNode {
		let left = this.parseComparison();

		while (this.matchKeyword('and')) {
			const operator = 'and';
			this.skipWhitespace();
			const right = this.parseComparison();
			left = { type: 'binary', operator, left, right };
		}

		return left;
	}

	private parseComparison(): FormulaASTNode {
		let left = this.parseAdditive();

		this.skipWhitespace();
		if (this.current === '=' && this.peek() === '=') {
			this.advance();
			this.advance();
			this.skipWhitespace();
			const right = this.parseAdditive();
			return { type: 'binary', operator: '==', left, right };
		} else if (this.current === '!' && this.peek() === '=') {
			this.advance();
			this.advance();
			this.skipWhitespace();
			const right = this.parseAdditive();
			return { type: 'binary', operator: '!=', left, right };
		} else if (this.current === '>' && this.peek() === '=') {
			this.advance();
			this.advance();
			this.skipWhitespace();
			const right = this.parseAdditive();
			return { type: 'binary', operator: '>=', left, right };
		} else if (this.current === '<' && this.peek() === '=') {
			this.advance();
			this.advance();
			this.skipWhitespace();
			const right = this.parseAdditive();
			return { type: 'binary', operator: '<=', left, right };
		} else if (this.current === '>') {
			this.advance();
			this.skipWhitespace();
			const right = this.parseAdditive();
			return { type: 'binary', operator: '>', left, right };
		} else if (this.current === '<') {
			this.advance();
			this.skipWhitespace();
			const right = this.parseAdditive();
			return { type: 'binary', operator: '<', left, right };
		}

		return left;
	}

	private parseAdditive(): FormulaASTNode {
		let left = this.parseMultiplicative();

		while (true) {
			this.skipWhitespace();
			if (this.current === '+') {
				this.advance();
				this.skipWhitespace();
				const right = this.parseMultiplicative();
				left = { type: 'binary', operator: '+', left, right };
			} else if (this.current === '-') {
				this.advance();
				this.skipWhitespace();
				const right = this.parseMultiplicative();
				left = { type: 'binary', operator: '-', left, right };
			} else {
				break;
			}
		}

		return left;
	}

	private parseMultiplicative(): FormulaASTNode {
		let left = this.parseUnary();

		while (true) {
			this.skipWhitespace();
			if (this.current === '*') {
				this.advance();
				this.skipWhitespace();
				const right = this.parseUnary();
				left = { type: 'binary', operator: '*', left, right };
			} else if (this.current === '/') {
				this.advance();
				this.skipWhitespace();
				const right = this.parseUnary();
				left = { type: 'binary', operator: '/', left, right };
			} else {
				break;
			}
		}

		return left;
	}

	private parseUnary(): FormulaASTNode {
		this.skipWhitespace();

		if (this.matchKeyword('not')) {
			this.skipWhitespace();
			const operand = this.parseUnary();
			return { type: 'unary', operator: 'not', operand };
		}

		if (this.current === '-') {
			this.advance();
			this.skipWhitespace();
			const operand = this.parseUnary();
			return { type: 'unary', operator: '-', operand };
		}

		return this.parsePrimary();
	}

	private parsePrimary(): FormulaASTNode {
		this.skipWhitespace();

		if (this.current === '(') {
			return this.parseParenthesizedExpression();
		}

		if (this.current === '"' || this.current === "'") {
			return this.parseStringLiteral();
		}

		if (/\d/.test(this.current)) {
			return this.parseNumberLiteral();
		}

		if (this.matchKeyword('true')) {
			return { type: 'literal', valueType: 'boolean', value: true };
		}

		if (this.matchKeyword('false')) {
			return { type: 'literal', valueType: 'boolean', value: false };
		}

		if (/[a-zA-Z_]/.test(this.current)) {
			return this.parseIdentifierOrFunction();
		}

		throw new Error(`Unexpected character: ${this.current}`);
	}

	private parseParenthesizedExpression(): FormulaASTNode {
		this.advance();
		const expr = this.parseExpression();
		this.skipWhitespace();
		if (this.current !== ')') {
			throw new Error('Expected closing parenthesis');
		}
		this.advance();
		return expr;
	}

	private parseStringLiteral(): LiteralNode {
		const quote = this.current;
		this.advance();
		let value = '';

		while (this.current && this.current !== quote) {
			if (this.current === '\\') {
				this.advance();
				value += this.current;
			} else {
				value += this.current;
			}
			this.advance();
		}

		if (this.current !== quote) {
			throw new Error('Unterminated string literal');
		}
		this.advance();

		return { type: 'literal', valueType: 'string', value };
	}

	private parseNumberLiteral(): LiteralNode {
		let value = '';

		while (this.current && /[\d.]/.test(this.current)) {
			value += this.current;
			this.advance();
		}

		return { type: 'literal', valueType: 'number', value: parseFloat(value) };
	}

	private parseIdentifierOrFunction(): PropertyRefNode | FunctionCallNode {
		let name = '';

		while (this.current && /[a-zA-Z0-9_]/.test(this.current)) {
			name += this.current;
			this.advance();
		}

		this.skipWhitespace();

		if (this.current === '(') {
			return this.parseFunctionCall(name);
		}

		return { type: 'property', name };
	}

	private parseFunctionCall(name: string): FunctionCallNode {
		this.advance();
		const args = this.parseArgumentList();
		if (this.current !== ')') {
			throw new Error('Expected closing parenthesis for function call');
		}
		this.advance();
		return { type: 'function', name, args };
	}

	private parseArgumentList(): FormulaASTNode[] {
		const args: FormulaASTNode[] = [];
		this.skipWhitespace();

		if (this.current === ')') {
			return args;
		}

		while (true) {
			args.push(this.parseExpression());
			this.skipWhitespace();

			if (this.current === ',') {
				this.advance();
				this.skipWhitespace();
			} else {
				break;
			}
		}

		return args;
	}

	private matchKeyword(keyword: string): boolean {
		const start = this.position;
		const end = start + keyword.length;

		if (this.input.substring(start, end).toLowerCase() === keyword.toLowerCase()) {
			const nextChar = this.input[end];
			if (!nextChar || !/[a-zA-Z0-9_]/.test(nextChar)) {
				for (let i = 0; i < keyword.length; i++) {
					this.advance();
				}
				return true;
			}
		}

		return false;
	}
}

function translateFormula(ast: FormulaASTNode): FormulaConversionResult {
	const warnings: string[] = [];

	try {
		const formula = translateNode(ast, warnings);
		return { success: true, formula, warnings };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown translation error',
			warnings,
		};
	}
}

function translateNode(node: FormulaASTNode, warnings: string[]): string {
	switch (node.type) {
		case 'literal':
			return translateLiteral(node);
		case 'property':
			return translateProperty(node);
		case 'function':
			return translateFunction(node, warnings);
		case 'binary':
			return translateBinary(node, warnings);
		case 'unary':
			return translateUnary(node, warnings);
	}
}

function translateLiteral(node: LiteralNode): string {
	if (node.valueType === 'string') {
		return `"${node.value}"`;
	}
	return String(node.value);
}

function translateProperty(node: PropertyRefNode): string {
	return node.name;
}

function translateFunction(node: FunctionCallNode, warnings: string[]): string {
	const mapping = FUNCTION_MAPPINGS[node.name];

	if (!mapping) {
		warnings.push(`Unsupported function: ${node.name}`);
		return `UNSUPPORTED_FUNCTION(${node.name})`;
	}

	const args = node.args.map(arg => translateNode(arg, warnings));

	if (mapping.requiresTransformation) {
		return transformFunction(node.name, mapping.obsidianName, args);
	}

	return `${mapping.obsidianName}(${args.join(', ')})`;
}

function transformFunction(notionName: string, obsidianName: string, args: string[]): string {
	switch (notionName) {
		case 'prop':
			if (args.length === 0) {
				return 'MISSING_PROPERTY_NAME';
			}
			return args[0].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
		case 'add':
			return args.length === 2 ? `(${args[0]} + ${args[1]})` : `sum(${args.join(', ')})`;
		case 'subtract':
			return args.length === 2 ? `(${args[0]} - ${args[1]})` : args[0];
		case 'multiply':
			return args.length === 2 ? `(${args[0]} * ${args[1]})` : `product(${args.join(', ')})`;
		case 'divide':
			return args.length === 2 ? `(${args[0]} / ${args[1]})` : args[0];
		case 'equal':
			return `(${args[0]} == ${args[1]})`;
		case 'unequal':
			return `(${args[0]} != ${args[1]})`;
		case 'larger':
			return `(${args[0]} > ${args[1]})`;
		case 'largerEq':
			return `(${args[0]} >= ${args[1]})`;
		case 'smaller':
			return `(${args[0]} < ${args[1]})`;
		case 'smallerEq':
			return `(${args[0]} <= ${args[1]})`;
		case 'today':
			return 'dateonly(now())';
		case 'replaceAll':
			return `regexreplace(${args.join(', ')})`;
		default:
			return `${obsidianName}(${args.join(', ')})`;
	}
}

function translateBinary(node: BinaryOpNode, warnings: string[]): string {
	const left = translateNode(node.left, warnings);
	const right = translateNode(node.right, warnings);

	switch (node.operator) {
		case '+':
		case '-':
		case '*':
		case '/':
		case '==':
		case '!=':
		case '>':
		case '<':
		case '>=':
		case '<=':
			return `(${left} ${node.operator} ${right})`;
		case 'and':
			return `and(${left}, ${right})`;
		case 'or':
			return `or(${left}, ${right})`;
	}
}

function translateUnary(node: UnaryOpNode, warnings: string[]): string {
	const operand = translateNode(node.operand, warnings);

	switch (node.operator) {
		case 'not':
			return `not(${operand})`;
		case '-':
			return `(-${operand})`;
	}
}

export function convertNotionFormula(formula: string): FormulaConversionResult {
	const parser = new FormulaParser(formula);
	const parseResult = parser.parse();

	if (!parseResult.success || !parseResult.ast) {
		return {
			success: false,
			error: parseResult.error,
		};
	}

	return translateFormula(parseResult.ast);
}
