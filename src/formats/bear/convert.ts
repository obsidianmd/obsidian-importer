import { path } from '../../filesystem';
import { ILLEGAL_TAG_CHARS, sanitizeTag } from '../../util';

// Separators are allowed only inside tags.
const TAG_BODY = `[^${ILLEGAL_TAG_CHARS}\\s]`;
const TAG_EDGE = `[^${ILLEGAL_TAG_CHARS}\\s/-]`;

/**
 * A tag opens on a hash that begins a word. Bear escapes the hash of anything
 * it is only naming - the welcome note's own "**\#errands**" - so a hash that
 * follows a backslash, or any other character, is text rather than a tag.
 *
 * The space in front is taken with the tag, which is what closes the sentence
 * up when a tag is moved to a property. Whatever separates words counts, since
 * that is what the tags read out of the note are found by.
 */
const TAG = new RegExp(`([^\\S\\n]?)(?<!\\S)#([^\\s#]+)`, 'gu');

/** Bear closes a tag of several words with a second hash: "#two words#". */
const MULTI_WORD_TAG = new RegExp(
	`(?<!\\S)#(${TAG_EDGE}(?:${TAG_BODY}| )*${TAG_EDGE}|${TAG_EDGE})#(?!${TAG_BODY})`, 'gu');

/** What a tag cannot end on is the sentence around it, not part of the tag. */
const TAG_TAIL = new RegExp(`(?:(?!${TAG_EDGE})\\S)+$`, 'u');

const ASSET_LINK = /\[[^\]]*\]\((assets\/[^)]+)\)/gm;

/** Bear records a resized image in a comment after the link. */
const IMAGE_SIZE = /!\[([^\]]*)\]\(([^()\s]*)\)<!--\s*(\{[^}]*\})\s*-->/g;

