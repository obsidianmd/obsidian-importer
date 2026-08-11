import { path } from '../../filesystem';
import { ILLEGAL_TAG_CHARS, sanitizeTag } from '../../util';

// Separators are allowed only inside tags.
const TAG_BODY = `[^${ILLEGAL_TAG_CHARS}\\s]`;
const TAG_EDGE = `[^${ILLEGAL_TAG_CHARS}\\s/-]`;

const ASSET_LINK = /\[[^\]]*\]\((assets\/[^)]+)\)/gm;

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

	const simpleTagRegex = new RegExp(`(?<!\\S)#(${TAG_EDGE}${TAG_BODY}*${TAG_EDGE}|${TAG_EDGE}+)(?!${TAG_BODY})`, 'gu');
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
	content = content.replace(/#([^\n#]+?[^\s])#/g, (_match, tag: string) => {
		return '#' + tag.replace(/\s+/g, '_');
	});

	content = content.replace(/#([^0-9\s#]+)/gu, (_match, tag: string) => {
		const cleanTag = sanitizeTag(tag, '_').replace(/_+/g, '_');
		return '#' + cleanTag;
	});

	return { content, tags: extractTagsFromContent(content, flattenTags) };
}
