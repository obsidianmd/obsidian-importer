// Block identifiers and references.
//
// Logseq marks a block with `id:: <uuid>` and references it with `((uuid))`.
// Obsidian uses a short `^anchor` on the block line and `[[Page#^anchor]]` to
// reference it. We shorten the UUID to an idiomatic short anchor and keep a
// uuid -> {page, shortId} index so references across files resolve.

import { markdownFenceLines, outsideMarkdownCode } from '../../markdown';

export interface DefinedId {
	uuid: string;
	shortId: string;
}

export interface BlockRefTarget {
	page: string;
	shortId: string;
}

// `id::` as an indented block property, or flattened onto its own bullet.
const ID_LINE = /^(\s*)(?:- )?id:: ?([0-9a-fA-F-]{6,})\s*$/;

/** Derive a short, Obsidian-legal anchor (letters/numbers/dashes) from a UUID. */
export function shortenId(uuid: string): string {
	const base = uuid.replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
	return base.length > 0 ? base : 'ref';
}

export function attachBlockIds(content: string, shorten: boolean): { content: string, ids: DefinedId[] } {
	const lines = content.split('\n');
	const fenced = markdownFenceLines(content);
	const out: string[] = [];
	const ids: DefinedId[] = [];
	const used = new Set<string>();
	let lastContentIndex = -1;

	const makeUnique = (candidate: string): string => {
		if (!used.has(candidate)) {
			used.add(candidate);
			return candidate;
		}
		let i = 1;
		while (used.has(`${candidate}-${i}`)) i++;
		const result = `${candidate}-${i}`;
		used.add(result);
		return result;
	};

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		if (fenced[lineIndex]) {
			if (line.trim() !== '') lastContentIndex = out.length;
			out.push(line);
			continue;
		}
		const m = line.match(ID_LINE);
		if (m && lastContentIndex >= 0) {
			const uuid = m[2];
			const indent = m[1];
			const shortId = makeUnique(shorten ? shortenId(uuid) : uuid);
			ids.push({ uuid, shortId });
			const target = out[lastContentIndex];
			if (!new RegExp(`\\^${shortId}\\s*$`).test(target)) {
				// G1: anchor after a closing fence (appending breaks CommonMark)
				if (/^[ \t]*(?:[-*+]\s+)?[`~]{3,}[ \t]*$/.test(target)) {
					out.push(indent + `^${shortId}`);
					lastContentIndex = out.length - 1;
				}
				// G1: anchor on its own line below a heading. Strip optional bullet
				// prefix before testing for heading syntax (Logseq headings are bullets).
				else if (/^#{1,6} /.test(target.trimStart().replace(/^-\s+/, ''))) {
					const isBulletHeading = /^\s*-\s+#{1,6} /.test(target);
					if (isBulletHeading) {
						// Outline mode: indent anchor at content level (id:: line's indent).
						out.push(indent + `^${shortId}`);
					}
					else {
						// Plain heading (rare): anchor directly below, no blank line.
						out.push(`^${shortId}`);
					}
					lastContentIndex = out.length - 1;
				}
				else {
					out[lastContentIndex] = target.replace(/\s*$/, '') + ` ^${shortId}`;
				}
			}
			continue; // drop the id:: line
		}
		// G1: track the nearest preceding non-blank line as anchor target
		// (including retained property lines).
		if (line.trim() !== '') {
			lastContentIndex = out.length;
		}
		out.push(line);
	}

	return { content: out.join('\n'), ids };
}

export function resolveBlockRefs(
	content: string,
	index: Map<string, BlockRefTarget>,
	opts: { alwaysEmbedBlockRefs?: boolean } = {},
): string {
	const alwaysEmbed = opts.alwaysEmbedBlockRefs ?? false;
	// Deliberately keep copy-pasteable Logseq examples inert. A reference in
	// inline or fenced code describes syntax; it is not part of the graph.
	return outsideMarkdownCode(content, segment => resolveSegment(segment, index, alwaysEmbed));
}

function resolveSegment(text: string, index: Map<string, BlockRefTarget>, alwaysEmbed: boolean): string {
	// Block embeds: {{embed ((uuid))}} -> ![[Page#^shortId]]
	text = text.replace(/\{\{embed\s+\(\(([^()]+?)\)\)\}\}/g, (whole, uuid) => {
		const target = index.get(uuid.trim());
		return target ? `![[${target.page}#^${target.shortId}]]` : whole;
	});
	// Page embeds: {{embed [[Page]]}} -> ![[Page]]
	text = text.replace(/\{\{embed\s+\[\[([^\]]+?)\]\]\}\}/g, (_, page) => `![[${page}]]`);
	// Bare block references: ((uuid)) -> [[Page#^shortId]] or ![[...]] when alwaysEmbed
	text = text.replace(/\(\(([^()]+?)\)\)/g, (whole, uuid) => {
		const target = index.get(uuid.trim());
		if (!target) return whole;
		return alwaysEmbed
			? `![[${target.page}#^${target.shortId}]]`
			: `[[${target.page}#^${target.shortId}]]`;
	});
	return text;
}

/**
 * Remove block references and block embeds that could not be resolved (i.e. the uuid
 * does not appear in the block index). Resolved references are already rewritten to
 * `[[Page#^id]]` form by resolveBlockRefs, so by the time this runs only raw
 * `((uuid))` / `{{embed ((uuid))}}` patterns remain as orphans.
 */
export function removeOrphanBlockRefs(content: string): string {
	return outsideMarkdownCode(content, removeOrphanBlockRefSegment);
}

function removeOrphanBlockRefSegment(content: string): string {
	return content
		.replace(/\{\{embed\s+\(\([^()]+?\)\)\}\}/g, '')
		.replace(/\(\([^()]+?\)\)/g, '')
		.split('\n')
		.map(line => (/^\s*[-*+]?\s*$/.test(line) ? '' : line))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n');
}
