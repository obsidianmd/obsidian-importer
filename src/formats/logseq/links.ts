// Wikilink, alias, and tag conversions.
//
// Logseq and Obsidian both have `[[wikilinks]]`, but Logseq writes aliased
// links as `[display]([[Page]])` and, crucially, lets you *reference a page by
// one of its aliases*. Obsidian links must target the canonical note name, so
// alias references have to be rewritten to `[[Canonical|Alias]]`.

import { outsideMarkdownCode } from '../../markdown';

export interface LinkIndex {
	/** alias (lower-cased) -> canonical page name. Ambiguous aliases excluded. */
	aliasMap: Map<string, string>;
}

export function convertAliasLinks(content: string): string {
	return outsideMarkdownCode(content, segment =>
		// [display]([[Target]]) -> [[Target|display]]. G1: strip any pre-existing pipe from target.
		segment.replace(/\[([^\]]+)\]\(\[\[([^\]]+)\]\]\)/g, (_, display, target) => `[[${target.split('|')[0]}|${display}]]`)
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

	return outsideMarkdownCode(content, segment => {
		// #[[multi word tag]]
		segment = segment.replace(/(^|[\s([])#\[\[([^\]]+)\]\]/g, (_, pre, name) => {
			if (dropTags.has(name) || dropTags.has(name.replace(/\s+/g, '-'))) return pre;
			if (toLinks) {
				if (onlyExistingPages && !knownPages.has(name.toLowerCase())) return `${pre}#${name.replace(/\s+/g, '-')}`;
				return `${pre}[[${name}]]`;
			}
			return `${pre}#${name.replace(/\s+/g, '-')}`;
		});
		// #simple-tag (letters, digits, /_-), must follow start, whitespace, or `([`
		segment = segment.replace(/(^|[\s([])#([\w/-]+)/g, (m, pre, name) => {
			// H1: CSS hex colours are not tags (RGB, RGBA, RRGGBB, or RRGGBBAA).
			if (/^(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(name)) return m;
			if (dropTags.has(name)) return pre;
			if (toLinks) {
				if (onlyExistingPages && !knownPages.has(name.toLowerCase())) return m;
				return `${pre}[[${name}]]`;
			}
			return m;
		});
		return segment;
	});
}

export function rewriteAliasReferences(content: string, index: LinkIndex): string {
	if (index.aliasMap.size === 0) return content;
	return outsideMarkdownCode(content, segment =>
		segment.replace(/(!?)\[\[([^\]]+)\]\]/g, (whole, bang, inner) => {
			const pipe = inner.indexOf('|');
			const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
			const display = pipe >= 0 ? inner.slice(pipe + 1) : target;
			if (target.includes('#')) return whole; // block/heading ref, not a page alias
			const canonical = index.aliasMap.get(target.toLowerCase());
			if (!canonical) return whole;
			// G1: skip if the alias resolves to the same name (would produce [[Name|Name]])
			if (canonical.toLowerCase() === target.toLowerCase()) return whole;
			return `${bang}[[${canonical}|${display}]]`;
		})
	);
}

export interface PlannedPageLink {
	target: string;
	/** Preserve the source page name when collision handling renamed the note. */
	display?: string;
}

/** Point source page names at the collision-safe paths selected by the importer. */
export function rewritePlannedPageLinks(content: string, pages: Map<string, PlannedPageLink>): string {
	if (pages.size === 0) return content;

	return outsideMarkdownCode(content, segment =>
		segment.replace(/(!?)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
			(whole, bang: string, sourceTarget: string, suffix = '', sourceDisplay?: string) => {
				const planned = pages.get(sourceTarget.trim().toLowerCase());
				if (!planned) return whole;

				const display = sourceDisplay ?? planned.display;
				return `${bang}[[${planned.target}${suffix}${display ? `|${display}` : ''}]]`;
			})
	);
}
