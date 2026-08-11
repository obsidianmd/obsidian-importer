import { SvgStroke, strokesToSvg } from '../onenote/ink-svg';
import { Element, Image, Ink, ListInfo, Page, Paragraph, Table, Tag, TextRun } from './semantic/content';

/** Converts half-inch ink units to CSS pixels at 96 DPI. */
const PIXELS_PER_INK_UNIT = 48;

export interface ResolvedAttachment {
	path: string;
	name: string;
}

export type SkipReason =
	| 'no-data'
	| 'not-representable';

export interface OneNoteConversionOptions {
	/** Writes one asset and answers with the link target, or null to leave it out. */
	saveAttachment: (data: Uint8Array, suggestedName: string) => Promise<ResolvedAttachment | null>;
	/** Turns an internal OneNote page title into the note name written by the importer. */
	resolveInternalLink?: (pageTitle: string) => string;
	onSkipped?: (name: string, reason: SkipReason) => void;
	/**
	 * What the note is called, for the attachments named after it. A page title
	 * can hold characters a file name cannot, so only the importer knows.
	 */
	noteName?: string;
	isCancelled?: () => boolean;
}

export interface ConvertedPage {
	markdown: string;
	attachments: ResolvedAttachment[];
}

const INVISIBLE_MATH = /[\u2061-\u2064]/g;

// Preserve scripts before NFKC folds their glyphs to ordinary characters.
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

/** Escapes plain text that Markdown would reinterpret structurally. */
function escapeInline(text: string): string {
	return text.replace(/[[\]`<]/g, '\\$&');
}

function escapeLineStart(line: string): string {
	return line.replace(/^(\s*)(#{1,6}(?=\s|$)|>|\||[-*+](?=\s)|\d+[.)](?=\s)|`{3,}|~{3,}|-{3,}$|={3,}$)/, '$1\\$2');
}

/** Extracts `Page title` from `onenote:...#Page%20title&section-id=...`. */
function internalPageTitle(url: string): string | undefined {
	if (!url.toLowerCase().startsWith('onenote:')) return undefined;

	const hash = url.indexOf('#');
	if (hash < 0) return undefined;

	const tail = url.slice(hash + 1);
	const separator = tail.indexOf('&');
	const encoded = tail.slice(0, separator < 0 ? tail.length : separator);
	if (encoded === '') return undefined;

	try {
		return decodeURIComponent(encoded);
	}
	catch {
		return encoded;
	}
}

function renderRun(run: TextRun, options: OneNoteConversionOptions): string {
	let text = run.text;
	if (text === '') return '';

	const leading = text.match(/^\s*/)![0];
	const trailing = text.length > leading.length ? text.match(/\s*$/)![0] : '';
	let core = text.slice(leading.length, text.length - trailing.length);

	if (core !== '') {
		// Formatting around math would end up inside its delimiters.
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
		if (run.hyperlinkUrl) {
			const pageTitle = internalPageTitle(run.hyperlinkUrl);
			const target = pageTitle
				? options.resolveInternalLink?.(pageTitle) ?? pageTitle
				: run.hyperlinkUrl;
			core = `[${core}](${encodeURI(target)})`;
		}
	}

	return leading + core + trailing;
}

function renderRuns(runs: TextRun[], options: OneNoteConversionOptions): string {
	return runs.map(run => renderRun(run, options)).join('').replace(/\r\n?/g, '\n').trim();
}

const HIGHLIGHT_MARKERS: { marker: string, inks: number[][] }[] = [
	{ marker: '🔴', inks: [[0xff, 0x00, 0x00], [0xff, 0x69, 0xb4]] },
	{ marker: '🟠', inks: [[0xff, 0xa5, 0x00]] },
	{ marker: '🟡', inks: [[0xff, 0xff, 0x00]] },
	{ marker: '🟢', inks: [[0x00, 0xff, 0x00], [0x00, 0x80, 0x00]] },
	{ marker: '🔵', inks: [[0x00, 0x00, 0xff], [0x00, 0xff, 0xff]] },
	{ marker: '🟣', inks: [[0x80, 0x00, 0x80], [0xff, 0x00, 0xff]] },
];

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

function headingPrefix(styleId: string | undefined): string {
	const level = styleId?.match(/^h([1-6])$/i);
	return level ? '#'.repeat(Number(level[1])) + ' ' : '';
}

function listPrefix(list: ListInfo | undefined): string {
	if (!list) return '';
	return '\t'.repeat(list.level) + (list.ordered ? '1. ' : '- ');
}

