import { OBJECT_CHARACTER, ParagraphType, SamsungNote, SamsungObject, SamsungParagraphFormat, SamsungText, SpanType } from './parse';

export interface SamsungConvertOptions {
	/** The Markdown that embeds a media bind ID's image, or null to leave it out. */
	embedImage: (bindId: number) => string | null;
}

/** Paragraph style values Samsung Notes stores for its three heading sizes; body text is 3. */
const HEADING_STYLES = [0, 1, 2];

/** Bullet types that number their items: digits, circled digits, letters, and roman numerals. */
const NUMBERED_BULLETS = [4, 5, 6, 7];
const CHECKBOX_BULLET = 2;

type LineKind = 'text' | 'list' | 'block' | 'blank';

interface Line {
	kind: LineKind;
	text: string;
}

export function convertSamsungNote(note: SamsungNote, options: SamsungConvertOptions): string {
	if (!note.body) return '';
	return joinLines(renderText(note.body, options)).replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
}

function renderText(source: SamsungText, options: SamsungConvertOptions): Line[] {
	const styles = new Styles(source);
	const objects = new Map(source.objects.map(object => [object.offset, object]));
	const lines: Line[] = [];

	let start = 0;
	source.text.split('\n').forEach((line, index) => {
		const end = start + line.length;
		const format = paragraphFormat(source.paragraphs, index);

		if (line.includes(OBJECT_CHARACTER) && line.replace(new RegExp(OBJECT_CHARACTER, 'g'), '').trim() === '') {
			for (let at = start; at < end; at++) {
				const object = objects.get(at);
				if (object) lines.push(...renderObject(object, options));
			}
		}
		else if (line.trim() === '') {
			lines.push({ kind: 'blank', text: '' });
		}
		else {
			const heading = format.style !== undefined && HEADING_STYLES.includes(format.style);
			const text = styles.render(start, end, objects, options, heading).trimEnd();
			lines.push(prefixLine(text, format, heading));
		}

		start = end + 1;
	});

	return lines;
}

interface ParagraphFormat {
	indent: number;
	bullet?: number;
	number: number;
	style?: number;
}

/** The format of one paragraph; a later record overrides an earlier one. */
function paragraphFormat(records: SamsungParagraphFormat[], index: number): ParagraphFormat {
	const format: ParagraphFormat = { indent: 0, number: 1 };
	for (const record of records) {
		if (index < record.start || index >= Math.max(record.end, record.start + 1)) continue;

		if (record.type === ParagraphType.Indent) {
			format.indent = record.first;
		}
		else if (record.type === ParagraphType.Bullet) {
			format.bullet = record.first || undefined;
			format.number = record.second || 1;
		}
		else if (record.type === ParagraphType.Style) {
			format.style = record.first;
		}
	}
	return format;
}

function prefixLine(text: string, format: ParagraphFormat, heading: boolean): Line {
	if (heading) {
		return { kind: 'text', text: `${'#'.repeat((format.style ?? 0) + 1)} ${text}` };
	}

	if (format.bullet === undefined) return { kind: 'text', text };

	const indent = '\t'.repeat(format.indent);
	if (format.bullet === CHECKBOX_BULLET) return { kind: 'list', text: `${indent}- [ ] ${text}` };
	if (NUMBERED_BULLETS.includes(format.bullet)) return { kind: 'list', text: `${indent}${format.number}. ${text}` };
	return { kind: 'list', text: `${indent}- ${text}` };
}

