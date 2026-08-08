/**
 * The markdown every importer writes, in the form this vault writes it.
 *
 * Conversions produce what they find natural - four spaces a level, or tabs -
 * and the vault's preferences are applied here instead, so the same note does
 * not import differently depending on where it came from.
 */
import { DataWriteOptions, TFile, Vault } from 'obsidian';

export interface MarkdownOutput {
	indentUnit: string;
}

/** The step a conversion indents by before this runs. A tab counts as one too. */
const CONVERSION_STEP = 4;

const LIST_MARKER = /^(?:[-*+]|\d+[.)])(?:[ \t]+|\r?$)/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
/**
 * A fence closes on its own delimiter, at least as long, nothing after it, and
 * no more than three spaces in front - four makes it code the fence contains.
 */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/;
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
	let inList = false;
	// Where the current item's text starts, and whether a blank line has passed:
	// together they say whether an indented line is the item's code or a sub-item
	let itemText = 0;
	let blank = false;
	let codeFloor = -1;

	for (let i = frontMatterEnd(lines); i < lines.length; i++) {
		const line = lines[i];
		const indent = line.match(/^[\t ]*/)![0];
		const rest = line.slice(indent.length);

		if (fenceFrom !== null) {
			// Measured from where the fence itself sits, not from the margin
			const inside = line.startsWith(fenceFrom) ? line.slice(fenceFrom.length) : rest;
			if (line.startsWith(fenceFrom)) lines[i] = fenceTo + inside;
			if (closes(inside, fenceDelimiter)) fenceFrom = fenceTo = null;
			continue;
		}

		if (rest.trim() === '') { // A blank line does not end the item
			blank = true;
			continue;
		}

		// An indented code block inside the item, which runs until the indent drops
		if (codeFloor >= 0 && columns(indent) >= codeFloor) {
			blank = false;
			continue;
		}
		codeFloor = -1;

		if (inList && blank && columns(indent) >= itemText + CODE_INDENT) {
			codeFloor = itemText + CODE_INDENT;
			blank = false;
			continue;
		}
		blank = false;

		const marker = THEMATIC_BREAK.test(rest) ? '' : rest.match(LIST_MARKER)?.[0] ?? '';
		if (marker) itemText = columns(indent) + marker.length;
		const opened = rest.slice(marker.length).match(FENCE_OPEN)?.[1];

		const reindented: string = marker || (inList && indent !== '')
			? reindent(indent, indentUnit)
			: indent;

		lines[i] = reindented + (/^[*+]/.test(marker) ? BULLET + rest.slice(1) : rest);
		inList = reindented !== indent || !!marker || (inList && indent !== '');

		if (opened) {
			// A fence can open on a list item's own line: "- ```js"
			fenceFrom = indent + ' '.repeat(marker.length);
			fenceTo = reindented + ' '.repeat(marker.length);
			fenceDelimiter = opened;
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

function closes(rest: string, delimiter: string): boolean {
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
