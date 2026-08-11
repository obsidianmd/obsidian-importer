/**
 * A mapped page into markdown.
 *
 * No vault and no node modules: the bytes of every image and embedded file are
 * handed to `saveAttachment`, and the importer decides where they land and what
 * the link to them says. `src/formats/html/convert.ts` is the same shape.
 */

import { SvgStroke, strokesToSvg } from '../onenote/ink-svg';
import { Element, Ink, ListInfo, Page, Paragraph, Table, Tag, TextRun } from './semantic/content';

/**
 * Native ink is measured in half inches; SVG wants something screen-sized.
 * 96 dots to the inch is what the rest of the drawing assumes.
 */
const PIXELS_PER_INK_UNIT = 48;

export interface ResolvedAttachment {
	path: string;
	name: string;
}

/** Why something in the page did not make it into the markdown. */
export type SkipReason =
	/** OneNote recorded the attachment but kept no bytes for it. */
	| 'no-data'
	/** Markdown has nowhere to put it: a table inside a table cell. */
	| 'not-representable';

export interface OneNoteConversionOptions {
	/** Writes one asset and answers with the link target, or null to leave it out. */
	saveAttachment: (data: Uint8Array, suggestedName: string) => Promise<ResolvedAttachment | null>;
	onSkipped?: (name: string, reason: SkipReason) => void;
	isCancelled?: () => boolean;
}

export interface ConvertedPage {
	markdown: string;
	attachments: ResolvedAttachment[];
}

/**
 * OneNote writes an equation as ordinary text in the Mathematical Alphanumeric
 * Symbols block — `a=b` is stored as U+1D44E, `=`, U+1D44F — and marks the run
 * as math rather than storing LaTeX. NFKC folds those glyphs back to the
 * letters they stand for, which is the same normalization Defuddle applies to
 * MathML before converting it.
 *
 * The invisible operators (function application, invisible times and
 * separator) mean something to a layout engine and nothing to LaTeX.
 */
const INVISIBLE_MATH = /[\u2061-\u2064]/g;

/**
 * Raised and lowered digits have to be read before NFKC gets to them: it folds
 * `x²` to `x2`, which is a different expression. They become LaTeX scripts
 * instead, and everything after that is safe to normalize.
 */
const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ¹²³';
const SUPERSCRIPT_PLAIN = '0123456789+-=()ni123';
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎';
const SUBSCRIPT_PLAIN = '0123456789+-=()';

function scriptRuns(text: string, glyphs: string, plain: string, marker: string): string {
	const pattern = new RegExp(`[${glyphs}]+`, 'g');

	return text.replace(pattern, match => {
		const decoded = [...match].map(character => plain[glyphs.indexOf(character)]).join('');
		return `${marker}{${decoded}}`;
	});
}

function toLatex(text: string): string {
	const scripted = scriptRuns(
		scriptRuns(text, SUPERSCRIPTS, SUPERSCRIPT_PLAIN, '^'),
		SUBSCRIPTS, SUBSCRIPT_PLAIN, '_');

	return scripted.normalize('NFKC').replace(INVISIBLE_MATH, '').trim();
}

/**
 * Text typed in OneNote is not markdown, and must not be read as it.
 *
 * Only what genuinely changes the document is escaped: the block markers that
 * turn a line into a heading, list, quote, rule or fence, and the inline
 * syntax that would silently become a link, code span or HTML tag. Emphasis
 * markers are left alone — `*` and `_` only pair in ways prose rarely writes,
 * and escaping every one of them litters the note for no gain. Obsidian's own
 * `htmlToMarkdown` escapes nothing at all, so this stays as close to that as
 * safety allows.
 */
function escapeInline(text: string): string {
	return text.replace(/[[\]`<]/g, '\\$&');
}

/** The markers that only mean something as the first thing on a line. */
function escapeLineStart(line: string): string {
	return line.replace(/^(\s*)(#{1,6}(?=\s|$)|>|\||[-*+](?=\s)|\d+[.)](?=\s)|`{3,}|~{3,}|-{3,}$|={3,}$)/, '$1\\$2');
}