function renderObject(object: SamsungObject, options: SamsungConvertOptions): Line[] {
	switch (object.kind) {
		case 'image': {
			const embed = options.embedImage(object.bindId);
			return embed ? [{ kind: 'text', text: embed }] : [];
		}
		case 'code': {
			const longest = Math.max(2, ...(object.code.match(/`+/g) ?? []).map(run => run.length));
			const fence = '`'.repeat(longest + 1);
			const language = object.language.toLowerCase().replace(/\s+/g, '-');
			return [{ kind: 'block', text: `${fence}${language}\n${object.code.replace(/\n+$/, '')}\n${fence}` }];
		}
		case 'table':
			return [{ kind: 'block', text: renderTable(object.rows, options) }];
		default:
			return [];
	}
}

function renderTable(rows: SamsungText[][], options: SamsungConvertOptions): string {
	const cell = (source: SamsungText): string => {
		const styles = new Styles(source);
		const objects = new Map(source.objects.map(object => [object.offset, object]));
		const lines: string[] = [];
		let start = 0;
		for (const line of source.text.split('\n')) {
			lines.push(styles.render(start, start + line.length, objects, options, false));
			start += line.length + 1;
		}
		return lines.join('<br>').replace(/^(<br>)+|(<br>)+$/g, '').replace(/\|/g, '\\|').trim();
	};

	const [header, ...body] = rows.map(row => `| ${row.map(cell).join(' | ')} |`);
	const separator = `|${rows[0].map(() => ' --- ').join('|')}|`;
	return [header, separator, ...body].join('\n');
}

/**
 * A blank line keeps tables and code blocks apart from the text around them,
 * and keeps a paragraph after a list from joining its last item.
 */
function joinLines(lines: Line[]): string {
	const out: string[] = [];
	let previous: LineKind = 'blank';

	for (const line of lines) {
		const separate = line.kind !== 'blank' && previous !== 'blank'
			&& (line.kind === 'block' || previous === 'block' || (previous === 'list' && line.kind === 'text'));
		if (separate) out.push('');
		out.push(line.text);
		previous = line.kind;
	}

	return out.join('\n');
}

type Marker = 'link' | 'highlight' | 'strikethrough' | 'bold' | 'italic' | 'underline';

/** Outermost first. */
const MARKER_ORDER: Marker[] = ['link', 'highlight', 'strikethrough', 'bold', 'italic', 'underline'];

const OPEN: Record<Exclude<Marker, 'link'>, string> = {
	highlight: '==',
	strikethrough: '~~',
	bold: '**',
	italic: '*',
	underline: '<u>',
};

const CLOSE: Record<Exclude<Marker, 'link'>, string> = {
	highlight: '==',
	strikethrough: '~~',
	bold: '**',
	italic: '*',
	underline: '</u>',
};

const SPAN_MARKERS: Partial<Record<number, Marker>> = {
	[SpanType.Bold]: 'bold',
	[SpanType.Italic]: 'italic',
	[SpanType.Underline]: 'underline',
	[SpanType.Strikethrough]: 'strikethrough',
	[SpanType.Highlight]: 'highlight',
};

/** Character styles, where the last span to cover a character decides it. */
class Styles {
	private readonly flags: Uint8Array;
	private readonly links: (string | undefined)[];

	constructor(private readonly source: SamsungText) {
		const length = source.text.length;
		this.flags = new Uint8Array(length);
		this.links = new Array<string | undefined>(length);

		for (const span of source.spans) {
			const start = Math.min(span.start, length);
			const end = Math.min(span.end, length);
			if (span.type === SpanType.Link) {
				if (span.url) this.links.fill(span.url, start, end);
				continue;
			}

			const marker = SPAN_MARKERS[span.type];
			if (!marker) continue;
			const bit = 1 << MARKER_ORDER.indexOf(marker);
			const on = span.type === SpanType.Highlight ? (span.value >>> 24) !== 0 : span.value !== 0;
			for (let i = start; i < end; i++) {
				this.flags[i] = on ? this.flags[i] | bit : this.flags[i] & ~bit;
			}
		}
	}

	render(start: number, end: number, objects: Map<number, SamsungObject>, options: SamsungConvertOptions, heading: boolean): string {
		const text = this.source.text;
		const boldBit = 1 << MARKER_ORDER.indexOf('bold');
		const open: { marker: Marker, url?: string }[] = [];
		let out = '';

		const close = (count: number) => {
			const trailing = /\s*$/.exec(out)?.[0] ?? '';
			out = out.slice(0, out.length - trailing.length);
			while (open.length > count) {
				const { marker, url } = open.pop()!;
				out += marker === 'link' ? `](${linkTarget(url!)})` : CLOSE[marker];
			}
			out += trailing;
		};

		let at = start;
		while (at < end) {
			let next = at + 1;
			const flags = heading ? this.flags[at] & ~boldBit : this.flags[at];
			const url = this.links[at];
			while (next < end && this.flags[next] === this.flags[at] && this.links[next] === url && text[next] !== OBJECT_CHARACTER && text[at] !== OBJECT_CHARACTER) next++;

			let run = text.slice(at, next);
			if (run === OBJECT_CHARACTER) {
				const object = objects.get(at);
				run = object?.kind === 'image' ? renderObject(object, options).map(line => line.text).join('') : '';
			}

			if (run.trim() !== '') {
				const wanted = MARKER_ORDER.filter((marker, bit) => marker === 'link' ? url !== undefined : (flags & (1 << bit)) !== 0);
				const keep = open.findIndex(({ marker, url: openUrl }) => !wanted.includes(marker) || (marker === 'link' && openUrl !== url));
				if (keep >= 0) close(keep);

				const leading = /^\s*/.exec(run)?.[0] ?? '';
				out += leading;
				run = run.slice(leading.length);
				for (const marker of wanted) {
					if (open.some(entry => entry.marker === marker)) continue;
					open.push({ marker, url: marker === 'link' ? url : undefined });
					out += marker === 'link' ? '[' : OPEN[marker];
				}
			}

			out += run;
			at = next;
		}

		close(0);
		return out;
	}
}

function linkTarget(url: string): string {
	return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}
