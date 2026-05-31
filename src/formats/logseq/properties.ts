// Logseq page/block property handling.
//
// Page properties live in the first block of a file (unindented `key:: value`
// lines) and map to Obsidian YAML frontmatter. Block properties are indented
// `key:: value` continuation lines; most Logseq-internal ones are dropped.

const PROPERTY_LINE = /^([A-Za-z0-9_.\-]+):: ?(.*)$/;
const BLOCK_PROPERTY_LINE = /^(\s*)([A-Za-z0-9_.\-]+):: ?(.*)$/;

// Logseq-internal block properties that have no meaning in Obsidian.
const INTERNAL_BLOCK_PROPS = new Set([
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

function splitList(value: string): string[] {
	return value.split(',').map(v => v.trim()).filter(v => v.length > 0);
}

function quote(value: string): string {
	return '"' + value.replace(/"/g, '\\"') + '"';
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

function emitProperty(key: string, value: string, aliases: string[]): string[] {
	if (key === 'alias' || key === 'aliases') {
		for (const item of splitList(value)) aliases.push(stripWikiBrackets(item));
		return []; // emitted later, after the whole block is parsed
	}
	if (key === 'tags') {
		const items = splitList(value).flatMap(tagsFromItem);
		return ['tags:', ...items.map(i => `  - ${i}`)];
	}
	const parts = splitList(value);
	const hasWiki = value.includes('[[');
	if (hasWiki && parts.length > 1) {
		return [`${key}:`, ...parts.map(p => `  - ${quote(p)}`)];
	}
	if (hasWiki) {
		return [`${key}: ${quote(value)}`];
	}
	return [`${key}: ${value}`];
}

export function extractPageProperties(content: string): PageProperties {
	const lines = content.split('\n');
	const raw: Record<string, string> = {};
	const bodyLines: string[] = [];
	const propLines: string[] = [];
	const aliases: string[] = [];

	let i = 0;
	// Page properties are the leading unindented `key:: value` lines.
	for (; i < lines.length; i++) {
		const m = lines[i].match(PROPERTY_LINE);
		if (!m) break;
		const key = m[1];
		const value = m[2].trim();
		raw[key] = value;
		if (key === 'title') continue; // dropped from YAML, kept in raw
		propLines.push(...emitProperty(key, value, aliases));
	}

	// Skip blank lines between the property block and the body.
	while (i < lines.length && lines[i].trim() === '') i++;
	for (; i < lines.length; i++) bodyLines.push(lines[i]);

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

export function removeLeftoverBlockProperties(content: string): string {
	return content
		.split('\n')
		.filter(line => {
			const m = line.match(BLOCK_PROPERTY_LINE);
			if (!m) return true;
			const key = m[2];
			if (key.startsWith('logseq.')) return false;
			return !INTERNAL_BLOCK_PROPS.has(key);
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
