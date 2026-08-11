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

export interface OneNoteConversionOptions {
	/** Writes one asset and answers with the link target, or null to leave it out. */
	saveAttachment: (data: Uint8Array, suggestedName: string) => Promise<ResolvedAttachment | null>;
	onSkipped?: (name: string) => void;
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
 * A tag that is not a tick box is a label OneNote drew beside the paragraph -
 * "Important", "Question" - which is what an Obsidian callout says too.
 *
 * The label is written in the author's language, so it becomes the callout's
 * title rather than being matched against a list of English names.
 */
function calloutTitle(tags: Tag[] | undefined): string | undefined {
	return tags?.find(tag => !tag.checkable && tag.label)?.label;
}

/** One thing written to the page, and whether it was an item in a list. */
interface Block {
	text: string;
	listItem: boolean;
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

			// A hard break inside one paragraph stays inside it.
			const body = (prefix || headingPrefix(paragraph.styleId)) + text.split('\n').join('  \n' + indent);
			const callout = calloutTitle(paragraph.tags);

			if (callout) this.push(`> [!note] ${callout}\n${body.split('\n').map(line => `> ${line}`).join('\n')}`);
			else this.push(body, task !== undefined || paragraph.list !== undefined);
		}

		await this.writeElements(paragraph.children);
	}

	private async writeTable(table: Table): Promise<void> {
		if (table.rows.length === 0) return;

		const columns = Math.max(...table.rows.map(row => row.cells.length));

		const rendered = table.rows.map(row => {
			const cells: string[] = [];
			for (let index = 0; index < columns; index++) {
				const parts: string[] = [];
				for (const child of row.cells[index]?.children ?? []) collectCellText(child, parts);
				cells.push(parts.join(' ').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
			}
			return cells;
		});

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
		if (!data || data.length === 0) {
			this.options.onSkipped?.(name);
			return;
		}

		const attachment = await this.options.saveAttachment(data, name);
		if (!attachment) {
			this.options.onSkipped?.(name);
			return;
		}

		this.attachments.push(attachment);
		const target = encodeURI(attachment.path);
		this.push(embed ? `![${label}](${target})` : `[${label}](${target})`);
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

function collectCellText(element: Element, into: string[]): void {
	switch (element.kind) {
		case 'paragraph':
			into.push(renderRuns(element.runs));
			element.children.forEach(child => collectCellText(child, into));
			break;
		case 'outline':
			element.children.forEach(child => collectCellText(child, into));
			break;
		default:
			break;
	}
}

export async function convertPage(page: Page, options: OneNoteConversionOptions): Promise<ConvertedPage> {
	const writer = new PageWriter(options, page.title);

	await writer.writeElements(page.outlines);
	await writer.writeElements(page.directContent);
	await writer.writeCollectedInk();

	return { markdown: writer.markdown, attachments: writer.attachments };
}