/** A run carries formatting markdown cannot say; those parts pass through as text. */
function renderRun(run: TextRun): string {
	let text = run.text;
	if (text === '') return '';

	// Emphasis cannot span the whitespace at a run's edges without breaking.
	const leading = text.match(/^\s*/)![0];
	const trailing = text.length > leading.length ? text.match(/\s*$/)![0] : '';
	let core = text.slice(leading.length, text.length - trailing.length);

	if (core !== '') {
		// An equation is already italic in OneNote; emphasis around it would
		// end up inside the delimiters and stop it rendering.
		if (run.math) {
			const latex = toLatex(core);
			return latex === '' ? '' : `${leading}$${latex}$${trailing}`;
		}

		core = escapeInline(core);

		if (run.highlight) core = highlighted(core, run.highlight);
		if (run.superscript) core = `<sup>${core}</sup>`;
		if (run.subscript) core = `<sub>${core}</sub>`;
		if (run.underline) core = `<u>${core}</u>`;
		if (run.bold) core = `**${core}**`;
		if (run.italic) core = `*${core}*`;
		if (run.strikethrough) core = `~~${core}~~`;
		if (run.hyperlinkUrl) core = `[${core}](${encodeURI(run.hyperlinkUrl)})`;
	}

	return leading + core + trailing;
}

function renderRuns(runs: TextRun[]): string {
	return runs.map(renderRun).join('').replace(/\r\n?/g, '\n').trim();
}

/**
 * The six highlight colours Obsidian understands, named by the coloured circle
 * that selects them. Apple Notes writes its highlights the same way, in
 * `src/formats/apple-notes/convert-note.ts`.
 */
const HIGHLIGHT_MARKERS: { marker: string, inks: number[][] }[] = [
	{ marker: '🔴', inks: [[0xff, 0x00, 0x00], [0xff, 0x69, 0xb4]] },
	{ marker: '🟠', inks: [[0xff, 0xa5, 0x00]] },
	{ marker: '🟡', inks: [[0xff, 0xff, 0x00]] },
	{ marker: '🟢', inks: [[0x00, 0xff, 0x00], [0x00, 0x80, 0x00]] },
	// A highlighter's blue is cyan, which is otherwise as near green as blue.
	{ marker: '🔵', inks: [[0x00, 0x00, 0xff], [0x00, 0xff, 0xff]] },
	{ marker: '🟣', inks: [[0x80, 0x00, 0x80], [0xff, 0x00, 0xff]] },
];

/**
 * OneNote's highlighter offers colours that are not exactly any of those, so
 * the nearest one is used — the reader's point was which colour it was, not
 * its precise ink.
 */
function highlighted(text: string, color: string): string {
	const match = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!match) return `==${text}==`;

	const [red, green, blue] = match.slice(1).map(part => parseInt(part, 16));

	let nearest = HIGHLIGHT_MARKERS[0].marker;
	let best = Infinity;

	for (const { marker, inks } of HIGHLIGHT_MARKERS) {
		for (const [inkRed, inkGreen, inkBlue] of inks) {
			const distance = (inkRed - red) ** 2 + (inkGreen - green) ** 2 + (inkBlue - blue) ** 2;
			if (distance < best) {
				best = distance;
				nearest = marker;
			}
		}
	}

	return `==${nearest}${text}==`;
}

/** OneNote records its built-in styles by name, and h1..h6 are the ones markdown has. */
function headingPrefix(styleId: string | undefined): string {
	const level = styleId?.match(/^h([1-6])$/i);
	return level ? '#'.repeat(Number(level[1])) + ' ' : '';
}

function listPrefix(list: ListInfo | undefined): string {
	if (!list) return '';
	return '\t'.repeat(list.level) + (list.ordered ? '1. ' : '- ');
}

/**
 * A OneNote to-do becomes a task, whatever list it was already in: the tick
 * box is the thing worth keeping, and markdown has nowhere else to put it.
 */
function taskPrefix(tags: Tag[] | undefined, list: ListInfo | undefined): string | undefined {
	const task = tags?.find(tag => tag.checkable);
	if (!task) return undefined;

	return '\t'.repeat(list?.level ?? 0) + (task.completed ? '- [x] ' : '- [ ] ');
}

/**
 * The OneNote tags that mean "pay attention to this", and the callout each
 * one becomes.
 *
 * A callout is an admonition, so only the tags that are one belong here. Most
 * of OneNote's icons categorise instead - a phone number, a book to read, a
 * musical note - and turning those into alerts would shout about nothing. They
 * keep their paragraph as it was.
 *
 * Keyed by NoteTagShape (MS-ONE 2.3.86) rather than by label, because a label
 * is written in whatever language the notebook's author used.
 */
const CALLOUT_SHAPES: Record<number, string> = {
	13: 'important',  // Yellow star
	15: 'question',   // Question mark
	17: 'danger',     // High priority (red exclamation mark)
	21: 'tip',        // Light bulb
	111: 'question',  // Question balloon
};

