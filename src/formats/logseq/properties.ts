// Logseq page/block property handling.
//
// Page properties live in the first block of a file (unindented `key:: value`
// lines) and map to Obsidian YAML frontmatter. Block properties are indented
// `key:: value` continuation lines; most Logseq-internal ones are dropped.

const PROPERTY_LINE = /^([A-Za-z0-9_.\-]+):: ?(.*)$/;
// Also matches bullet-form block properties: `- key:: value`
const BLOCK_PROPERTY_LINE = /^(\s*)(?:- )?([A-Za-z0-9_.\-]+):: ?(.*)$/;

// Block properties that are always dropped regardless of user config.
// These are purely Logseq-internal and have no meaning in Obsidian.
const ALWAYS_DROP_BLOCK_PROPS = new Set([
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
]);

// Logseq PDF-annotation internal properties — always dropped.
const ALWAYS_DROP_HL_PROPS = (key: string): boolean =>
	key.startsWith('hl-') || key.startsWith('ls-');

export interface PageProperties {
	/** YAML frontmatter block including `---` fences, or '' when there are none. */
	yaml: string;
	/** File body after the page-property block (leading blank lines trimmed). */
	body: string;
	/** Raw parsed key -> value map (e.g. for the dropped `title`). */
	raw: Record<string, string>;
}

function stripWikiBrackets(value: string): string {
	const m = value.match(/^\[\[(.*)\]\]$/);
	return m ? m[1] : value;
}

/**
 * Split a comma-separated property value into items, ignoring commas that
 * appear inside `[[wikilinks]]`.  H3 fix: a single `[[Jul 18th, 2025]]`
 * must remain one item, not split into `["[[Jul 18th"`, `"2025]]"]`.
 */
function splitList(value: string): string[] {
	const items: string[] = [];
	let current = '';
	let depth = 0;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === '[' && value[i + 1] === '[') { depth++; current += ch; continue; }
		if (ch === ']' && value[i - 1] === ']' && depth > 0) { depth--; current += ch; continue; }
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

/**
 * Return a YAML-safe double-quoted scalar.
 * Escapes internal `"` and `\` characters.
 */
