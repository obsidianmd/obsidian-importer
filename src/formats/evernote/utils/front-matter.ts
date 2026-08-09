import { parseYaml } from 'obsidian';
import { serializeFrontMatter } from '../../../util';

/**
 * The note's properties, written the way the rest of the importer writes them.
 *
 * The template puts the delimiters in whether or not it has anything to put
 * between them, so a note with no tags and no source arrived fronted by an
 * empty block, and the spacing inside was the template's too. Reading the
 * block back and serializing it settles both, and leaves a note whose
 * properties are all missing without a block at all.
 */
const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n|$)/;

export const standardizeFrontMatter = (markdown: string): string => {
	const match = FRONT_MATTER.exec(markdown);
	if (!match) return markdown;

	const body = markdown.slice(match[0].length);

	let properties: unknown;
	try {
		properties = parseYaml(match[1]);
	}
	catch {
		// Something we cannot read is something we should not rewrite
		return markdown;
	}

	if (properties === null || properties === undefined) return body;
	if (typeof properties !== 'object' || Array.isArray(properties)) return markdown;

	return serializeFrontMatter(properties) + body;
};
