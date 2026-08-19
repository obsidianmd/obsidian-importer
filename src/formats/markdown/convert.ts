/**
 * The markdown conversion, outside Obsidian.
 *
 * Markdown in, markdown out. The importer around this decides where a note
 * lands; everything here works on one document's text.
 */
import { FrontMatterCache } from 'obsidian';
import { ILLEGAL_TAG_CHARS, parseFrontMatterBlock, serializeFrontMatter } from '../../util';

const TAG_BODY = `[^${ILLEGAL_TAG_CHARS}\\s]`;
const TAG_EDGE = `[^${ILLEGAL_TAG_CHARS}\\s/-]`;

/** A tag starts a word, so `note#heading` and `url#fragment` are not tags. */
const TAG = new RegExp(`(?<!\\S)#(${TAG_EDGE}${TAG_BODY}*${TAG_EDGE}|${TAG_EDGE})(?!${TAG_BODY})`, 'gu');

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const BLANK = /^\s*$/;
const SPACE = /[ \t]/;

export interface MarkdownConversionOptions {
	/** Move inline #tags out of the body and into the note's tags property. */
	tagsAsProperties: boolean;
}

export interface ConvertedMarkdown {
	markdown: string;
	/** Tags moved into the property, in the order they appeared. */
	tags: string[];
}

/** A copy of the body with code replaced by spaces, so offsets still line up. */
function maskCode(lines: string[]): string[] {
	const masked: string[] = [];

	let fence: string | null = null;
	let inIndentedCode = false;

	for (const line of lines) {
		const blank = BLANK.test(line);
		const fenceMatch = FENCE.exec(line);

		if (fence !== null) {
			masked.push(' '.repeat(line.length));
			// A closing fence is the same character, at least as long, and alone.
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && BLANK.test(fenceMatch[2])) {
				fence = null;
			}
			continue;
		}

		if (fenceMatch) {
			fence = fenceMatch[1];
			masked.push(' '.repeat(line.length));
			inIndentedCode = false;
			continue;
		}

		// An indented block is only code where a paragraph could not continue.
		if (INDENTED_CODE.test(line) && (inIndentedCode || masked.length === 0 || BLANK.test(lines[masked.length - 1]))) {
			inIndentedCode = true;
			masked.push(' '.repeat(line.length));
			continue;
		}

		if (!blank) inIndentedCode = false;

		masked.push(maskInlineCode(line));
	}

	return masked;
}

/** Blank out `code spans`, matching a run of backticks with one the same length. */
function maskInlineCode(line: string): string {
	let masked = '';

	for (let i = 0; i < line.length;) {
		if (line[i] !== '`') {
			masked += line[i++];
			continue;
		}

		let open = i;
		while (line[i] === '`') i++;
		const ticks = i - open;

		let close = i;
		while (close < line.length) {
			if (line[close] !== '`') {
				close++;
				continue;
			}

			let run = close;
			while (line[run] === '`') run++;
			if (run - close === ticks) break;
			close = run;
		}

		if (close >= line.length) {
			// Unmatched backticks open nothing, so the rest of the line is text.
			masked += line.slice(open, i);
			continue;
		}

		const end = close + ticks;
		masked += ' '.repeat(end - open);
		i = end;
	}

	return masked;
}

/** Obsidian does not read a run of digits as a tag: `#1` is a number. */
function isTag(tag: string): boolean {
	return !/^\d+$/.test(tag);
}

function tagList(value: unknown): string[] {
	if (typeof value === 'string') return value.split(/[,\s]+/u).filter(tag => tag !== '');
	if (!Array.isArray(value)) return [];

	return value
		.filter(tag => typeof tag === 'string' || typeof tag === 'number')
		.map(tag => String(tag).trim())
		.filter(tag => tag !== '');
}

/** Existing tags first, then the ones found in the body, matched case-insensitively. */
function mergeTags(existing: string[], found: string[]): string[] {
	const merged: string[] = [];
	const seen = new Set<string>();

	for (const tag of [...existing, ...found]) {
		const key = tag.replace(/^#/, '');
		if (key === '' || seen.has(key.toLowerCase())) continue;

		seen.add(key.toLowerCase());
		merged.push(key);
	}

	return merged;
}

/**
 * Take the tags out of a line, and say what is left of it.
 *
 * A line that held nothing but tags is left empty for the caller to drop, so
 * that a note ending in a line of tags does not end in an empty one instead.
 */
function stripTags(line: string, masked: string): { line: string, tags: string[] } {
	const tags: string[] = [];
	let stripped = '';
	let at = 0;

	TAG.lastIndex = 0;
	for (let match = TAG.exec(masked); match; match = TAG.exec(masked)) {
		if (!isTag(match[1])) continue;

		tags.push(match[1]);

		let start = match.index;
		let end = start + match[0].length;

		// The space that held the tag apart goes with it, or the words around
		// it are left doubly spaced. Which of the two spaces it can spare is
		// the one that is not holding the line's indent.
		if (start > at && SPACE.test(line[start - 1]) && /\S/u.test(line.slice(at, start))) start -= 1;
		else if (SPACE.test(line[end] ?? '')) end += 1;

		stripped += line.slice(at, start);
		at = end;
	}

	if (tags.length === 0) return { line, tags };

	stripped = (stripped + line.slice(at)).trimEnd();

	return { line: BLANK.test(stripped) ? '' : stripped, tags };
}

/**
 * Move the inline tags of a note into its tags property.
 *
 * The frontmatter is rewritten only when there is a tag to add, so a note
 * without one is passed through as it was written rather than reserialized.
 */
export function convertMarkdownNote(content: string, options: MarkdownConversionOptions): ConvertedMarkdown {
	if (!options.tagsAsProperties) return { markdown: content, tags: [] };

	const parsed = parseFrontMatterBlock(content);
	const body = parsed ? parsed.body : content;

	const lines = body.split('\n');
	const masked = maskCode(lines);

	const found: string[] = [];
	const kept: string[] = [];
	const emptied: boolean[] = [];

	for (let i = 0; i < lines.length; i++) {
		const { line, tags } = stripTags(lines[i], masked[i]);
		found.push(...tags);
		kept.push(line);
		emptied.push(tags.length > 0 && line === '' && lines[i] !== '');
	}

	if (found.length === 0) return { markdown: content, tags: [] };

	const frontMatter: FrontMatterCache = parsed ? { ...parsed.frontMatter } : {};
	const tags = mergeTags(tagList(frontMatter.tags), found);
	frontMatter.tags = tags;

	return {
		markdown: serializeFrontMatter(frontMatter) + dropEmptied(kept, emptied).join('\n'),
		tags,
	};
}

/**
 * Remove the lines the tags were all that was on, without leaving a gap where
 * one stood between two blank lines.
 */
function dropEmptied(lines: string[], emptied: boolean[]): string[] {
	const kept: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (!emptied[i]) {
			kept.push(lines[i]);
			continue;
		}

		const after = lines[i + 1];
		const between = BLANK.test(kept[kept.length - 1] ?? '') && after !== undefined && BLANK.test(after);
		if (between) i++;
	}

	return kept;
}
