import { moment } from 'obsidian';
import { sanitizeFileName } from './util';

export type TemplateValue = unknown;
export type NoteTemplateVariables = Record<string, TemplateValue>;

type TemplateFilter = (value: TemplateValue, args: string[]) => TemplateValue;

function asString(value: TemplateValue): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function asArray(value: TemplateValue): unknown[] {
	if (Array.isArray(value)) return value;
	if (typeof value !== 'string') return [value];

	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [value];
	}
	catch {
		return [value];
	}
}

function words(value: TemplateValue): string[] {
	return asString(value).trim().split(/[\s_-]+/u).filter(Boolean);
}

function titleCase(value: TemplateValue): string {
	return words(value).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

function numeric(value: TemplateValue): number | null {
	const parsed = Number(asString(value));
	return Number.isFinite(parsed) ? parsed : null;
}

function dateFilter(value: TemplateValue, args: string[]): string {
	const input = asString(value);
	if (!input) return '';

	const parsed = moment(input === 'now' ? undefined : input, args[1], !!args[1]);
	if (!parsed.isValid()) return input;
	return parsed.format(args[0] || 'YYYY-MM-DD');
}

function dateModify(value: TemplateValue, args: string[]): string {
	const input = asString(value);
	const parsed = moment(input === 'now' ? undefined : input);
	const match = /^([+-])\s*(\d+)\s*(years?|months?|weeks?|days?|hours?|minutes?|seconds?)$/iu.exec(args[0] ?? '');
	if (!input || !parsed.isValid() || !match) return input;

	const amount = Number(match[2]) * (match[1] === '-' ? -1 : 1);
	return parsed.add(amount, match[3] as moment.unitOfTime.DurationConstructor).format('YYYY-MM-DD');
}

/**
 * Filters shared with Web Clipper's syntax. This intentionally starts with the
 * filters useful for imported note text and paths; more can be added without
 * changing the template format.
 */
const FILTERS: Record<string, TemplateFilter> = {
	trim: value => asString(value).trim(),
	lower: value => asString(value).toLowerCase(),
	upper: value => asString(value).toUpperCase(),
	capitalize: value => {
		const text = asString(value);
		return text.charAt(0).toUpperCase() + text.slice(1);
	},
	title: value => titleCase(value),
	camel: value => {
		const parts = words(value).map(word => word.toLowerCase());
		return parts.map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)).join('');
	},
	kebab: value => words(value).map(word => word.toLowerCase()).join('-'),
	snake: value => words(value).map(word => word.toLowerCase()).join('_'),
	pascal: value => words(value).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(''),
	safe_name: value => sanitizeFileName(asString(value)),
	replace: (value, args) => args[0] === undefined ? value : asString(value).split(args[0]).join(args[1] ?? ''),
	split: (value, args) => asString(value).split(args[0] ?? ','),
	join: (value, args) => asArray(value).map(asString).join(args[0] ?? ', '),
	first: value => asArray(value)[0] ?? '',
	last: value => asArray(value).at(-1) ?? '',
	nth: (value, args) => asArray(value)[Number(args[0] ?? 0)] ?? '',
	slice: (value, args) => {
		const start = Number(args[0] ?? 0);
		const end = args[1] === undefined || args[1] === '' ? undefined : Number(args[1]);
		return Array.isArray(value) ? value.slice(start, end) : asString(value).slice(start, end);
	},
	length: value => Array.isArray(value) ? value.length : asString(value).length,
	unique: value => [...new Set(asArray(value).map(asString))],
	reverse: value => Array.isArray(value) ? [...value].reverse() : Array.from(asString(value)).reverse().join(''),
	round: (value, args) => {
		const number = numeric(value);
		if (number === null) return value;
		const places = Number(args[0] ?? 0);
		return number.toFixed(Number.isInteger(places) ? places : 0).replace(/\.0+$/u, '');
	},
	number_format: value => {
		const number = numeric(value);
		return number === null ? value : new Intl.NumberFormat().format(number);
	},
	date: dateFilter,
	date_modify: dateModify,
};

function splitExpression(value: string, separator: '|' | ':' | ','): string[] {
	const parts: string[] = [];
	let current = '';
	let quote = '';
	let escaped = false;
	let parentheses = 0;

	for (const character of value) {
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === '\\') {
			current += character;
			escaped = true;
			continue;
		}
		if (quote) {
			current += character;
			if (character === quote) quote = '';
			continue;
		}
		if (character === '"' || character === '\'') {
			quote = character;
			current += character;
			continue;
		}
		if (character === '(') parentheses++;
		else if (character === ')' && parentheses > 0) parentheses--;

		if (character === separator && parentheses === 0) {
			parts.push(current.trim());
			current = '';
		}
		else current += character;
	}

	parts.push(current.trim());
	return parts;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	const match = /^(["'])([\s\S]*)\1$/u.exec(trimmed);
	return (match?.[2] ?? trimmed).replace(/\\([\\"'])/gu, '$1');
}

function filterParts(expression: string): { name: string, args: string[] } {
	const [name, ...rest] = splitExpression(expression, ':');
	const combined = rest.join(':').replace(/^\(([\s\S]*)\)$/u, '$1');
	const args = combined ? splitExpression(combined, ',').flatMap(part =>
		splitExpression(part, ':')).map(unquote) : [];
	return { name, args };
}

function nestedValue(variables: NoteTemplateVariables, path: string): TemplateValue {
	if (Object.prototype.hasOwnProperty.call(variables, path)) return variables[path];

	const parts = path.replace(/\[([\d]+|["'][^"']+["'])\]/gu, '.$1').split('.').filter(Boolean);
	let value: unknown = variables;
	for (const rawPart of parts) {
		if (value === null || value === undefined || typeof value !== 'object') return undefined;
		const part = rawPart.replace(/^["']|["']$/gu, '');
		value = (value as Record<string, unknown>)[part];
	}
	return value;
}

/** Render a Markdown note template using Web Clipper-style variables and filters. */
export function renderNoteTemplate(template: string, variables: NoteTemplateVariables): string {
	return template.replace(/\{\{\s*([\s\S]*?)\s*\}\}/gu, (_match, expression: string) => {
		const [variable, ...filterExpressions] = splitExpression(expression, '|');
		let value = nestedValue(variables, variable.trim());

		for (const filterExpression of filterExpressions) {
			const { name, args } = filterParts(filterExpression);
			const filter = FILTERS[name];
			if (filter) value = filter(value, args);
		}

		return asString(value);
	});
}
