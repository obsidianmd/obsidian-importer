// Wikilink, alias, and tag conversions.
//
// Logseq and Obsidian both have `[[wikilinks]]`, but Logseq writes aliased
// links as `[display]([[Page]])` and, crucially, lets you *reference a page by
// one of its aliases*. Obsidian links must target the canonical note name, so
// alias references have to be rewritten to `[[Canonical|Alias]]`.

export interface LinkIndex {
	/** alias (lower-cased) -> canonical page name. Ambiguous aliases excluded. */
	aliasMap: Map<string, string>;
}

/** Run a per-line transform, skipping fenced code blocks. */
function outsideCode(content: string, fn: (line: string) => string): string {
	let inFence = false;
	return content
		.split('\n')
		.map(line => {
			if (/^\s*```/.test(line)) {
				inFence = !inFence;
				return line;
			}
			return inFence ? line : fn(line);
		})
		.join('\n');
}

export function convertAliasLinks(content: string): string {
	return outsideCode(content, line =>
		// [display]([[Target]]) -> [[Target|display]]
		line.replace(/\[([^\]]+)\]\(\[\[([^\]]+)\]\]\)/g, (_, display, target) => `[[${target}|${display}]]`)
	);
}

export interface ConvertTagsOptions {
	/** Convert tags to wikilinks. */
	toLinks: boolean;
	/**
	 * When toLinks is true, only convert tags that have a matching page in the graph.
	 * Tags with no corresponding page are kept as-is.
	 */
	onlyExistingPages: boolean;
	/** Set of known page canonical names (lower-cased) for page-existence checks. */
	knownPages: Set<string>;
	/** Tags to drop entirely from body text (applied before the toLinks decision). */
	dropTags: Set<string>;
}

export function convertTags(content: string, options: ConvertTagsOptions): string {
	const { toLinks, onlyExistingPages, knownPages, dropTags } = options;

	return outsideCode(content, line => {
		// #[[multi word tag]]
		line = line.replace(/(^|\s)#\[\[([^\]]+)\]\]/g, (_, pre, name) => {
			if (dropTags.has(name) || dropTags.has(name.replace(/\s+/g, '-'))) return pre;
			if (toLinks) {
				if (onlyExistingPages && !knownPages.has(name.toLowerCase())) return `${pre}#${name.replace(/\s+/g, '-')}`;
				return `${pre}[[${name}]]`;
			}
			return `${pre}#${name.replace(/\s+/g, '-')}`;
		});
		// #simple-tag (letters, digits, /_-), must follow start or whitespace
		line = line.replace(/(^|\s)#([\w/-]+)/g, (m, pre, name) => {
			if (dropTags.has(name)) return pre;
			if (toLinks) {
				if (onlyExistingPages && !knownPages.has(name.toLowerCase())) return m;
				return `${pre}[[${name}]]`;
			}
			return m;
		});
		return line;
	});
}

export function rewriteAliasReferences(content: string, index: LinkIndex): string {
	if (index.aliasMap.size === 0) return content;
	return outsideCode(content, line =>
		line.replace(/(!?)\[\[([^\]]+)\]\]/g, (whole, bang, inner) => {
			const pipe = inner.indexOf('|');
			const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
			const display = pipe >= 0 ? inner.slice(pipe + 1) : target;
			if (target.includes('#')) return whole; // block/heading ref, not a page alias
			const canonical = index.aliasMap.get(target.toLowerCase());
			if (!canonical) return whole;
			return `${bang}[[${canonical}|${display}]]`;
		})
	);
}

export interface BasenameIndex {
	/**
	 * basename (lower-cased, without .md) -> full output path(s) without .md.
	 * Entries with 2+ paths are ambiguous and wikilinks must be disambiguated.
	 */
	basenameMap: Map<string, string[]>;
}

/**
 * Rewrite wikilinks that are ambiguous due to same-basename pages in different folders.
 * A bare `[[name]]` that matches two or more notes becomes `[[full/path/to/note|name]]`.
 * Links that already contain a `/` (namespace-style) are left untouched — they already
 * point at the correct full path.
 */
export function disambiguateBasenameLinks(content: string, index: BasenameIndex): string {
	if (index.basenameMap.size === 0) return content;
	return outsideCode(content, line =>
		line.replace(/(!?)\[\[([^\]]+)\]\]/g, (whole, bang, inner) => {
			const pipe = inner.indexOf('|');
			const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
			const display = pipe >= 0 ? inner.slice(pipe + 1) : null;

			// Already a path (contains /) or a block ref — leave as-is.
			if (target.includes('/') || target.includes('#')) return whole;

			const paths = index.basenameMap.get(target.toLowerCase());
			if (!paths || paths.length < 2) return whole;

			// Use the first known path as the canonical (same as write order).
			// The display text is the original target name, or the explicit display if given.
			const canonical = paths[0];
			const displayText = display ?? target;
			return `${bang}[[${canonical}|${displayText}]]`;
		})
	);
}
