import { path } from '../../filesystem';
import { ILLEGAL_TAG_CHARS, sanitizeTag } from '../../util';

// Separators are allowed only inside tags.
const TAG_BODY = `[^${ILLEGAL_TAG_CHARS}\\s\\0]`;
const TAG_EDGE = `[^${ILLEGAL_TAG_CHARS}\\s\\0/-]`;

const TAG = new RegExp(`([^\\S\\n]?)(?<!\\S)#([^\\s#\\0]+)`, 'gu');

const MULTI_WORD_TAG = new RegExp(
	`(?<!\\S)#(${TAG_EDGE}(?:${TAG_BODY}| )*${TAG_EDGE}|${TAG_EDGE})#(?!${TAG_BODY})`, 'gu');

const TAG_TAIL = new RegExp(`(?:(?!${TAG_EDGE})\\S)+$`, 'u');

const ASSET_LINK = /\[[^\]]*\]\((assets\/[^)]+)\)/gm;

const IMAGE_SIZE = /!\[([^\]]*)\]\(([^()\s]*)\)<!--\s*(\{[^}]*\})\s*-->/g;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/;

// CommonMark code-span delimiters use equal-length backtick runs.
const CODE_SPAN = /(?<!`)(`+)(?!`)(?:[^\n]|\n(?![ \t]*\n))*?(?<!`)\1(?!`)/g;

// Bear uses single tildes for underlines; Obsidian needs HTML.
const UNDERLINE = /(?<![~\\])~([^~\s\n\\](?:[^~\n]*[^~\s\n\\])?)~(?!~)/g;

// Require a digit so a word such as #facade remains a tag.
const HEX_COLOUR = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

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

// Mask code once so later conversions cannot modify examples.
function maskCode(content: string, code: string[]): string {
	const hide = (text: string) => `\0${code.push(text) - 1}\0`;
	const fenced = tracksFences();

	const outsideFences = content.split('\n')
		.map(line => fenced(line) ? hide(line) : line)
		.join('\n');

	return outsideFences.replace(CODE_SPAN, hide);
}

function unmaskCode(content: string, code: string[]): string {
	return content.replace(MASKED, (_match, index: string) => code[Number(index)]);
}

function tracksFences(): (line: string) => boolean {
	let fence: string | null = null;

	return line => {
		if (fence) {
			const closing = line.match(FENCE_CLOSE)?.[1];
			if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = null;
			return true;
		}

		fence = line.match(FENCE)?.[1] ?? null;
		return fence !== null;
	};
}

function splitTag(run: string): { tag: string, tail: string } {
	const tail = run.match(TAG_TAIL)?.[0] ?? '';
	const body = tail ? run.slice(0, -tail.length) : run;

	if (body === '' || /^\d+$/.test(body) || isColour(body)) return { tag: '', tail: run };

	return { tag: sanitizeTag(body, '_').replace(/_+/g, '_'), tail };
}

function isColour(body: string): boolean {
	return HEX_COLOUR.test(body) && /\d/.test(body);
}

function extractTagsFromContent(content: string, flattenTags: boolean): string[] {
	const tags = new Set<string>();

	const simpleTagRegex = new RegExp(`(?<!\\S)#(${TAG_EDGE}${TAG_BODY}*${TAG_EDGE}|${TAG_EDGE}+)(?!${TAG_BODY})`, 'gu');
	let matchSimple;
	while ((matchSimple = simpleTagRegex.exec(content)) !== null) {
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

// Bear omits the blank line Obsidian needs before a table.
function separateTables(content: string): string {
	const lines = content.split('\n');
	const out: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (i > 0 && line.includes('|')
			&& isTableDelimiter(lines[i + 1] ?? '') && lines[i - 1].trim() !== '') {
			out.push('');
		}

		out.push(line);
	}

	return out.join('\n');
}

function isTableDelimiter(line: string): boolean {
	return /^[\s|:-]*$/.test(line) && line.includes('-') && line.includes('|');
}

function applyImageSizes(content: string): string {
	return content.replace(IMAGE_SIZE, (match, alt: string, target: string, json: string) => {
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
	});
}

function writeUnderlines(content: string): string {
	return content.replace(UNDERLINE, (_match, underlined: string) => `<u>${underlined}</u>`);
}

function normalizeTags(content: string): string {
	return content
		.replace(MULTI_WORD_TAG, (_match, tag: string) => '#' + tag.replace(/\s+/g, '_'))
		.replace(TAG, (match, before: string, run: string) => {
			const { tag, tail } = splitTag(run);
			return tag === '' ? match : `${before}#${tag}${tail}`;
		});
}

function removeTags(content: string): string {
	const kept: string[] = [];

	for (const line of content.split('\n')) {
		const stripped = line.replace(TAG, (match, before: string, run: string) => {
			const { tag, tail } = splitTag(run);
			return tag === '' ? match : tail;
		});

		if (stripped === line) {
			kept.push(line);
		}
		else if (stripped.trim() !== '') {
			kept.push(stripped.replace(/[ \t]+$/, ''));
		}
	}

	return kept.join('\n').replace(/\s+$/, '');
}

export async function convertBearNote(
	mdContent: string,
	options: BearConversionOptions
): Promise<ConvertedBearNote> {
	const { basename, parent, flattenTags, tagPlacement, resolveAsset } = options;

	const code: string[] = [];
	let content = maskCode(removeMarkdownHeader(basename, mdContent), code);

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

	return { content: unmaskCode(content, code), tags };
}
