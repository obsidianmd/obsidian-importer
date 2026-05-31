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

export function convertTags(content: string, convertToLinks: boolean): string {
	return outsideCode(content, line => {
		// #[[multi word tag]]
		line = line.replace(/(^|\s)#\[\[([^\]]+)\]\]/g, (_, pre, name) =>
			convertToLinks ? `${pre}[[${name}]]` : `${pre}#${name.replace(/\s+/g, '-')}`
		);
		// #simple-tag (letters, digits, /_-), must follow start or whitespace
		line = line.replace(/(^|\s)#([\w/-]+)/g, (m, pre, name) =>
			convertToLinks ? `${pre}[[${name}]]` : m
		);
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
