import { outsideMarkdownFences } from '../../markdown';

const PROPERTY_LINE = /^([A-Za-z0-9_.-]+):: ?(.*)$/;
const BLOCK_PROPERTY_LINE = /^(\s*)(- )?([A-Za-z0-9_.-]+):: ?(.*)$/;
const BLOCK_ANCHOR = /\s+(\^[A-Za-z0-9_-]+)\s*$/;

const ALWAYS_DROP_BLOCK_PROPS = new Set([
	'alias',
	'aliases',
	'collapsed',
	'background-color',
	'heading',
	'query-table',
	'query-properties',
	'query-sort-by',
	'query-sort-desc',
	'query-flag',
	'filters',
	'public',
	'exclude-from-graph-view',
	'template',
	'template-including-parent',
]);

const ALWAYS_DROP_PAGE_PROPS = new Set([
	'collapsed',
	'filters',
	'background-color',
	'heading',
	'template',
	'template-including-parent',
]);

const isAlwaysDroppedByPrefix = (key: string): boolean =>
	key.startsWith('hl-') ||
	key.startsWith('ls-') ||
	key.startsWith('logseq.') ||
	key.startsWith('query-');

export interface PageProperties {
	yaml: string;
	body: string;
	raw: Record<string, string>;
}

function stripWikiBrackets(value: string): string {
	const m = value.match(/^\[\[(.*)\]\]$/);
	return m ? m[1] : value;
}

export function splitList(value: string): string[] {
	const items: string[] = [];
	let current = '';
	let depth = 0;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === '[' && value[i + 1] === '[') {
			depth++;
			current += ch;
			continue;
		}
		if (ch === ']' && value[i - 1] === ']' && depth > 0) {
			depth--;
			current += ch;
			continue;
		}
		if (ch === ',' && depth === 0) {
			const trimmed = current.trim();
			if (trimmed) items.push(trimmed);
			current = '';
		}
		else {
			current += ch;
		}
	}
	const trimmed = current.trim();
	if (trimmed) items.push(trimmed);
	return items;
}