function taskPrefix(tags: Tag[] | undefined, list: ListInfo | undefined): string | undefined {
	const task = tags?.find(tag => tag.checkable);
	if (!task) return undefined;

	return '\t'.repeat(list?.level ?? 0) + (task.completed ? '- [x] ' : '- [ ] ');
}

// NoteTagShape values that represent admonitions. Labels are localized.
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

interface Block {
	text: string;
	listItem: boolean;
	callout?: string;
}

function extensionOf(fileName: string | undefined): string | undefined {
	return fileName?.match(/\.[^.\\/]+$/)?.[0];
}

/** An attachment without an extension is one the vault cannot open. */
function withExtension(base: string, extension: string | undefined): string {
	if (!extension) return base;
	if (extensionOf(base)) return base;
	return base + (extension.startsWith('.') ? extension : `.${extension}`);
}

class PageWriter {
	private readonly blocks: Block[] = [];
	private readonly inkStrokes: SvgStroke[] = [];
	private readonly recognizedText: string[] = [];
	readonly attachments: ResolvedAttachment[] = [];

	constructor(private readonly options: OneNoteConversionOptions, private readonly pageTitle: string) {
	}

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
				await this.writeAsset(element.data, this.imageName(element), element.altText ?? '', true);
				break;
			case 'embedded-file': {
				const name = withExtension(element.fileName ?? 'attachment', element.extension);
				await this.writeAsset(element.data, name, name, false);
				break;
			}
			case 'ink':
				this.collectInk(element);
				break;
		}
	}

	private async writeParagraph(paragraph: Paragraph): Promise<void> {
		const text = renderRuns(paragraph.runs, this.options);

		if (text !== '') {
			const task = taskPrefix(paragraph.tags, paragraph.list);
			const prefix = task ?? listPrefix(paragraph.list) ?? '';
			const indent = '\t'.repeat(paragraph.list?.level ?? 0);

			const escaped = text.split('\n').map(escapeLineStart);
			const body = (prefix || headingPrefix(paragraph.styleId)) + escaped.join('  \n' + indent);
			const callout = calloutFor(paragraph.tags);

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

	private collectInk(ink: Ink): void {
		for (const stroke of ink.strokes) {
			this.inkStrokes.push({
				points: stroke.points.map(point => ({ x: point.x * PIXELS_PER_INK_UNIT, y: point.y * PIXELS_PER_INK_UNIT })),
				color: stroke.color,
				width: Math.max(1, stroke.width * PIXELS_PER_INK_UNIT),
				opacity: stroke.opacity,
			});
		}

		// Recognition text is repeated on every stroke in a word.
		if (ink.recognizedText && ink.recognizedText !== this.recognizedText[this.recognizedText.length - 1]) {
			this.recognizedText.push(ink.recognizedText);
		}
	}

	async writeCollectedInk(): Promise<void> {
		const svg = strokesToSvg(this.inkStrokes);
		if (!svg) return;

		const recognized = this.recognizedText.join(' ');
		await this.writeAsset(new TextEncoder().encode(svg), `${this.pageTitle} - Ink.svg`, recognized, true);

		if (recognized !== '') this.push(recognized);
	}

	private imageName(image: Image): string {
		return withExtension(`${this.pageTitle} image`, image.extension ?? extensionOf(image.fileName));
	}

	private async writeAsset(data: Uint8Array | undefined, name: string, label: string, embed: boolean): Promise<void> {
		const link = await this.renderAsset(data, name, label, embed);
		if (link) this.push(link);
	}

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

	private async renderCell(children: Element[]): Promise<string> {
		const parts: string[] = [];

		for (const child of children) {
			switch (child.kind) {
				case 'paragraph':
					parts.push(renderRuns(child.runs, this.options));
					parts.push(await this.renderCell(child.children));
					break;
				case 'outline':
					parts.push(await this.renderCell(child.children));
					break;
				case 'image':
					parts.push(await this.renderAsset(child.data, this.imageName(child), child.altText ?? '', true) ?? '');
					break;
				case 'embedded-file': {
					const name = withExtension(child.fileName ?? 'attachment', child.extension);
					parts.push(await this.renderAsset(child.data, name, name, false) ?? '');
					break;
				}
				case 'ink':
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

export async function convertPage(page: Page, options: OneNoteConversionOptions): Promise<ConvertedPage> {
	const writer = new PageWriter(options, options.noteName ?? page.title);

	await writer.writeElements(page.outlines);
	await writer.writeElements(page.directContent);
	await writer.writeCollectedInk();

	return { markdown: writer.markdown, attachments: writer.attachments };
}
