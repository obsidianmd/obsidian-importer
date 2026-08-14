/**
 * The markdown every importer writes, in the form this vault writes it.
 *
 * Conversions produce what they find natural - four spaces a level, or tabs -
 * and the vault's preferences are applied here instead, so the same note does
 * not import differently depending on where it came from.
 */
import { App, CachedMetadata, DataWriteOptions, parseLinktext, TFile, Vault } from 'obsidian';
import { stringToUtf8 } from './util';

export interface MarkdownOutput {
	indentUnit: string;
}

/** The step a conversion indents by before this runs. A tab counts as one too. */
const CONVERSION_STEP = 4;

const LIST_MARKER = /^(?:[-*+]|\d+[.)])(?:[ \t]+|\r?$)/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
/** A fence closes on its own delimiter, at least as long, and nothing after it. */
const FENCE_CLOSE = /^(`{3,}|~{3,})[ \t]*\r?$/;
/** "***" and "* * *" open with what looks like a bullet, and are not one. */
const THEMATIC_BREAK = /^([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$/;

/** Indenting this far past its item's text makes a line code, not a nested list. */
const CODE_INDENT = 4;

/** The bullet Obsidian itself writes, in turndown and in the editor. */
const BULLET = '-';

export function markdownOutputFor(vault: Vault): MarkdownOutput {
	// Not tabSize: that is how wide a tab is drawn, and spaces are always four
	return { indentUnit: vault.getConfig('useTab') ? '\t' : '    ' };
}

/**
 * What writing this content would put in the file.
 *
 * Compare against this rather than the converter's own output, or a note that
 * was formatted on the way in never matches and is rewritten every import.
 */
export function formattedMarkdown(vault: Vault, content: string): string {
	return formatMarkdown(content, markdownOutputFor(vault));
}

export async function createMarkdown(vault: Vault, path: string, content: string, options?: DataWriteOptions): Promise<TFile> {
	return await vault.create(path, formattedMarkdown(vault, content), options);
}

export async function modifyMarkdown(vault: Vault, file: TFile, content: string, options?: DataWriteOptions): Promise<void> {
	return await vault.modify(file, formattedMarkdown(vault, content), options);
}

type MarkdownChange = { from: number, to: number, text: string };

function escapePipes(text: string): string {
	return text.replace(/(\\*)\|/g, (pipe: string, slashes: string) =>
		slashes.length % 2 === 0 ? `${slashes}\\|` : pipe);
}

/**
 * Write resolvable vault links the same way Obsidian's editor creates them.
 *
 * Converters may naturally emit either wikilinks or Markdown links. Waiting
 * until the import is complete means their targets exist, so Obsidian can
 * apply both `useMarkdownLinks` and `newLinkFormat` without each converter
 * having to reproduce link resolution itself.
 */
export async function standardizedMarkdown(app: App, sourcePath: string, content: string): Promise<string> {
	content = formattedMarkdown(app.vault, content);
	return await standardizeLinks(app, sourcePath, content);
}

async function standardizeLinks(app: App, sourcePath: string, content: string): Promise<string> {
	const cache = await computeMetadata(app, content);
	if (!cache) return content;

	const tables = (cache.sections ?? []).filter(section => section.type === 'table');
	const inTable = (offset: number) => tables.some(({ position }) =>
		offset >= position.start.offset && offset < position.end.offset);

	const changes: MarkdownChange[] = [];
	for (const { reference, embed } of [
		...(cache.links ?? []).map(reference => ({ reference, embed: false })),
		...(cache.embeds ?? []).map(reference => ({ reference, embed: true })),
	]) {
		const { path, subpath } = parseLinktext(reference.link);
		const target = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
		if (!target) continue;

		let text = app.fileManager.generateMarkdownLink(target, sourcePath, subpath, reference.displayText);
		if (embed) text = '!' + text;
		if (inTable(reference.position.start.offset)) text = escapePipes(text);
		changes.push({ from: reference.position.start.offset, to: reference.position.end.offset, text });
	}

	changes.sort((a, b) => b.from - a.from);
	for (const change of changes) {
		content = content.slice(0, change.from) + change.text + content.slice(change.to);
	}

	return content;
}

/** Standardize an imported file without changing its imported timestamps. */
export async function standardizeMarkdownFile(app: App, file: TFile): Promise<void> {
	const original = await app.vault.read(file);
	const standardized = await standardizeLinks(app, file.path, formattedMarkdown(app.vault, original));
	if (standardized === original) return;

	await app.vault.modify(file, standardized, { ctime: file.stat.ctime, mtime: file.stat.mtime });
}

async function computeMetadata(app: App, content: string): Promise<CachedMetadata | null> {
	const cache = app.metadataCache as typeof app.metadataCache & {
		computeMetadataAsync?: (content: ArrayBuffer) => Promise<CachedMetadata>;
	};

	return cache.computeMetadataAsync
		? await cache.computeMetadataAsync(stringToUtf8(content))
		: null;
}

/**
 * Write a list the way this vault writes one: its indent, and Obsidian's bullet.
 *
 * Only in front of a list item and the lines that belong to one, so a note
 * indented for some other reason is left as it was.
 */
export function formatMarkdown(content: string, { indentUnit }: MarkdownOutput): string {
	const lines = content.split('\n');

	// Where a fence's contents sit and where they are going, so code indented
	// four spaces moves with its fence rather than being read as a level
	let fenceFrom: string | null = null;
	let fenceTo: string | null = null;
	// The delimiter that opened it. A ``` line inside a ```` fence is code
	let fenceDelimiter = '';
	// A fence in a list cannot be closed by a line that has left that list item
	let fenceContainer = 0;
	// A stack restores the parent's text column when a nested item is left
	const items: { marker: number, text: number }[] = [];
	let blank = false;
	let codeFloor = -1;

	for (let i = frontMatterEnd(lines); i < lines.length; i++) {
		const line = lines[i];
		const indent = line.match(/^[\t ]*/)![0];
		const rest = line.slice(indent.length);
		const indentColumn = columns(indent);

		if (fenceFrom !== null) {
			// A blank line has left nothing: it neither ends the item nor the fence
			if (rest.trim() === '' || indentColumn >= fenceContainer) {
				// Move the code with its opening fence, but measure a close from the
				// list container: up to three spaces are allowed beyond that point
				if (line.startsWith(fenceFrom)) lines[i] = fenceTo + line.slice(fenceFrom.length);
				if (closes(rest, fenceDelimiter, indentColumn - fenceContainer)) fenceFrom = fenceTo = null;
				continue;
			}

			// Leaving the list item implicitly ends its fence. This line belongs to
			// the outer container, so process it again as ordinary Markdown below
			fenceFrom = fenceTo = null;
		}

		if (rest.trim() === '') { // A blank line does not end the item
			blank = true;
			continue;
		}

		// An indented code block inside the item, which runs until the indent drops
		if (codeFloor >= 0 && indentColumn >= codeFloor) {
			blank = false;
			continue;
		}
		codeFloor = -1;

		while (items.length && indentColumn < items[items.length - 1].text) items.pop();
		const item = items[items.length - 1];

		if (item && blank && indentColumn >= item.text + CODE_INDENT) {
			codeFloor = item.text + CODE_INDENT;
			blank = false;
			continue;
		}
		blank = false;

		const marker = THEMATIC_BREAK.test(rest) ? '' : rest.match(LIST_MARKER)?.[0] ?? '';
		if (marker) {
			while (items.length && items[items.length - 1].marker >= indentColumn) items.pop();
			items.push({ marker: indentColumn, text: columns(indent + marker) });
		}
		const opened = rest.slice(marker.length).match(FENCE_OPEN)?.[1];

		const reindented: string = marker || (items.length > 0 && indent !== '')
			? reindent(indent, indentUnit)
			: indent;

		lines[i] = reindented + (/^[*+]/.test(marker) ? BULLET + rest.slice(1) : rest);

		if (opened) {
			// A fence can open on a list item's own line: "- ```js"
			fenceFrom = indent + ' '.repeat(marker.length);
			fenceTo = reindented + ' '.repeat(marker.length);
			fenceDelimiter = opened;
			fenceContainer = items[items.length - 1]?.text ?? 0;
		}
	}

	return lines.join('\n');
}

