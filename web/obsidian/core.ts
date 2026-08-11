/**
 * The parts of the `obsidian` module the conversion code reaches.
 *
 * node_modules/obsidian ships type declarations only - there is no runtime
 * module - so anything importing it fails outside the app. This stands in for
 * the pieces used on the conversion path.
 *
 * Only what behaves the same wherever a conversion runs. The platform, the
 * drawing API and requestUrl differ by host: tests/shims/obsidian.ts and
 * ./index.ts supply their own.
 *
 * It is deliberately small. If a test needs more of the API than this, that is
 * a signal the code under test is reaching into the app rather than converting
 * data, and belongs behind the sink interface instead of here.
 *
 * The file classes below are the one deliberate exception. Every importer now
 * writes through FormatImporter.createFile, and what that does with a name
 * already taken is worth a test of its own, it is shared by all of them, and
 * e2e reaches only the importers whose fixtures need no vault. Testing it needs
 * `instanceof TFile` to work, which needs the classes to exist here. The vault
 * they live in is ./vault.ts, not this file.
 */
import moment from 'moment';
import * as yaml from 'yaml';
import type Turndown from 'turndown';

export { moment };

/**
 * Read at call time, not imported: turndown wants a DOM, which the host
 * installs first. Typed here rather than on Window, which would surface
 * unchecked errors in the Evernote rules that read the same property.
 */
function turndownService(): typeof Turndown {
	return (window as unknown as { TurndownService: typeof Turndown }).TurndownService;
}

/**
 * Frontmatter using the same format as Obsidian.
 */
export function stringifyYaml(value: unknown): string {
	return yaml.stringify(value, { nullStr: '', lineWidth: 0 });
}

/** Everything Obsidian's htmlToMarkdown accepts, as markup turndown can read. */
function markupOf(html: string | Document | HTMLElement | DocumentFragment): string {
	if (typeof html === 'string') return html;
	if ('outerHTML' in html) return html.outerHTML;
	if ('documentElement' in html) return html.documentElement.outerHTML;

	// A fragment has no markup of its own, only its children's
	return Array.from(html.childNodes)
		.map(node => (node as Element).outerHTML ?? node.textContent ?? '')
		.join('');
}

/**
 * The shim's signatures, held against the real ones.
 *
 * Nothing typechecks this file with `obsidian` mapped to it - the plugin uses
 * far more of the API than a conversion does, so substituting the shim for the
 * whole of src would fail for good reasons. Anchoring each export to the type
 * it stands in for catches the drift that matters: the app changing what it
 * takes or returns.
 */
type RealApi = typeof import('obsidian');
const _stringifyYaml: RealApi['stringifyYaml'] = stringifyYaml;
const _parseYaml: RealApi['parseYaml'] = parseYaml;
const _normalizePath: RealApi['normalizePath'] = normalizePath;
const _htmlToMarkdown: RealApi['htmlToMarkdown'] = htmlToMarkdown;
const _parseLinktext: RealApi['parseLinktext'] = parseLinktext;

export function parseYaml(text: string): unknown {
	return yaml.parse(text);
}

/**
 * HTML to markdown.
 *
 * Obsidian's own is turndown underneath, which is why the app exposes
 * TurndownService at all, so this is turndown with the settings that match
 * what the app produces on the fixtures here: ATX headings, fenced code, and
 * asterisks for emphasis and bullets.
 *
 * The rules below were each added to close a difference from the app, checked
 * against it on the fixtures here: as of the HTML and Notion fixtures the
 * output is byte for byte the same. Obsidian's build still has rules of its
 * own, so a recording made through this is best read as a regression check on
 * the transformations that run before it - which is where this importer's own
 * behaviour lives - rather than as proof of the exact markdown a user sees.
 */
export function htmlToMarkdown(html: string | Document | HTMLElement | DocumentFragment): string {
	const source = markupOf(html);

	const service = new (turndownService())({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		emDelimiter: '_',
		bulletListMarker: '-',
		hr: '---',
	});

	// Obsidian does not escape markdown punctuation coming out of HTML, so a
	// callout's [!important] stays as written rather than becoming \[!important\].
	service.escape = (text: string) => text;

	// Obsidian drops these rather than letting their text through, which
	// matters when a whole document is converted and its head comes along.
	service.remove(['head', 'title', 'style', 'script', 'iframe'] as never);

	// Obsidian percent-encodes a space in a link target; turndown wraps the
	// whole target in angle brackets instead.
	const escapeUri = (uri: string) => uri.replace(/ /g, '%20').replace(/([()])/g, '\\$1');

	service.addRule('inlineLink', {
		filter: (node: any) => node.nodeName === 'A' && node.getAttribute('href'),
		replacement: (content: string, node: any) => {
			const title = node.getAttribute('title');
			return `[${content}](${escapeUri(node.getAttribute('href'))}${title ? ` "${title}"` : ''})`;
		},
	});

	service.addRule('image', {
		filter: 'img',
		replacement: (_content: string, node: any) => {
			const src = node.getAttribute('src');
			if (!src) return '';
			const title = node.getAttribute('title');
			return `![${node.getAttribute('alt') || ''}](${escapeUri(src)}${title ? ` "${title}"` : ''})`;
		},
	});

	// <mark> is a highlight in Obsidian's flavour.
	service.addRule('highlight', {
		filter: ['mark' as never],
		replacement: (content: string) => `==${content}==`,
	});

	// turndown leaves del/s alone without its GFM plugin; Obsidian strikes them.
	service.addRule('strikethrough', {
		filter: ['del', 's', 'strike' as never],
		replacement: (content: string) => `~~${content}~~`,
	});

	// turndown pads a list marker to four columns; Obsidian writes one space,
	// and indents what follows within the item by four. Checked against the app.
	service.addRule('listItem', {
		filter: 'li',
		replacement: (content: string, node: any) => {
			const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n    ');
			let prefix = '- ';

			const parent = node.parentNode;
			if (parent && parent.nodeName === 'OL') {
				// A start nobody can read is no start at all
				const start = Number(parent.getAttribute('start'));
				const index = Array.prototype.indexOf.call(parent.children, node);
				prefix = `${Number.isFinite(start) && parent.getAttribute('start') ? start + index : index + 1}. `;
			}

			return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '');
		},
	});

	service.addRule('table', {
		filter: 'table',
		replacement: (_content: string, node: any) => `\n\n${tableMarkdown(node, service)}\n\n`,
	});

	return service.turndown(source);
}

