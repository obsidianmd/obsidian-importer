// Pure pass-1 conversion pipeline: everything that can be done on a single file
// without the vault-wide block/alias index. Kept obsidian-free so it is unit
// testable. The orchestrator runs the cross-file pass-2 steps (block-ref and
// alias-reference resolution, tag conversion) afterwards.

import { LogseqImportOptions } from './options';
import { extractPageProperties, convertHeadingProperty, removeLeftoverBlockProperties } from './properties';
import { convertTasks } from './tasks';
import { convertNumberedLists, convertOrgBlocks, convertHighlights, convertMediaEmbeds, fixCodeBlocksInLists, fixHeadingChildLists } from './blocks';
import { convertAssetLinks, AssetRef } from './assets';
import { convertAliasLinks } from './links';
import { convertJournalDateLinks } from './journals';
import { attachBlockIds, DefinedId } from './block-ids';
import { normalizeWhitespace } from './normalize';

export interface LocalResult {
	/** YAML frontmatter block (with fences) or '' when there are no page properties. */
	yaml: string;
	/** Converted body, still containing `((uuid))` refs, alias references, and tags for pass 2. */
	body: string;
	/** Raw page properties (e.g. alias/aliases/title) for index building. */
	raw: Record<string, string>;
	/** Block ids defined in this file (uuid -> short anchor). */
	ids: DefinedId[];
	/** Assets referenced by this file. */
	assets: AssetRef[];
}

export function convertLocal(content: string, options: LogseqImportOptions): LocalResult {
	const { yaml, body: initialBody, raw } = extractPageProperties(content, {
		dropPageProperties: options.dropPageProperties,
		dropTags: options.dropTags,
		snakeCasePageProperties: options.snakeCasePageProperties,
	});

	let body = initialBody;
	body = convertHeadingProperty(body);
	body = convertTasks(body, options.taskFormat, { logbook: options.logbook });
	body = convertNumberedLists(body);
	body = convertOrgBlocks(body);
	body = convertHighlights(body);
	body = convertMediaEmbeds(body);
	body = fixHeadingChildLists(body);
	body = fixCodeBlocksInLists(body);

	const assetResult = convertAssetLinks(body, { keepAltText: options.keepAssetAltText });
	body = assetResult.content;

	body = convertAliasLinks(body);
	// Note: convertTags is intentionally deferred to pass-2 in the orchestrator so it can
	// use the vault-wide page set for onlyExistingPages logic.
	body = convertJournalDateLinks(body);

	const idResult = attachBlockIds(body, options.shortenBlockIds);
	body = idResult.content;

	body = removeLeftoverBlockProperties(body, options.dropBlockProperties, options.blockProperties, options.snakeCaseBlockProperties);

	if (options.normalizeWhitespace) {
		body = normalizeWhitespace(body);
	}

	return { yaml, body, raw, ids: idResult.ids, assets: assetResult.assets };
}

/**
 * Register all aliases (and the title, if present) for a page in the shared alias map.
 * `raw` is the raw page properties from `convertLocal`.
 */
export function indexPageAliases(
	raw: Record<string, string>,
	canonical: string,
	aliasMap: Map<string, string>,
	ambiguous: Set<string>
): void {
	// Collect all alias values: alias/aliases properties plus the title:: value (G1).
	const aliasValues: string[] = [];
	if (raw.alias ?? raw.aliases) aliasValues.push(raw.alias ?? raw.aliases);
	if (raw.title) aliasValues.push(raw.title);
	for (const value of aliasValues) {
		for (const item of value.split(',')) {
			const name = item.trim().replace(/^\[\[(.*)\]\]$/, '$1').trim();
			if (!name) continue;
			const key = name.toLowerCase();
			const existing = aliasMap.get(key);
			if (existing !== undefined && existing !== canonical) ambiguous.add(key);
			else aliasMap.set(key, canonical);
		}
	}
}

/**
 * Returns true when the page has no meaningful content: no YAML frontmatter and
 * a blank/whitespace-only body. Used to skip writing empty output files.
 */
export function isBodyEmpty(yaml: string, body: string): boolean {
	return !yaml && !body.trim();
}