/** How wide an indent is, with a tab taking the line to the next stop. */
function columns(indent: string): number {
	let at = 0;

	for (const character of indent) {
		at = character === '\t' ? at + CONVERSION_STEP - at % CONVERSION_STEP : at + 1;
	}

	return at;
}

function closes(rest: string, delimiter: string, indent: number): boolean {
	if (indent > 3) return false; // Four spaces makes the delimiter literal code
	const fence = rest.match(FENCE_CLOSE)?.[1];

	return !!fence && fence[0] === delimiter[0] && fence.length >= delimiter.length;
}

/**
 * The line after the frontmatter, whose YAML cannot be indented with a tab.
 *
 * The carriage return of a CRLF file survives splitting on \n, and a delimiter
 * that is not recognised leaves the frontmatter to be rewritten as a list.
 */
function frontMatterEnd(lines: string[]): number {
	const isDelimiter = (line: string | undefined) => line?.replace(/\r$/, '') === '---';

	if (!isDelimiter(lines[0])) return 0;

	const close = lines.findIndex((line, i) => i > 0 && isDelimiter(line));
	return close === -1 ? 0 : close + 1;
}

/**
 * Whatever does not divide into steps is kept: it is the two spaces aligning a
 * wrapped line under its item's text, and moving it takes the line out of the item.
 */
function reindent(indent: string, indentUnit: string): string {
	let steps = 0;
	let at = 0;

	while (at < indent.length) {
		if (indent[at] === '\t') {
			steps++;
			at++;
		}
		else if (indent.startsWith(' '.repeat(CONVERSION_STEP), at)) {
			steps++;
			at += CONVERSION_STEP;
		}
		else break;
	}

	return indentUnit.repeat(steps) + indent.slice(at);
}