interface Callout {
	type: string;
	title?: string;
}

function calloutFor(tags: Tag[] | undefined): Callout | undefined {
	for (const tag of tags ?? []) {
		if (tag.checkable || tag.shape === undefined) continue;

		const type = CALLOUT_SHAPES[tag.shape];
		if (type) return { type, title: tag.label };
	}

	return undefined;
}

/** One thing written to the page, and whether it was an item in a list. */
interface Block {
	text: string;
	listItem: boolean;
	/** The opening line, when this block is a callout that a later one can join. */
	callout?: string;
}

class PageWriter {
	private readonly blocks: Block[] = [];
	private readonly inkStrokes: SvgStroke[] = [];
	private readonly recognizedText: string[] = [];
	readonly attachments: ResolvedAttachment[] = [];

	constructor(private readonly options: OneNoteConversionOptions, private readonly pageTitle: string) {
	}

	/**
	 * Blocks are separated by a blank line, except between items of the same
	 * list — a blank line there makes it a loose list, which Obsidian renders
	 * with a gap after every bullet.
	 */
	get markdown(): string {
		const lines: string[] = [];

		for (const [index, block] of this.blocks.entries()) {
			const previous = this.blocks[index - 1];
			if (previous && !(block.listItem && previous.listItem)) lines.push('');
			lines.push(block.text);
		}

		return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
	}

	private push(text: string, listItem = false): void {
		this.blocks.push({ text, listItem });
	}

	/**
	 * Paragraphs tagged the same way in a row are one admonition, not a stack
	 * of identical boxes — which is how OneNote shows them too.
	 */
	private pushCallout(callout: Callout, body: string): void {
		const quoted = body.split('\n').map(line => `> ${line}`).join('\n');
		const previous = this.blocks[this.blocks.length - 1];
		const opening = `> [!${callout.type}]${callout.title ? ` ${callout.title}` : ''}`;

		if (previous?.callout === opening) {
			previous.text += `\n>\n${quoted}`;
			return;
		}

		this.blocks.push({ text: `${opening}\n${quoted}`, listItem: false, callout: opening });
	}

	async writeElements(elements: Element[]): Promise<void> {
		for (const element of elements) {
			if (this.options.isCancelled?.()) return;
			await this.writeElement(element);
		}
	}

	private async writeElement(element: Element): Promise<void> {
		switch (element.kind) {
			case 'outline':
				await this.writeElements(element.children);
				break;
			case 'paragraph':
				await this.writeParagraph(element);
				break;
			case 'table':
				await this.writeTable(element);
				break;
			case 'image':
				await this.writeAsset(element.data, assetName(element.fileName, element.extension, 'image'), element.altText ?? '', true);
				break;
			case 'embedded-file': {
				const name = assetName(element.fileName, element.extension, 'attachment');
				await this.writeAsset(element.data, name, name, false);
				break;
			}
			case 'ink':
				this.collectInk(element);
				break;
		}
	}

	private async writeParagraph(paragraph: Paragraph): Promise<void> {
		const text = renderRuns(paragraph.runs);

		if (text !== '') {
			const task = taskPrefix(paragraph.tags, paragraph.list);
			const prefix = task ?? listPrefix(paragraph.list) ?? '';
			const indent = '\t'.repeat(paragraph.list?.level ?? 0);

			// A hard break inside one paragraph stays inside it. Each line is
			// escaped on its own, because each is a line markdown will read.
			const escaped = text.split('\n').map(escapeLineStart);
			const body = (prefix || headingPrefix(paragraph.styleId)) + escaped.join('  \n' + indent);
			const callout = calloutFor(paragraph.tags);

			// A callout around one item of a list would lift it out and split
			// the list in two, so a tagged list item keeps its place instead.
			if (callout && !paragraph.list && !task) this.pushCallout(callout, body);
			else this.push(body, task !== undefined || paragraph.list !== undefined);
		}

		await this.writeElements(paragraph.children);
	}

