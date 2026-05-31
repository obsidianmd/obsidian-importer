// Block identifiers and references.
//
// Logseq marks a block with `id:: <uuid>` and references it with `((uuid))`.
// Obsidian uses a short `^anchor` on the block line and `[[Page#^anchor]]` to
// reference it. We shorten the UUID to an idiomatic short anchor and keep a
// uuid -> {page, shortId} index so references across files resolve.

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

export function attachBlockIds(content: string, shorten: boolean): { content: string; ids: DefinedId[] } {
	const lines = content.split('\n');
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

	for (const line of lines) {
		const m = line.match(ID_LINE);
		if (m && lastContentIndex >= 0) {
			const uuid = m[2];
			const shortId = makeUnique(shorten ? shortenId(uuid) : uuid);
			ids.push({ uuid, shortId });
			if (!new RegExp(`\\^${shortId}\\s*$`).test(out[lastContentIndex])) {
				out[lastContentIndex] = out[lastContentIndex].replace(/\s*$/, '') + ` ^${shortId}`;
			}
			continue; // drop the id:: line
		}
		// Track the nearest preceding content line (non-blank, not a property).
		if (line.trim() !== '' && !/^\s*[A-Za-z0-9_.\-]+:: /.test(line)) {
			lastContentIndex = out.length;
		}
		out.push(line);
	}

	return { content: out.join('\n'), ids };
}

export function resolveBlockRefs(content: string, index: Map<string, BlockRefTarget>): string {
	// Block embeds: {{embed ((uuid))}} -> ![[Page#^shortId]]
	content = content.replace(/\{\{embed\s+\(\(([^()]+?)\)\)\}\}/g, (whole, uuid) => {
		const target = index.get(uuid.trim());
		return target ? `![[${target.page}#^${target.shortId}]]` : whole;
	});
	// Page embeds: {{embed [[Page]]}} -> ![[Page]]
	content = content.replace(/\{\{embed\s+\[\[([^\]]+?)\]\]\}\}/g, (_, page) => `![[${page}]]`);
	// Bare block references: ((uuid)) -> [[Page#^shortId]]
	content = content.replace(/\(\(([^()]+?)\)\)/g, (whole, uuid) => {
		const target = index.get(uuid.trim());
		return target ? `[[${target.page}#^${target.shortId}]]` : whole;
	});
	return content;
}