function tableRows(table: any): any[] {
	const rows: any[] = [];

	for (const child of Array.from(table.children) as any[]) {
		if (child.tagName === 'TR') rows.push(child);
		else if (child.tagName === 'THEAD' || child.tagName === 'TBODY' || child.tagName === 'TFOOT') {
			rows.push(...(Array.from(child.children) as any[]).filter(row => row.tagName === 'TR'));
		}
	}

	return rows;
}

function tableCells(row: any): any[] {
	return (Array.from(row.children) as any[]).filter(cell => cell.tagName === 'TD' || cell.tagName === 'TH');
}

/**
 * Matches Obsidian's unpadded, ragged table output rather than GFM turndown.
 * Empty tables deliberately return nothing instead of reproducing Obsidian's
 * exception.
 */
function tableMarkdown(table: any, service: any): string {
	const rows = tableRows(table).filter(row => tableCells(row).length > 0);
	if (rows.length === 0) return '';

	const columns = Math.max(...rows.map(row => tableCells(row).length));

	const cellText = (cell: any): string => service
		.turndown(cell.innerHTML)
		.replace(/\n/g, '<br>')
		.replace(/\|/g, '\\|');

	const writeRow = (row: any, pad: boolean): string => {
		const cells = tableCells(row).map(cellText);
		while (pad && cells.length < columns) cells.push('   ');
		return `|${cells.join('|')}|`;
	};

	const separator = `|${Array(columns).fill('---').join('|')}|`;

	// A thead supplies the header without changing source order.
	const thead = (Array.from(table.children) as any[]).find(child => child.tagName === 'THEAD');
	const opener = table.firstElementChild?.tagName;
	const headerRow = thead
		? tableRows(thead)[0]
		: (opener === 'TBODY' || opener === 'TR') && tableCells(rows[0]).every(cell => cell.tagName === 'TH')
			? rows[0]
			: null;

	const lines: string[] = [];

	// Obsidian synthesizes an empty header before all body content.
	if (!headerRow) {
		lines.push(`|${Array(columns).fill('   ').join('|')}|`);
		lines.push(separator);
	}

	for (const child of Array.from(table.children) as any[]) {
		if (child.tagName === 'CAPTION') {
			lines.push(service.turndown(child.innerHTML));
			continue;
		}

		const section = child.tagName === 'TR' ? [child] : tableRows(child);
		for (const row of section) {
			if (tableCells(row).length === 0) continue;

			lines.push(writeRow(row, row === headerRow));
			if (row === headerRow) lines.push(separator);
		}
	}

	return lines.join('\n');
}


/** Matches Obsidian's slash, space, and Unicode normalization. */
export function normalizePath(path: string): string {
	const normalized = path
		.replace(/([\\/])+/g, '/')
		.replace(/(^\/+|\/+$)/g, '')
		.replace(/[\u00a0\u202f]/g, ' ');
	return (normalized === '' ? '/' : normalized).normalize('NFC');
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

	return bytes.buffer;
}

export function parseLinktext(linktext: string): { path: string, subpath: string } {
	const hash = linktext.indexOf('#');
	return hash === -1
		? { path: linktext, subpath: '' }
		: { path: linktext.slice(0, hash), subpath: linktext.slice(hash) };
}

/**
 * A file or folder in the vault.
 *
 * Only the fields the importers read. `stat` carries the size and times a
 * duplicate check compares; nothing here keeps them up to date except the
 * vault that writes them.
 */
export class TAbstractFile {
	path: string = '';
	name: string = '';
	parent: TFolder | null = null;
	/**
	 * The vault the file is in, which nothing here reads.
	 *
	 * Declared as never, and never assigned, so that a shim file satisfies the
	 * real TAbstractFile: tests are held against Obsidian's own types even
	 * though they run against this.
	 */
	vault!: never;
}

export interface DataWriteOptions {
	ctime?: number;
	mtime?: number;
}

export class TFile extends TAbstractFile {
	basename: string = '';
	extension: string = '';
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];

	isRoot(): boolean {
		return this.path === '/' || this.path === '';
	}

	/** See src/augment.d.ts: "Notes/" for a subfolder, "" for the root. */
	getParentPrefix(): string {
		return this.isRoot() ? '' : `${this.path}/`;
	}
}

export function debounce<T extends unknown[]>(cb: (...args: T) => unknown, timeout: number = 0, resetTimer: boolean = false) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: T | null = null;

	const debounced = (...args: T) => {
		pending = args;
		if (timer !== null) {
			if (!resetTimer) return debounced;
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = null;
			const args = pending;
			pending = null;
			if (args) cb(...args);
		}, timeout);
		return debounced;
	};

	debounced.cancel = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		pending = null;
		return debounced;
	};

	debounced.run = () => {
		const args = pending;
		debounced.cancel();
		return args ? cb(...args) : undefined;
	};

	return debounced;
}