	private async writeTable(table: Table): Promise<void> {
		if (table.rows.length === 0) return;

		const columns = Math.max(...table.rows.map(row => row.cells.length));

		const rendered: string[][] = [];
		for (const row of table.rows) {
			const cells: string[] = [];
			for (let index = 0; index < columns; index++) {
				const text = await this.renderCell(row.cells[index]?.children ?? []);
				// A newline would end the row, and a pipe would end the cell.
				cells.push(text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
			}
			rendered.push(cells);
		}

		// GFM has no table without a header, so the first row becomes one.
		const lines = [
			`| ${rendered[0].join(' | ')} |`,
			`| ${new Array(columns).fill('---').join(' | ')} |`,
			...rendered.slice(1).map(row => `| ${row.join(' | ')} |`),
		];

		this.push(lines.join('\n'));
	}

	/**
	 * OneNote splits one drawing across many ink containers, so they are held
	 * until the page is done and drawn together - the Graph importer writes one
	 * `<page> - Ink.svg` per page, and this keeps the two the same.
	 */
	private collectInk(ink: Ink): void {
		for (const stroke of ink.strokes) {
			this.inkStrokes.push({
				points: stroke.points.map(point => ({ x: point.x * PIXELS_PER_INK_UNIT, y: point.y * PIXELS_PER_INK_UNIT })),
				color: stroke.color,
				width: Math.max(1, stroke.width * PIXELS_PER_INK_UNIT),
				opacity: stroke.opacity,
			});
		}

		// Every stroke of a word carries that whole word, so the six strokes of
		// "Hello" would otherwise read as "Hello Hello Hello Hello Hello Hello".
		if (ink.recognizedText && ink.recognizedText !== this.recognizedText[this.recognizedText.length - 1]) {
			this.recognizedText.push(ink.recognizedText);
		}
	}

	/** The page's drawings as one picture, with what the recognizer read beneath it. */
	async writeCollectedInk(): Promise<void> {
		const svg = strokesToSvg(this.inkStrokes);
		if (!svg) return;

		const recognized = this.recognizedText.join(' ');
		await this.writeAsset(new TextEncoder().encode(svg), `${this.pageTitle} - Ink.svg`, recognized, true);

		if (recognized !== '') this.push(recognized);
	}

	private async writeAsset(data: Uint8Array | undefined, name: string, label: string, embed: boolean): Promise<void> {
		const link = await this.renderAsset(data, name, label, embed);
		if (link) this.push(link);
	}

	/** The link to an asset once it is saved, or nothing if it never was. */
	private async renderAsset(data: Uint8Array | undefined, name: string, label: string, embed: boolean): Promise<string | undefined> {
		if (!data || data.length === 0) {
			this.options.onSkipped?.(name, 'no-data');
			return undefined;
		}

		const attachment = await this.options.saveAttachment(data, name);
		if (!attachment) {
			this.options.onSkipped?.(name, 'no-data');
			return undefined;
		}

		this.attachments.push(attachment);
		const target = encodeURI(attachment.path);
		return embed ? `![${label}](${target})` : `[${label}](${target})`;
	}

	/**
	 * A cell's content on one line.
	 *
	 * A table cell is a single line in GFM, so everything in it has to be
	 * inline — which images and embedded files can be, and a nested table
	 * cannot. Anything that cannot is reported rather than dropped quietly.
	 */
	private async renderCell(children: Element[]): Promise<string> {
		const parts: string[] = [];

		for (const child of children) {
			switch (child.kind) {
				case 'paragraph':
					parts.push(renderRuns(child.runs));
					parts.push(await this.renderCell(child.children));
					break;
				case 'outline':
					parts.push(await this.renderCell(child.children));
					break;
				case 'image':
					parts.push(await this.renderAsset(
						child.data, assetName(child.fileName, child.extension, 'image'), child.altText ?? '', true) ?? '');
					break;
				case 'embedded-file': {
					const name = assetName(child.fileName, child.extension, 'attachment');
					parts.push(await this.renderAsset(child.data, name, name, false) ?? '');
					break;
				}
				case 'ink':
					// The strokes join the page's drawing, where they can be seen.
					this.collectInk(child);
					break;
				case 'table':
					this.options.onSkipped?.(this.pageTitle, 'not-representable');
					break;
			}
		}

		return parts.filter(part => part !== '').join(' ');
	}
}

/**
 * OneNote does not always record a filename, but it does record the extension
 * on the data object — and an attachment saved without one is a file the vault
 * cannot render or open.
 */
function assetName(fileName: string | undefined, extension: string | undefined, fallback: string): string {
	if (fileName && /\.[^.\\/]+$/.test(fileName)) return fileName;

	const suffix = extension ? (extension.startsWith('.') ? extension : `.${extension}`) : '';
	return (fileName ?? fallback) + suffix;
}

export async function convertPage(page: Page, options: OneNoteConversionOptions): Promise<ConvertedPage> {
	const writer = new PageWriter(options, page.title);

	await writer.writeElements(page.outlines);
	await writer.writeElements(page.directContent);
	await writer.writeCollectedInk();

	return { markdown: writer.markdown, attachments: writer.attachments };
}
