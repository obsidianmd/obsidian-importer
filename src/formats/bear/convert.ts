/**
 * A Bear note as markdown, separate from the importer that writes it.
 *
 * Bear's backup is markdown already, so the work is what surrounds it: an H1
 * repeating the file name, tags written in Bear's own forms, and asset links
 * pointing inside the archive. Where an asset lands in the vault is the
 * caller's, passed in as a callback.
 */
import { path } from '../../filesystem';

/** Matches an asset link: [caption](assets/something.jpg) */
const ASSET_LINK = /\[[^\]]*\]\((assets\/[^)]+)\)/gm;

/**
 * Diacritics range from
 * https://stackoverflow.com/questions/30225552/regex-for-diacritics
 */
const LETTER = 'A-Za-zÀ-ÖØ-öø-įĴ-őŔ-žǍ-ǰǴ-ǵǸ-țȞ-ȟȤ-ȳɃɆ-ɏḀ-ẞƀ-ƓƗ-ƚƝ-ơƤ-ƥƫ-ưƲ-ƶẠ-ỿ';

export interface BearConversionOptions {
	/** The note's file name, which an H1 repeating it is dropped for. */
	basename: string;
	/** The note's folder inside the backup, which its assets are relative to. */
	parent: string;
	/** Whether a nested tag becomes one tag per level. */
	flattenTags: boolean;
	/** Where an asset referenced by the note lands in the vault. */
	resolveAsset: (assetPath: string) => Promise<string>;
}

export interface ConvertedBearNote {
	content: string;
	/** Tags found in the body, for the note's frontmatter. */
	tags: string[];
}

/** Removes an H1 that is the first line of the content iff it matches the filename or is empty. */
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

	// Extract simple #tags (alphanumeric, underscore, hyphen, and slash, no spaces)
	//    Ensures it's not part of a URL or an already processed enclosed tag.
	//    Allows / in the middle of the tag, but not at the start or end of the simple tag.
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

		// Don't allow spaces in the file name.
		const replacementPath = encodeURI(await resolveAsset(assetPath));

		// NOTE: We can't use metadataCache.fileToLinktext to potentially shorten
		// the path because the attachment might not yet exist, so we can't get a TFile.
		content = content.replace(fullMatch, fullMatch.replace(linkPath, replacementPath));
	}

	// Replace spaces in enclosed tags with underscores and make them classic tags
	content = content.replace(/#([^\n#]+?[^\s])#/g, (_match, tag) => { // require non-space before closing to avoid using next tag's opening #
		return '#' + tag.replace(/\s+/g, '_');
	});

	// Remove special characters in simple tags
	content = content.replace(/#([^0-9\s#]+)/g, (_match, tag) => {
		let cleanTag = tag.replace(new RegExp(`[^${LETTER}0-9_/-]`, 'g'), '_');
		cleanTag = cleanTag.replace(/_+/g, '_'); // collapse multiple underscores
		return '#' + cleanTag;
	});

	return { content, tags: extractTagsFromContent(content, flattenTags) };
}
