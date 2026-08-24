import { parseFrontMatterBlock, serializeFrontMatter } from './util';

type ListProperty = 'aliases' | 'cssclasses' | 'tags';

function unquoteListItem(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2 || trimmed[0] !== trimmed.at(-1)) return trimmed;
	if (trimmed.startsWith('\'')) return trimmed.slice(1, -1).replace(/''/gu, '\'');
	if (!trimmed.startsWith('"')) return trimmed;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return typeof parsed === 'string' ? parsed : trimmed;
	}
	catch {
		return trimmed.slice(1, -1).replace(/\\(["\\])/gu, '$1');
	}
}

function splitFlowList(body: string): string[] | null {
	const items: string[] = [];
	let start = 0;
	let quote = '';
	let escaped = false;
	let itemStart = true;
	for (let index = 0; index < body.length; index++) {
		const character = body[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quote) {
			if (quote === '"' && character === '\\') escaped = true;
			else if (character === quote) {
				if (quote === '\'' && body[index + 1] === '\'') index++;
				else quote = '';
			}
			continue;
		}
		if (itemStart && (character === '"' || character === '\'')) {
			quote = character;
			itemStart = false;
		}
		else if (character === ',') {
			items.push(unquoteListItem(body.slice(start, index)));
			start = index + 1;
			itemStart = true;
		}
		else if (!/\s/u.test(character)) itemStart = false;
	}
	if (quote) return null;
	items.push(unquoteListItem(body.slice(start)));
	return items;
}

function stringList(value: string, property: ListProperty): string[] {
	const trimmed = value.trim();
	if (!trimmed) return [];
	const flowBody = trimmed.startsWith('[') && trimmed.endsWith(']')
		? trimmed.slice(1, -1)
		: null;
	const flowValues = flowBody === null ? null : splitFlowList(flowBody);
	let values = flowValues
		?? (flowBody ?? trimmed).split(property === 'aliases' ? /[\n,]+/u : /[\s,]+/u);
	if (flowValues && property !== 'aliases') {
		values = values.flatMap(item => item.split(/[\s,]+/u));
	}
	return values;
}

function listPropertyValues(value: unknown, property: ListProperty): string[] | null {
	let values: string[];
	if (typeof value === 'string') values = stringList(value, property);
	else if (Array.isArray(value)) {
		if (value.some(item => item !== null && typeof item === 'object')) return null;
		values = value.filter(item => item !== null && item !== undefined).map(String);
		if (property !== 'aliases') values = values.flatMap(item => item.split(/[\s,]+/u));
	}
	else if (value === null || value === undefined) values = [];
	else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		values = [String(value)];
	}
	else return null;

	return values
		.map(item => item.trim())
		.map(item => property === 'tags' ? item.replace(/^#+/u, '') : item)
		.filter(Boolean);
}

function isSameStringList(value: unknown, normalized: string[]): boolean {
	return Array.isArray(value)
		&& value.length === normalized.length
		&& value.every((item, index) => item === normalized[index]);
}

/** Enforce Obsidian's built-in list-property types on a complete Markdown note. */
export function normalizeListProperties(content: string): string {
	const parsed = parseFrontMatterBlock(content);
	if (!parsed) return content;

	const frontMatter = { ...parsed.frontMatter };
	let changed = false;
	for (const [key, value] of Object.entries(frontMatter)) {
		const property = key.toLowerCase();
		if (property !== 'aliases' && property !== 'cssclasses' && property !== 'tags') continue;
		if (value === null || value === undefined) continue;
		const normalized = listPropertyValues(value, property);
		if (normalized === null || isSameStringList(value, normalized)) continue;
		frontMatter[key] = normalized;
		changed = true;
	}

	return changed ? serializeFrontMatter(frontMatter) + parsed.body : content;
}
