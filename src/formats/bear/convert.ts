import { path } from '../../filesystem';

const ASSET_LINK = /\[[^\]]*\]\((assets\/[^)]+)\)/gm;

const LETTER = 'A-Za-zÀ-ÖØ-öø-įĴ-őŔ-žǍ-ǰǴ-ǵǸ-țȞ-ȟȤ-ȳɃɆ-ɏḀ-ẞƀ-ƓƗ-ƚƝ-ơƤ-ƥƫ-ưƲ-ƶẠ-ỿ';

export interface BearConversionOptions {
	basename: string;
	parent: string;
	flattenTags: boolean;
	resolveAsset: (assetPath: string) => Promise<string>;
}

export interface ConvertedBearNote {
	content: string;
	tags: string[];
}

export function removeMarkdownHeader(mdFilename: string, mdContent: string): string {
	if (!mdContent.startsWith('# ')) {
		return mdContent;
	}

	const idx = mdContent.indexOf('\n');
	let heading = idx > 0
		? mdContent.substring(2, idx)
		: mdContent.substring(2);
	heading = heading.trim();

	if (heading !== mdFilename.trim() && heading !== '') {
		return mdContent;
	}

	return idx > 0
		? mdContent.substring(idx + 1)
		: '';
}

export function extractTagsFromContent(content: string, flattenTags: boolean): string[] {
	const tags = new Set<string>();

	const simpleTagRegex = new RegExp(`(?<!\\S)#([${LETTER}0-9_][${LETTER}0-9_/-]*[${LETTER}0-9_]|[${LETTER}0-9_]+)(?![#\\w/])`, 'g');
	let matchSimple;
	while ((matchSimple = simpleTagRegex.exec(content)) !== null) {
		const rawSimpleTag = matchSimple[1].trim();
		if (rawSimpleTag !== '') {
			if (flattenTags && rawSimpleTag.includes('/')) {
				const parts = rawSimpleTag.split('/');
				for (const part of parts) {
					tags.add(part);
				}
			}
			else {
				tags.add(rawSimpleTag);
			}
		}
	}

	return Array.from(tags);
}

export async function convertBearNote(
	mdContent: string,
	options: BearConversionOptions
): Promise<ConvertedBearNote> {
	const { basename, parent, flattenTags, resolveAsset } = options;

	let content = removeMarkdownHeader(basename, mdContent);

	for (const match of [...content.matchAll(ASSET_LINK)]) {
		const [fullMatch, linkPath] = match;
		const assetPath = path.join(parent, decodeURI(linkPath));

		const replacementPath = encodeURI(await resolveAsset(assetPath));

		content = content.replace(fullMatch, fullMatch.replace(linkPath, replacementPath));
	}

	// Require content before the closing # so the next tag is not consumed.
	content = content.replace(/#([^\n#]+?[^\s])#/g, (_match, tag) => {
		return '#' + tag.replace(/\s+/g, '_');
	});

	content = content.replace(/#([^0-9\s#]+)/g, (_match, tag) => {
		let cleanTag = tag.replace(new RegExp(`[^${LETTER}0-9_/-]`, 'g'), '_');
		cleanTag = cleanTag.replace(/_+/g, '_');
		return '#' + cleanTag;
	});

	return { content, tags: extractTagsFromContent(content, flattenTags) };
}