function quote(value: string): string {
	return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * Return true when a scalar MUST be quoted to round-trip safely through YAML.
 * Covers the cases that js-yaml / Obsidian care about:
 *  - starts with a YAML indicator character: #, [, {, >, |, *, &, !, @, `
 *  - looks like a YAML boolean: yes/no/true/false/on/off (case-insensitive)
 *  - looks like a number (int, float, leading-zero, hex, octal)
 *  - contains ': ' (would be parsed as a mapping key)
 *  - starts or ends with a quote character
 *  - contains a wikilink `[[` (already handled upstream, but guard here too)
 */
const YAML_BOOL = /^(yes|no|true|false|on|off)$/i;
const YAML_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^0[xXoObB]/;
const YAML_LEADING_ZERO = /^0\d/;

function needsQuoting(value: string): boolean {
	if (value.length === 0) return false;
	const first = value[0];
	if ('#[{>|*&!@`'.includes(first)) return true;
	if (first === '"' || first === "'") return true;
	if (value.endsWith(':') || value.includes(': ')) return true;
	if (YAML_BOOL.test(value)) return true;
	if (YAML_NUMBER.test(value) || YAML_LEADING_ZERO.test(value)) return true;
	return false;
}

/**
 * Strip `[[wikilink]]` brackets from an ISO-date property value.
 * e.g. `[[2024-01-16]]` → `2024-01-16`. Returns `null` if the value
 * is not a plain ISO date (so template tokens like `{{date:…}}` are dropped).
 */
function extractIsoDate(value: string): string | null {
	const clean = value.replace(/^\[\[|\]\]$/g, '').trim();
	if (/\{\{/.test(clean)) return null; // template token
	if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
	return null;
}

// A single comma-separated tag entry may itself contain multiple tags, e.g.
// `[[tag2]] #tag3`. Pull out wikilinked names first, then bare/hash tokens.
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

function emitProperty(key: string, value: string, aliases: string[], dropPageProps: Set<string>, dropTags: Set<string>): string[] {
	// L2: drop empty-valued properties.
	if (value.trim() === '') return [];

	if (key === 'alias' || key === 'aliases') {
		for (const item of splitList(value)) aliases.push(stripWikiBrackets(item));
		return []; // emitted later, after the whole block is parsed
	}
	if (key === 'tags') {
		const items = splitList(value).flatMap(tagsFromItem).filter(t => !dropTags.has(t));
		if (items.length === 0) return [];
		return ['tags:', ...items.map(i => `  - ${i}`)];
	}
	if (dropPageProps.has(key)) return [];

	// L1: created/updated wikilink dates → plain ISO.
	if ((key === 'created' || key === 'updated') && value.includes('[[')) {
		const iso = extractIsoDate(value);
		if (iso !== null) return [`${key}: ${iso}`];
		// Fall through to normal handling if not a clean ISO date.
	}

	const parts = splitList(value);
	const hasWiki = value.includes('[[');
	if (hasWiki && parts.length > 1) {
		return [`${key}:`, ...parts.map(p => `  - ${quote(p)}`)];
	}
	if (hasWiki) {
		return [`${key}: ${quote(value)}`];
	}
	// H1-H4: apply general YAML-safe quoting to all non-wikilink scalars.
	if (needsQuoting(value)) {
		return [`${key}: ${quote(value)}`];
	}
	return [`${key}: ${value}`];
}

export interface ExtractPagePropertiesOptions {
	dropPageProperties?: string[];
	dropTags?: string[];
}

export function extractPageProperties(content: string, opts: ExtractPagePropertiesOptions = {}): PageProperties {
	const dropPageProps = new Set(opts.dropPageProperties ?? []);
	const dropTags = new Set(opts.dropTags ?? []);
	const lines = content.split('\n');
	const raw: Record<string, string> = {};
	const bodyLines: string[] = [];
	// L4: use a Map to deduplicate keys (last value wins).
	const propMap = new Map<string, string[]>();
	const propOrder: string[] = [];
	const aliases: string[] = [];

	let i = 0;
	// Page properties are the leading unindented `key:: value` lines.
	for (; i < lines.length; i++) {
		const m = lines[i].match(PROPERTY_LINE);
		if (!m) break;
		const key = m[1];
		const value = m[2].trim();
		raw[key] = value;
		if (key === 'title') continue; // kept in raw, emitted as alias below
		const emitted = emitProperty(key, value, aliases, dropPageProps, dropTags);
		if (emitted.length > 0) {
			if (!propMap.has(key)) propOrder.push(key);
			propMap.set(key, emitted);
		}
	}

	// M3: treat title:: as an additional alias (→ Obsidian aliases field).
	if (raw.title) {
		const titleAlias = raw.title.replace(/^\[\[(.*)\]\]$/, '$1').trim();
		if (titleAlias) aliases.push(titleAlias);
	}

	// Skip blank lines between the property block and the body.
	while (i < lines.length && lines[i].trim() === '') i++;
	for (; i < lines.length; i++) bodyLines.push(lines[i]);

	// Collect emitted lines in insertion order (deduplicated).
	const propLines: string[] = [];
	for (const key of propOrder) {
		const lines = propMap.get(key);
		if (lines) propLines.push(...lines);
	}

	let yaml = '';
	const hasAny = propLines.length > 0 || aliases.length > 0;
	if (hasAny) {
		const aliasLines = aliases.length
			? ['aliases:', ...aliases.map(a => `  - ${a}`)]
			: [];
		yaml = ['---', ...aliasLines, ...propLines, '---'].join('\n');
	}

	return { yaml, body: bodyLines.join('\n'), raw };
}

export function removeLeftoverBlockProperties(content: string, dropBlockProperties: string[] = []): string {
	const userDrop = new Set(dropBlockProperties);
	return content
		.split('\n')
		.filter(line => {
			const m = line.match(BLOCK_PROPERTY_LINE);
			if (!m) return true;
			const key = m[2];
			// M2: drop PDF-annotation props (hl-* / ls-* prefix).
			if (ALWAYS_DROP_HL_PROPS(key)) return false;
			if (key.startsWith('logseq.')) return false;
			if (key.startsWith('query-')) return false;
			return !ALWAYS_DROP_BLOCK_PROPS.has(key) && !userDrop.has(key);
		})
		.join('\n');
}

export function convertHeadingProperty(content: string): string {
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
			// drop the heading property line regardless
			continue;
		}
		if (/^\s*- /.test(line)) lastBulletIndex = out.length;
		out.push(line);
	}

	return out.join('\n');
}