function quote(value: string): string {
	return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const YAML_BOOL = /^(yes|no|true|false|on|off)$/i;
const YAML_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^0[xXoObB]/;
const YAML_LEADING_ZERO = /^0\d/;

function needsQuoting(value: string): boolean {
	if (value.length === 0) return false;
	const first = value[0];
	if ('#[{>|*&!@`'.includes(first)) return true;
	if (first === '"' || first === '\'') return true;
	if (value.endsWith(':') || value.includes(': ')) return true;
	if (/\s#/.test(value)) return true;
	if (YAML_BOOL.test(value)) return true;
	if (YAML_NUMBER.test(value) || YAML_LEADING_ZERO.test(value)) return true;
	return false;
}

function yamlListItem(value: string): string {
	return `  - ${needsQuoting(value) ? quote(value) : value}`;
}

function extractIsoDate(value: string): string | null {
	const clean = value.replace(/^\[\[|\]\]$/g, '').trim();
	if (/\{\{/.test(clean)) return null;
	if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
	return null;
}

function tagsFromItem(item: string): string[] {
	const tokens: string[] = [];
	const rest = item.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
		tokens.push(name.trim());
		return ' ';
	});
	for (const part of rest.split(/\s+/)) {
		const t = part.replace(/^#/, '').trim();
		if (t) tokens.push(t);
	}
	return tokens;
}

function toSnakeCaseKey(key: string): string {
	return key.replace(/-/g, '_');
}

function emitProperty(key: string, value: string, aliases: string[], dropPageProps: Set<string>, dropTags: Set<string>, snakeCase: boolean): string[] {
	if (value.trim() === '') return [];

	if (key === 'alias' || key === 'aliases') {
		for (const item of splitList(value)) aliases.push(stripWikiBrackets(item));
		return [];
	}
	if (key === 'tags') {
		const items = splitList(value).flatMap(tagsFromItem).filter(t => !dropTags.has(t));
		if (items.length === 0) return [];
		return ['tags:', ...items.map(yamlListItem)];
	}
	if (isAlwaysDroppedPageProp(key)) return [];
	if (dropPageProps.has(key)) return [];

	const outKey = snakeCase ? toSnakeCaseKey(key) : key;

	if ((key === 'created' || key === 'updated') && value.includes('[[')) {
		const iso = extractIsoDate(value);
		if (iso !== null) return [`${outKey}: ${iso}`];
	}

	const parts = splitList(value);
	const hasWiki = value.includes('[[');
	if (hasWiki && parts.length > 1) {
		return [`${outKey}:`, ...parts.map(p => `  - ${quote(p)}`)];
	}
	if (hasWiki) {
		return [`${outKey}: ${quote(value)}`];
	}
	if (needsQuoting(value)) {
		return [`${outKey}: ${quote(value)}`];
	}
	return [`${outKey}: ${value}`];
}

export interface ExtractPagePropertiesOptions {
	dropPageProperties?: string[];
	dropTags?: string[];
	snakeCasePageProperties?: boolean;
}

export function extractPageProperties(content: string, opts: ExtractPagePropertiesOptions = {}): PageProperties {
	const dropPageProps = new Set(opts.dropPageProperties ?? []);
	const dropTags = new Set(opts.dropTags ?? []);
	const snakeCase = opts.snakeCasePageProperties ?? false;
	const lines = content.split('\n');
	const raw: Record<string, string> = {};
	const bodyLines: string[] = [];
	const propMap = new Map<string, string[]>();
	const propOrder: string[] = [];
	const aliases: string[] = [];

	let i = 0;
	for (; i < lines.length; i++) {
		const m = lines[i].match(PROPERTY_LINE);
		if (!m) break;
		const key = m[1];
		const value = m[2].trim();
		raw[key] = value;
		if (key === 'title') continue;
		const emitted = emitProperty(key, value, aliases, dropPageProps, dropTags, snakeCase);
		if (emitted.length > 0) {
			if (!propMap.has(key)) propOrder.push(key);
			propMap.set(key, emitted);
		}
	}

	if (raw.title) {
		const titleAlias = raw.title.replace(/^\[\[(.*)\]\]$/, '$1').trim();
		if (titleAlias) aliases.push(titleAlias);
	}

	while (i < lines.length && lines[i].trim() === '') i++;
	for (; i < lines.length; i++) bodyLines.push(lines[i]);

	const propLines: string[] = [];
	for (const key of propOrder) {
		const lines = propMap.get(key);
		if (lines) propLines.push(...lines);
	}

	let yaml = '';
	const hasAny = propLines.length > 0 || aliases.length > 0;
	if (hasAny) {
		const aliasLines = aliases.length
			? ['aliases:', ...aliases.map(yamlListItem)]
			: [];
		yaml = ['---', ...aliasLines, ...propLines, '---'].join('\n');
	}

	return { yaml, body: bodyLines.join('\n'), raw };
}

export type BlockPropertyMode = 'keep' | 'wrap' | 'drop';

function isAlwaysDroppedBlockProp(key: string, userDrop: Set<string>): boolean {
	if (isAlwaysDroppedByPrefix(key)) return true;
	return ALWAYS_DROP_BLOCK_PROPS.has(key) || userDrop.has(key);
}

function isAlwaysDroppedPageProp(key: string): boolean {
	if (isAlwaysDroppedByPrefix(key)) return true;
	return ALWAYS_DROP_PAGE_PROPS.has(key);
}

function wrapBlockProperty(line: string, m: RegExpMatchArray, outKey: string): string {
	const indent = m[1];
	const bullet = m[2] ?? '';
	let value = m[4];
	let anchor = '';
	const am = value.match(BLOCK_ANCHOR);
	if (am) {
		anchor = am[1];
		value = value.slice(0, am.index);
	}
	const core = value.trim();
	if (core === '') return line;
	// Stray brackets would break the Dataview field.
	const withoutLinks = core.replace(/\[\[[^\]]*\]\]/g, '');
	if (withoutLinks.includes(']') || withoutLinks.includes('[')) return line;
	const wrapped = `${indent}${bullet}[${outKey}:: ${core}]`;
	return anchor ? `${wrapped} ${anchor}` : wrapped;
}

function renameBlockPropertyKey(line: string, m: RegExpMatchArray, outKey: string): string {
	const indent = m[1];
	const bullet = m[2] ?? '';
	const key = m[3];
	const prefixLen = indent.length + bullet.length;
	const rest = line.slice(prefixLen + key.length + 2);
	return `${indent}${bullet}${outKey}::${rest}`;
}

export function removeLeftoverBlockProperties(
	content: string,
	dropBlockProperties: string[] = [],
	mode: BlockPropertyMode = 'keep',
	snakeCase = false
): string {
	return outsideMarkdownFences(content,
		segment => removeLeftoverBlockPropertySegment(segment, dropBlockProperties, mode, snakeCase));
}

function removeLeftoverBlockPropertySegment(
	content: string,
	dropBlockProperties: string[],
	mode: BlockPropertyMode,
	snakeCase: boolean,
): string {
	const userDrop = new Set(dropBlockProperties);
	const out: string[] = [];
	for (const line of content.split('\n')) {
		const m = line.match(BLOCK_PROPERTY_LINE);
		if (!m) {
			out.push(line);
			continue;
		}
		const key = m[3];
		if (isAlwaysDroppedBlockProp(key, userDrop)) continue;
		if (mode === 'drop') continue;
		const outKey = snakeCase ? toSnakeCaseKey(key) : key;
		if (mode === 'wrap') {
			out.push(wrapBlockProperty(line, m, outKey));
			continue;
		}
		out.push(snakeCase ? renameBlockPropertyKey(line, m, outKey) : line);
	}
	return out.join('\n');
}

export interface LinkifyTagValuesOptions {
	knownPages: Set<string>;
	toLinks: boolean;
	onlyExistingPages: boolean;
}

const TAG_VALUE_LINE = /^(\s*[A-Za-z0-9_.-]+: )"(#(?:\[\[[^\]]+\]\]|[\w/-]+))"$/;

export function linkifyTagValuesInFrontmatter(yaml: string, opts: LinkifyTagValuesOptions): string {
	if (!yaml || !opts.toLinks) return yaml;
	const { knownPages, onlyExistingPages } = opts;
	return yaml
		.split('\n')
		.map(line => {
			const m = line.match(TAG_VALUE_LINE);
			if (!m) return line;
			const prefix = m[1];
			const token = m[2];
			const multi = token.match(/^#\[\[([^\]]+)\]\]$/);
			const name = multi ? multi[1] : token.slice(1);
			if (onlyExistingPages && !knownPages.has(name.toLowerCase())) return line;
			return `${prefix}"[[${name}]]"`;
		})
		.join('\n');
}

export function convertHeadingProperty(content: string): string {
	return outsideMarkdownFences(content, convertHeadingPropertySegment);
}

function convertHeadingPropertySegment(content: string): string {
	const lines = content.split('\n');
	const out: string[] = [];
	let lastBulletIndex = -1;

	for (const line of lines) {
		const headingMatch = line.match(/^\s*heading:: ?(.*)$/);
		if (headingMatch) {
			const level = parseInt(headingMatch[1], 10);
			if (!isNaN(level) && level >= 1 && level <= 6 && lastBulletIndex >= 0) {
				out[lastBulletIndex] = out[lastBulletIndex].replace(
					/^(\s*)- /,
					`$1- ${'#'.repeat(level)} `
				);
			}
			continue;
		}
		if (/^\s*- /.test(line)) lastBulletIndex = out.length;
		out.push(line);
	}

	return out.join('\n');
}
