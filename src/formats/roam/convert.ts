import { FrontMatterCache } from 'obsidian';
import { RoamBlock, RoamPage } from './models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from './utils';
import { BlockTarget, blockRefRegex, looksLikeBlockId } from './block-refs';
import { serializeFrontMatter } from '../../util';
import { convertRoamQueries } from './queries';
import { deOutline, OutlineNode, anchorLines, withContinuation } from '../../outline';

const INDENT = '    ';

const roamSpecificMarkup = ['POMO', 'word-count', 'date', 'slider', 'encrypt', 'TaoOfRoam', 'orphans', 'count', 'character-count', 'comment-button', 'streak', 'attr-table', 'mentions', 'search', 'roam/render', 'roam/css', 'calc'];
const roamSpecificMarkupRe = new RegExp(`\\{\\{(\\[\\[)?(${roamSpecificMarkup.join('|')})(\\]\\])?.*?\\}\\}(\\})?`, 'g');

// Match only Roam's two balanced table markers.
const roamTableRe = /^\{\{(\[\[table\]\]|table)\}\}$/i;

/** The components something below reads, as Roam brackets their names. */
const namedComponentRe = /\{\{\[\[(TODO|DONE|table|query|embed|embed-path|video|audio|pdf|iframe)\]\]/gi;

/** A Roam player component pointing at a URL: `{{[[video]]: https://...}}`. */
const mediaComponentRe = /\{\{\[{0,2}(video|audio|pdf|iframe)\]{0,2}:\s*(https?:\/\/[^\s{}]+)\s*\}\}/gi;

/** A URL that names a media file, which an element can play directly. */
const mediaFileRe = /\.(mp4|webm|ogv|mov|m4v)(\?|$)/i;

/** A reference to a Roam CSS class page: `[[.rm-grid]]`, `#.rm-hide`. */
const styleReferenceRe = /\s*(?:\[\[\.[^\]]*\]\]|#\.[^\s[\]#]+)/g;

const bareTagRe = /(^|\s)#([^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+)/g;

export function isTableMarker(blockString: string | undefined): boolean {
	return roamTableRe.test((blockString ?? '').trim());
}

export interface RoamConverterOptions {
	userDNPFormat: string;
	downloadFirebaseFile?: (blockText: string, attachmentsFolder: string) => Promise<string>;
	resolveBlockReference?: (uid: string) => BlockTarget | null;
	isReferenced?: (uid: string) => boolean;
	resolvePageName?: (title: string) => string | null;
	deOutline?: boolean;
	embedBlockReferences?: boolean;
	dropUnresolvedReferences?: boolean;
	keepAttributesInOutline?: boolean;
	dropQueries?: boolean;
	tagsAsLinks?: boolean;
}

/**
 * What the importer does unasked. Read by the settings panel and by the tests,
 * so what is recorded is what an import produces rather than a shape nobody
 * runs.
 */
export const roamDefaults = {
	deOutline: true,
	embedBlockReferences: true,
	dropUnresolvedReferences: true,
	keepAttributesInOutline: false,
	dropQueries: true,
	tagsAsLinks: false,
} as const;

export class RoamPageConverter {
	readonly attributeNames = new Set<string>();

	private userDNPFormat: string;
	private options: RoamConverterOptions;

	constructor(options: RoamConverterOptions) {
		this.options = options;
		this.userDNPFormat = options.userDNPFormat;
	}

	private async downloadFirebaseFile(blockText: string, attachmentsFolder: string): Promise<string> {
		return this.options.downloadFirebaseFile
			? this.options.downloadFirebaseFile(blockText, attachmentsFolder)
			: blockText;
	}

	async roamMarkupScrubber(graphFolder: string, attachmentsFolder: string, blockText: string): Promise<string> {
		// A component names itself in brackets, which is not a page reference:
		// left as one it was rewritten like any other link, and {{[[query]]}}
		// became {{[[query 1]]}} where a page had taken the name first - after
		// which nothing recognised it as a query. Only the names something here
		// goes on to read, so a component nobody handles is left as Roam wrote it.
		blockText = blockText.replace(namedComponentRe, '{{$1');

		blockText = blockText.replace(roamSpecificMarkupRe, '');

		if (blockText.substring(0, 8) == ':hiccup ' && blockText.includes(':hr')) {
			return '---';
		}

		blockText = blockText.replace(/\[\[>\]\]/g, '>');

		// Roam's bracketed tags are page links; Obsidian has no equivalent tag syntax.
		blockText = blockText.replace(/#(\[\[.*?\]\])/g, '$1');

		// A dotted page name is a CSS class Roam styles the block with, not
		// anything to read - and being per-block, cssclasses cannot hold it.
		blockText = blockText.replace(styleReferenceRe, '');

		if (this.options.tagsAsLinks) {
			blockText = blockText.replace(bareTagRe, (match: string, before: string, tag: string) =>
				/^\d+$/.test(tag) ? match : `${before}[[${tag}]]`);
		}

		// Use the graph's collision-safe name when available.
		// A `[[name]]` straight after `{{` names a component, not a page, so it
		// is passed over. Matched rather than looked behind for: iOS 16.3 has
		// no lookbehind.
		blockText = blockText.replace(/(\{\{)?\[\[(.*?)\]\]/g, (match: string, component: string | undefined, name: string) =>
			component ? match
				: `[[${this.options.resolvePageName?.(name) ?? convertDateString(sanitizeFileNameKeepPath(name), this.userDNPFormat)}]]`);

		// One link, not a span reaching from the first `[[` to the last `]]`:
		// greedy, it swallowed every link between them and wrote the lot back
		// twice, taking any {{[[DONE]]}} in the way with it.
		blockText = blockText.replace(/(\{\{)?\[\[([^[\]]*\/[^[\]]*)\]\]/g, (match: string, component: string | undefined, name: string) =>
			component ? match : `[[${graphFolder}/${name}|${name}]]`);
		// Exclude brackets so a preceding checkbox cannot become the alias.
		blockText = blockText.replace(/\[([^[\]]+?)\]\(\[\[(.+?)\]\]\)/g, '[[$2|$1]]');

		// Queries must use the final page names.
		blockText = convertRoamQueries(blockText, this.options.dropQueries ?? false);

		blockText = blockText.replace(/{{TODO}}|{{\[\[TODO\]\]}}/g, '[ ]');
		blockText = blockText.replace(/{{DONE}}|{{\[\[DONE\]\]}}/g, '[x]');

		blockText = blockText.replace(/{{.*?\bvideo\b.*?(\bhttp.*?\byoutu.*?)}}/g, '![]($1)');
		blockText = blockText.replace(/(https?:\/\/twitter\.com\/(?:#!\/)?\w+\/status\/\d+(?:\?[\w=&-]+)?)/g, '![]($1)');
		blockText = blockText.replace(/__(.+?)__/g, '*$1*');
		blockText = blockText.replace(/\^\^(.+?)\^\^/g, '==$1==');

		blockText = this.resolveEmbedsAndReferences(blockText);
		blockText = withFencesOnTheirOwnLines(blockText);

		if (blockText.includes('firebasestorage')) {
			blockText = await this.downloadFirebaseFile(blockText, attachmentsFolder);
		}

		// Whatever the download did not take: a player pointing at somewhere
		// else, or a file it could not fetch. Markdown takes HTML, so the
		// component becomes the element it stood for.
		return blockText.replace(mediaComponentRe, (match: string, name: string, url: string) => {
			if (name.toLowerCase() === 'audio') return `<audio controls src="${url}"></audio>`;

			return mediaFileRe.test(url)
				? `<video controls src="${url}"></video>`
				: `<iframe src="${url}"></iframe>`;
		});
	};

	private resolveEmbedsAndReferences(blockText: string): string {
		const resolve = this.options.resolveBlockReference;

		blockText = blockText.replace(/\{\{\[{0,2}embed[^{}]*?(\[\[.*?\]\])[^{}]*?\}\}/g, '!$1');

		if (!resolve) return blockText;

		blockText = blockText.replace(/\{\{\[{0,2}embed[^{}]*?\(\((.*?)\)\)[^{}]*?\}\}/g,
			(match: string, uid: string) => {
				const target = resolve(uid);
				return target ? `![[${target}]]` : this.unresolved(match);
			});

		blockText = blockText.replace(/\[([^[\]]+?)\]\(\(\((.+?)\)\)\)/g, (match: string, alias: string, uid: string) => {
			const target = resolve(uid);
			if (target) return `[[${target}|${alias}]]`;
			if (!looksLikeBlockId(uid)) return match;

			return this.options.dropUnresolvedReferences ? alias : match;
		});

		return blockText.replace(blockRefRegex, (match: string, uid: string) => {
			const target = resolve(uid);

			// Preserve ordinary double-parenthesized text.
			if (!target) return looksLikeBlockId(uid) ? this.unresolved(match) : match;

			return this.options.embedBlockReferences ? `![[${target}]]` : `[[${target}]]`;
		});
	}

	private unresolved(match: string): string {
		return this.options.dropUnresolvedReferences ? '' : match;
	}

	private async render(graphFolder: string, attachmentsFolder: string, block: RoamBlock): Promise<OutlineNode[]> {
		if (block.string && isTableMarker(block.string)) {
			const table = await this.convertTable(graphFolder, attachmentsFolder, block);
			return table ? [{ text: '', anchor: null, verbatim: table, children: [] }] : [];
		}

		// A source-empty block omits its own line but retains its children.
		const scrubbed = block.string
			? await this.roamMarkupScrubber(graphFolder, attachmentsFolder, block.string)
			: null;

		const children = await this.renderChildren(graphFolder, attachmentsFolder, block.children ?? []);

		const text = scrubbed === null ? null : block.heading
			? `${'#'.repeat(block.heading)} ${withoutWholeBold(scrubbed)}`
			: scrubbed;

		// A block whose whole text was Roam markup we remove leaves no bullet
		// behind, and what was under it takes its place rather than staying a
		// level deeper than a block that is no longer there.
		if (text !== null && text.trim() === '') return children;

		return [{
			text,
			anchor: block.uid && this.options.isReferenced?.(block.uid) ? block.uid : null,
			verbatim: null,
			children,
		}];
	}

	private async renderChildren(graphFolder: string, attachmentsFolder: string, children: RoamBlock[], skip?: Map<RoamBlock, string>): Promise<OutlineNode[]> {
		const rendered: OutlineNode[] = [];

		for (const child of children) {
			if (skip?.has(child)) continue;

			rendered.push(...await this.render(graphFolder, attachmentsFolder, child));
		}

		return rendered;
	}

	private asOutline(blocks: OutlineNode[], indent: string): string[] {
		const lines: string[] = [];

		for (const block of blocks) {
			if (block.verbatim !== null) {
				lines.push(block.verbatim);
				continue;
			}

			if (block.text === null) {
				if (block.children.length === 0) lines.push('');
				else lines.push(...this.asOutline(block.children, indent + INDENT));
				continue;
			}

			const continuation = indent + '  ';
			const [first, ...rest] = withContinuation(block.text.split('\n'), continuation);
			const written = anchorLines([`${indent}- ${first}`, ...rest], block.anchor, continuation);

			lines.push(written.join('\n'), ...this.asOutline(block.children, indent + INDENT));
		}

		return lines;
	}

	async jsonToMarkdown(graphFolder: string, attachmentsFolder: string, json: RoamPage | RoamBlock): Promise<string> {
		const attributes = await this.attributesOf(graphFolder, attachmentsFolder, json);
		const blocks = await this.renderChildren(graphFolder, attachmentsFolder, json.children ?? [], attributes);

		const markdown = this.options.deOutline
			? [deOutline(blocks)]
			: this.asOutline(blocks, '');

		const frontMatter: FrontMatterCache = {};

		for (const [block, value] of attributes) {
			const name = this.attributeNameOf(block);
			frontMatter[name] = value;
			this.attributeNames.add(name);
		}

		return serializeFrontMatter(frontMatter) + markdown.join('\n');
	}

	private async attributesOf(graphFolder: string, attachmentsFolder: string, page: RoamPage | RoamBlock): Promise<Map<RoamBlock, string>> {
		const attributes = new Map<RoamBlock, string>();
		if (this.options.keepAttributesInOutline) return attributes;

		for (const block of page.children ?? []) {
			if (block.children?.length) continue;

			const value = attributeValue(block.string);
			if (value === null) continue;

			// Referenced attributes must remain in the body to carry an anchor.
			if (block.uid && this.options.isReferenced?.(block.uid)) continue;

			attributes.set(block, await this.roamMarkupScrubber(graphFolder, attachmentsFolder, value));
		}

		return attributes;
	}

	private attributeNameOf(block: RoamBlock): string {
		return block.string.slice(0, block.string.indexOf('::')).trim();
	}

	/** Converts each root-to-leaf table path into a Markdown row. */
	private async convertTable(graphFolder: string, attachmentsFolder: string, marker: RoamPage | RoamBlock): Promise<string> {
		const rows: string[][] = [];

		const walk = async (block: RoamBlock, before: string[]) => {
			const scrubbed = await this.roamMarkupScrubber(graphFolder, attachmentsFolder, block.string ?? '');
			const cells = [...before, scrubbed.replace(/\|/g, '\\|').replace(/\n/g, '<br>')];

			const children = block.children ?? [];
			if (children.length === 0) {
				rows.push(cells);
				return;
			}

			let carried = cells;
			for (const child of children) {
				await walk(child, carried);
				carried = cells.map(() => '');
			}
		};

		for (const row of marker.children ?? []) await walk(row, []);

		if (rows.length === 0) return '';

		const width = Math.max(...rows.map(row => row.length));
		for (const row of rows) {
			while (row.length < width) row.push('');
		}

		rows.splice(1, 0, rows[0].map(() => '---'));

		return `\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}\n`;
	}
}

function withFencesOnTheirOwnLines(text: string): string {
	if (!text.includes('```')) return text;

	const written: string[] = [];
	let open = false;

	for (const line of text.split('\n')) {
		if (!open) {
			written.push(line);
			if (/^\s*```/.test(line) && !/^\s*```.*\S```\s*$/.test(line)) open = true;
			continue;
		}

		const glued = /^(.*\S)\s*```\s*$/.exec(line);
		if (glued) {
			written.push(glued[1], '```');
			open = false;
			continue;
		}

		written.push(line);
		if (/^\s*```\s*$/.test(line)) open = false;
	}

	return written.join('\n');
}

function withoutWholeBold(text: string): string {
	const trimmed = text.trim();
	const inner = trimmed.slice(2, -2);

	return trimmed.startsWith('**') && trimmed.endsWith('**') && inner.length > 0 && !inner.includes('**')
		? inner
		: text;
}

function attributeValue(blockString: string | undefined): string | null {
	const attribute = /^([^\n[\]{}:]{1,80})::([^\n]*)$/.exec(blockString ?? '');
	if (!attribute) return null;

	const [, name, value] = attribute;
	if (!name.trim() || !value.trim()) return null;

	return value.trim();
}
