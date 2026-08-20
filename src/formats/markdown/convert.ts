import { FrontMatterCache } from 'obsidian';
import { ILLEGAL_TAG_CHARS, parseFrontMatterBlock, serializeFrontMatter } from '../../util';

const TAG_BODY = `[^${ILLEGAL_TAG_CHARS}\\s]`;
const TAG_EDGE = `[^${ILLEGAL_TAG_CHARS}\\s/-]`;

/** Tags require a word boundary, excluding link fragments. */
const TAG = new RegExp(`(?<!\\S)#(${TAG_EDGE}${TAG_BODY}*${TAG_EDGE}|${TAG_EDGE})(?!${TAG_BODY})`, 'gu');

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const BLANK = /^\s*$/;
const SPACE = /[ \t]/;

export interface MarkdownConversionOptions {
	tagsAsProperties: boolean;
}

export interface ConvertedMarkdown {
	markdown: string;
	tags: string[];
}

/** Mask code with spaces to preserve offsets. */
function maskCode(lines: string[]): string[] {
	const blockCode: boolean[] = [];

	let fence: string | null = null;
	let inIndentedCode = false;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const blank = BLANK.test(line);
		const fenceMatch = FENCE.exec(line);

		if (fence !== null) {
			blockCode.push(true);
			// Closing fences must match the opener and stand alone.
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && BLANK.test(fenceMatch[2])) {
				fence = null;
			}
			continue;
		}

		if (fenceMatch) {
			fence = fenceMatch[1];
			blockCode.push(true);
			inIndentedCode = false;
			continue;
		}

		// Indented code must follow a block boundary.
		if (INDENTED_CODE.test(line) && (inIndentedCode || index === 0 || BLANK.test(lines[index - 1]))) {
			inIndentedCode = true;
			blockCode.push(true);
			continue;
		}

		// Blank lines remain part of an indented code block.
		if (blank && inIndentedCode) {
			blockCode.push(true);
			continue;
		}

		if (!blank) inIndentedCode = false;
		blockCode.push(false);
	}

	const masked: string[] = [];
	for (let index = 0; index < lines.length;) {
		if (blockCode[index]) {
			masked.push(' '.repeat(lines[index].length));
			index++;
			continue;
		}
		if (BLANK.test(lines[index])) {
			masked.push(lines[index]);
			index++;
			continue;
		}

		let end = index + 1;
		while (end < lines.length && !blockCode[end] && !BLANK.test(lines[end])) end++;
		masked.push(...maskInlineCode(lines.slice(index, end).join('\n')).split('\n'));
		index = end;
	}

	return masked;
}

/** Mask inline code, including multiline spans. */
function maskInlineCode(content: string): string {
	let masked = '';

	for (let i = 0; i < content.length;) {
		if (content[i] !== '`') {
			masked += content[i++];
			continue;
		}

		let open = i;
		while (content[i] === '`') i++;
		const ticks = i - open;

		let close = i;
		while (close < content.length) {
			if (content[close] !== '`') {
				close++;
				continue;
			}

			let run = close;
			while (content[run] === '`') run++;
			if (run - close === ticks) break;
			close = run;
		}

		if (close >= content.length) {
			// Unmatched backticks open nothing, so the run itself is text.
			masked += content.slice(open, i);
			continue;
		}

		const end = close + ticks;
		masked += content.slice(open, end).replace(/[^\n]/g, ' ');
		i = end;
	}

	return masked;
}

/** Obsidian rejects all-numeric tags. */
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

		// Remove one adjacent separator without consuming indentation.
		if (start > at && SPACE.test(line[start - 1]) && /\S/u.test(line.slice(at, start))) start -= 1;
		else if (SPACE.test(line[end] ?? '')) end += 1;

		stripped += line.slice(at, start);
		at = end;
	}

	if (tags.length === 0) return { line, tags };

	stripped = (stripped + line.slice(at)).trimEnd();

	return { line: BLANK.test(stripped) ? '' : stripped, tags };
}

/** Move inline tags into frontmatter without rewriting unchanged notes. */
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

/** Drop tag-only lines without creating duplicate blank lines. */
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