const FENCE = /^\s*(`{3,}|~{3,})/;

/** A code span runs over a line ending, though never over a blank line. */
const CODE_SPAN = /`+(?:[^`\n]|\n(?![ \t]*\n))*`+/g;

/**
 * Bear underlines between single tildes. Obsidian reads a pair of them as
 * strikethrough and one as nothing at all, so the tag it does read is written
 * instead. What it wraps has to start and end on something other than a space,
 * which is what keeps a line of two paths from being read as one underline,
 * and an escaped tilde is a tilde someone wanted to show.
 */
const UNDERLINE = /(?<![~\\])~([^~\s\n\\](?:[^~\n]*[^~\s\n\\])?)~(?!~)/g;

/**
 * A colour is not a tag, however much it looks like one. Only one carrying a
 * digit: "#facade" is a word someone tagged with, "#c0ffee" is a colour.
 */
const HEX_COLOUR = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Where a placeholder standing in for code begins and ends. */
const MASKED = /\0(\d+)\0/g;

export type BearTagPlacement = 'inline' | 'property';

export interface BearConversionOptions {
	basename: string;
	parent: string;
	flattenTags: boolean;
	tagPlacement: BearTagPlacement;
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

/**
 * The note with its code replaced by placeholders, rewritten, and put back.
 *
 * A hash inside a fence or a code span is the thing being written about - the
 * note explaining Bear's own syntax, or a stylesheet - so no pass that reads
 * tags should see it. Masking rather than rewriting each stretch in turn keeps
 * every position a tag is judged by: what precedes a hash decides whether it
 * opens a tag at all.
 */
function withoutCode(content: string, rewrite: (content: string) => string): string {
	const code: string[] = [];

	return rewrite(maskCode(content, code)).replace(MASKED, (_match, index: string) => code[Number(index)]);
}

/** The same note to read rather than rewrite, so nothing has to be put back. */
function maskCode(content: string, code: string[] = []): string {
	const hide = (text: string) => `\0${code.push(text) - 1}\0`;
	let fence: string | null = null;

	// A fence is decided line by line; a span is not, so it is found afterwards
	const outsideFences = content.split('\n').map(line => {
		const delimiter = line.match(FENCE)?.[1];

		if (fence) {
			if (delimiter && delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null;
			return hide(line);
		}
		if (delimiter) {
			fence = delimiter;
			return hide(line);
		}

		return line;
	}).join('\n');

	return outsideFences.replace(CODE_SPAN, hide);
}

/** The tag a hash opens, and whatever punctuation followed it. */
function splitTag(run: string): { tag: string, tail: string } {
	const tail = run.match(TAG_TAIL)?.[0] ?? '';
	const body = tail ? run.slice(0, -tail.length) : run;

	// A number is a number: Bear has no tag made only of digits
	if (body === '' || /^\d+$/.test(body) || isColour(body)) return { tag: '', tail: run };

	return { tag: sanitizeTag(body, '_').replace(/_+/g, '_'), tail };
}

function isColour(body: string): boolean {
	return HEX_COLOUR.test(body) && /\d/.test(body);
}

export function extractTagsFromContent(content: string, flattenTags: boolean): string[] {
	const tags = new Set<string>();

	const readable = maskCode(content);
	const simpleTagRegex = new RegExp(`(?<!\\S)#(${TAG_EDGE}${TAG_BODY}*${TAG_EDGE}|${TAG_EDGE}+)(?!${TAG_BODY})`, 'gu');
	let matchSimple;
	while ((matchSimple = simpleTagRegex.exec(readable)) !== null) {
		const rawSimpleTag = matchSimple[1].trim();
		if (rawSimpleTag !== '' && !isColour(rawSimpleTag)) {
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

/**
 * A table renders only when a blank line separates it from the text above it,
 * and Bear writes one straight under the paragraph introducing it.
 */
export function separateTables(content: string): string {
	const lines = content.split('\n');
	const out: string[] = [];
	let fence: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const delimiter = line.match(FENCE)?.[1];

		if (fence) {
			if (delimiter && delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null;
		}
		else if (delimiter) {
			fence = delimiter;
		}
		else if (i > 0 && line.includes('|') && isTableDelimiter(lines[i + 1] ?? '') && lines[i - 1].trim() !== '') {
			out.push('');
		}

		out.push(line);
	}

	return out.join('\n');
}

/** The row of dashes under a table's headings, which is what makes it a table. */
function isTableDelimiter(line: string): boolean {
	return /^[\s|:-]*$/.test(line) && line.includes('-') && line.includes('|');
}

/** Bear's width comment, written as the width Obsidian reads off a link. */
export function applyImageSizes(content: string): string {
	return withoutCode(content, text => text.replace(IMAGE_SIZE, (match, alt: string, target: string, json: string) => {
		let size: string;
		try {
			const dimensions = JSON.parse(json) as { width?: unknown, height?: unknown };
			const width = Number(dimensions.width);
			const height = Number(dimensions.height);
			if (!Number.isFinite(width) || width <= 0) return match;
			size = Number.isFinite(height) && height > 0 ? `${width}x${height}` : `${width}`;
		}
		catch {
			return match;
		}

		return `![${alt === '' ? size : `${alt}|${size}`}](${target})`;
	}));
}

export function writeUnderlines(content: string): string {
	return withoutCode(content, text => text.replace(UNDERLINE, (_match, underlined: string) => `<u>${underlined}</u>`));
}

/** Bear's tag forms, written as tags Obsidian reads. */
function normalizeTags(content: string): string {
	return withoutCode(content, text => text
		.replace(MULTI_WORD_TAG, (_match, tag: string) => '#' + tag.replace(/\s+/g, '_'))
		.replace(TAG, (match, before: string, run: string) => {
			const { tag, tail } = splitTag(run);
			return tag === '' ? match : `${before}#${tag}${tail}`;
		}));
}

/** Take the tags out of the note, for a vault that keeps them in a property. */
function removeTags(content: string): string {
	return withoutCode(content, text => {
		const kept: string[] = [];

		for (const line of text.split('\n')) {
			const stripped = line.replace(TAG, (match, before: string, run: string) => {
				const { tag, tail } = splitTag(run);
				// The space in front of the tag goes with it, so the sentence closes up
				return tag === '' ? match : tail;
			});

			if (stripped === line) {
				kept.push(line);
			}
			else if (stripped.trim() !== '') {
				kept.push(stripped.replace(/[ \t]+$/, ''));
			}
			// A line that was nothing but tags leaves nothing behind
		}

		return kept.join('\n').replace(/\s+$/, '');
	});
}

export async function convertBearNote(
	mdContent: string,
	options: BearConversionOptions
): Promise<ConvertedBearNote> {
	const { basename, parent, flattenTags, tagPlacement, resolveAsset } = options;

	let content = removeMarkdownHeader(basename, mdContent);
	content = separateTables(content);
	content = applyImageSizes(content);
	content = writeUnderlines(content);

	for (const match of [...content.matchAll(ASSET_LINK)]) {
		const [fullMatch, linkPath] = match;
		const assetPath = path.join(parent, decodeURI(linkPath));

		const replacementPath = encodeURI(await resolveAsset(assetPath));

		content = content.replace(fullMatch, fullMatch.replace(linkPath, replacementPath));
	}

	content = normalizeTags(content);

	const tags = extractTagsFromContent(content, flattenTags);
	if (tagPlacement === 'property') {
		content = removeTags(content);
	}

	return { content, tags };
}
