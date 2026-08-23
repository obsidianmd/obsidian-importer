import { LogseqImportOptions } from './options';
import { extractPageProperties, convertHeadingProperty, removeLeftoverBlockProperties } from './properties';
import { convertTasks } from './tasks';
import { convertNumberedLists, convertOrgBlocks, convertHighlights, convertMediaEmbeds, fixCodeBlocksInLists, fixHeadingChildLists } from './blocks';
import { convertAssetLinks, AssetRef } from './assets';
import { convertAliasLinks } from './links';
import { convertJournalDateLinks } from './journals';
import { attachBlockIds, DefinedId } from './block-ids';
import { normalizeWhitespace } from './normalize';
import { outsideMarkdownCode } from '../../markdown';

export interface LogseqConversionRuntime {
	assetTarget?: (sourcePath: string, filename: string) => string | null;
}

export interface LocalResult {
	yaml: string;
	/** Cross-file references and tags are resolved later. */
	body: string;
	raw: Record<string, string>;
	ids: DefinedId[];
	assets: AssetRef[];
	hasQueries: boolean;
}

export function convertLocal(
	content: string,
	options: LogseqImportOptions,
	runtime: LogseqConversionRuntime = {},
): LocalResult {
	const { yaml, body: initialBody, raw } = extractPageProperties(content, {
		dropPageProperties: options.dropPageProperties,
		dropTags: options.dropTags,
		snakeCasePageProperties: options.snakeCasePageProperties,
	});

	let body = initialBody;
	let hasQueries = false;
	body = convertHeadingProperty(body);
	body = convertTasks(body, options.taskFormat, { logbook: options.logbook });
	body = convertNumberedLists(body);
	body = convertOrgBlocks(body, {
		dropQueries: options.queries === 'drop',
		onQuery: () => hasQueries = true,
	});
	body = outsideMarkdownCode(body, segment => segment.replace(/\{\{query[\s\S]*?\}\}/gi, (whole: string) => {
		hasQueries = true;
		return options.queries === 'drop' ? '' : whole;
	}));
	body = convertHighlights(body);
	body = convertMediaEmbeds(body);
	body = fixHeadingChildLists(body);
	body = fixCodeBlocksInLists(body);

	const assetResult = convertAssetLinks(body, {
		keepAltText: options.keepAssetAltText,
		target: runtime.assetTarget
			? asset => runtime.assetTarget!(asset.sourcePath, asset.filename)
			: undefined,
	});
	body = assetResult.content;

	body = convertAliasLinks(body);
	// Tag conversion needs the complete page index.
	body = convertJournalDateLinks(body);

	const idResult = attachBlockIds(body, options.shortenBlockIds);
	body = idResult.content;

	body = removeLeftoverBlockProperties(body, options.dropBlockProperties, options.blockProperties, options.snakeCaseBlockProperties);

	if (options.normalizeWhitespace) {
		body = normalizeWhitespace(body);
	}

	return { yaml, body, raw, ids: idResult.ids, assets: assetResult.assets, hasQueries };
}

export function indexPageAliases(
	raw: Record<string, string>,
	canonical: string,
	aliasMap: Map<string, string>,
	ambiguous: Set<string>,
	knownPages: Set<string> = new Set(),
): void {
	const aliasValues: string[] = [];
	if (raw.alias) aliasValues.push(raw.alias);
	if (raw.aliases) aliasValues.push(raw.aliases);
	if (raw.title) aliasValues.push(raw.title);
	for (const value of aliasValues) {
		for (const item of value.split(',')) {
			const name = item.trim().replace(/^\[\[(.*)\]\]$/, '$1').trim();
			if (!name) continue;
			const key = name.toLowerCase();
			// A real page owns its name.
			if (knownPages.has(key)) continue;
			const existing = aliasMap.get(key);
			if (existing !== undefined && existing !== canonical) ambiguous.add(key);
			else aliasMap.set(key, canonical);
		}
	}
}

export function isBodyEmpty(yaml: string, body: string): boolean {
	return !yaml && !body.trim();
}
