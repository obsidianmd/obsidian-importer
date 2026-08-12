import { FrontMatterCache, moment } from 'obsidian';
import { RoamBlock, RoamPage } from './models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from './utils';
import { BlockTarget, blockRefRegex, looksLikeBlockId } from './block-refs';
import { serializeFrontMatter } from '../../util';
import { convertRoamQueries } from './queries';
import { deOutline, OutlineNode, anchorLines, withContinuation } from '../../outline';

const INDENT = '    ';

const roamSpecificMarkup = ['POMO', 'word-count', 'date', 'slider', 'encrypt', 'TaoOfRoam', 'orphans', 'count', 'character-count', 'comment-button', 'streak', 'attr-table', 'mentions', 'search', 'roam/render', 'calc'];
const roamSpecificMarkupRe = new RegExp(`\\{\\{(\\[\\[)?(${roamSpecificMarkup.join('|')})(\\]\\])?.*?\\}\\}(\\})?`, 'g');

/**
 * The block Roam marks a table with.
 *
 * The brackets are one alternation rather than two optional groups, so only the
 * two spellings Roam writes match - `{{[[table}}` is not one of them.
 */
const roamTableRe = /^\{\{(\[\[table\]\]|table)\}\}$/i;

/** A tag written without brackets, as the app's own converter reads one. */
const bareTagRe = /(^|\s)#([^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+)/g;

/** Whether a block is the marker Roam builds a table from. */
export function isTableMarker(blockString: string | undefined): boolean {
	return roamTableRe.test((blockString ?? '').trim());
}

export interface RoamConverterOptions {
	userDNPFormat: string;
	fileDateYAML: boolean;
	titleYAML: boolean;
	/**
	 * Download a file a block links to, and say how to reach it in the vault.
	 * Left out by a conversion with no vault to put one in, which leaves the
	 * link as the export wrote it.
	 */
	downloadFirebaseFile?: (blockText: string, attachmentsFolder: string) => Promise<string>;
	/** Where the block with this id ended up, when the graph knows of one. */
	resolveBlockReference?: (uid: string) => BlockTarget | null;
	/** Whether another block points at this one, and so whether it needs an anchor. */
	isReferenced?: (uid: string) => boolean;
	/** What the page with this title was called as a note, when the graph holds one. */
	resolvePageName?: (title: string) => string | null;
	/** Write the outline as ordinary markdown rather than as nested bullets. */
	deOutline?: boolean;
	/** Show a referenced block where the reference stands, rather than link to it. */
	embedBlockReferences?: boolean;
	/** Remove a reference whose block is not in the graph, rather than leave it. */
	dropUnresolvedReferences?: boolean;
	/** Leave `Name:: value` in the outline rather than lifting it to a property. */
	keepAttributesInOutline?: boolean;
	/** Remove a query rather than converting it to an Obsidian search. */
	dropQueries?: boolean;
	/** Read a bare `#tag` as the page reference Roam means by it. */
	tagsAsLinks?: boolean;
}

export class RoamPageConverter {
	newestTimestamp: number = 0;
	oldestTimestamp: number = 0;

	/** The attributes this page turned into properties, for the graph's Base. */
	readonly attributeNames = new Set<string>();

	private userDNPFormat: string;
	private fileDateYAML: boolean;
	private titleYAML: boolean;
	private options: RoamConverterOptions;

	constructor(options: RoamConverterOptions) {
		this.options = options;
		this.userDNPFormat = options.userDNPFormat;
		this.fileDateYAML = options.fileDateYAML;
		this.titleYAML = options.titleYAML;
	}

	private async downloadFirebaseFile(blockText: string, attachmentsFolder: string): Promise<string> {
		return this.options.downloadFirebaseFile
			? this.options.downloadFirebaseFile(blockText, attachmentsFolder)
			: blockText;
	}

	async roamMarkupScrubber(graphFolder: string, attachmentsFolder: string, blockText: string): Promise<string> {
		blockText = blockText.replace(roamSpecificMarkupRe, '');

		if (blockText.substring(0, 8) == ':hiccup ' && blockText.includes(':hr')) {
			return '---';
		}

		blockText = blockText.replace(/\[\[>\]\]/g, '>');

		// Obsidian has no `#[[...]]`: a tag holds no spaces, so what Roam writes
		// as a bracketed tag is a hash beside a link rather than a tag. It names
		// a page every time - all 506 of them in the 1,107-page help graph - so
		// the link is what it meant and the hash is what has to go. A bare #tag
		// is left alone: it is a tag Obsidian understands, and four in five name
		// no page at all.
		blockText = blockText.replace(/#(\[\[.*?\]\])/g, '$1');

		// A bare tag is a page reference in Roam too, so it can be read as one
		// here. Not by default - it is a tag Obsidian understands as it stands -
		// but the choice has to live somewhere now that the format converter
		// that offered it is going away. A tag of digits alone is left be: it is
		// a year or a number rather than a name.
		if (this.options.tagsAsLinks) {
			blockText = blockText.replace(bareTagRe, (match: string, before: string, tag: string) =>
				/^\d+$/.test(tag) ? match : `${before}[[${tag}]]`);
		}

		// A link names the note that was written, which is what the graph decided
		// and not what sanitising this title alone would arrive at: a title too
		// long for a file name was cut, and one whose name another page had
		// taken was numbered.
		blockText = blockText.replace(/\[\[(.*?)\]\]/g, (match: string, group1: string) =>
			`[[${this.options.resolvePageName?.(group1) ?? convertDateString(sanitizeFileNameKeepPath(group1), this.userDNPFormat)}]]`);

		blockText = blockText.replace(/\[\[(.*\/.*)\]\]/g, (_: string, group1: string) => `[[${graphFolder}/${group1}|${group1}]]`);
		// As with an aliased block reference below, the alias holds no bracket
		// of its own, or a `[link](((uid)))` standing to the left of one is
		// taken into it.
		blockText = blockText.replace(/\[([^[\]]+?)\]\(\[\[(.+?)\]\]\)/g, '[[$2|$1]]');

		// After the page links are rewritten, so a query names the notes that
		// were actually written rather than the titles Roam had.
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

		return blockText;
	};

	/**
	 * What a block says about another block.
	 *
	 * An embed shows the block where it stands, so it becomes an embed rather
	 * than a link (#246); a reference points at it, showing the block's text
	 * where it can (#247). Both need to know where the block ended up, which
	 * only the graph knows - without it the markup is left as Roam wrote it,
	 * which is also what happens to `((a parenthetical))` that is nobody's
	 * block id.
	 */
	private resolveEmbedsAndReferences(blockText: string): string {
		const resolve = this.options.resolveBlockReference;

		// An embedded page, which needs nothing looked up.
		blockText = blockText.replace(/\{\{\[{0,2}embed[^{}]*?(\[\[.*?\]\])[^{}]*?\}\}/g, '!$1');

		if (!resolve) return blockText;

		blockText = blockText.replace(/\{\{\[{0,2}embed[^{}]*?\(\((.*?)\)\)[^{}]*?\}\}/g,
			(match: string, uid: string) => {
				const target = resolve(uid);
				return target ? `![[${target}]]` : this.unresolved(match);
			});

		// An aliased reference keeps the alias the user wrote. The alias holds
		// no bracket of its own: reaching across one takes in whatever stands
		// to the left, and by this point a converted `{{[[TODO]]}}` has left a
		// `[ ]` there to be taken.
		//
		// This form is no plainer about what it means than the bare one: an
		// ordinary markdown link to a parenthesised address is written the same
		// way, and the help graph has footnotes of exactly that shape.
		blockText = blockText.replace(/\[([^[\]]+?)\]\(\(\((.+?)\)\)\)/g, (match: string, alias: string, uid: string) => {
			const target = resolve(uid);
			if (target) return `[[${target}|${alias}]]`;
			if (!looksLikeBlockId(uid)) return match;

			// Removing a reference that leads nowhere should not take the words
			// it was written on with it. A heading made of nothing but these
			// came out as a bare `#`.
			return this.options.dropUnresolvedReferences ? alias : match;
		});

		return blockText.replace(blockRefRegex, (match: string, uid: string) => {
			const target = resolve(uid);

			// A block the graph holds is a reference whatever its id looks like.
			// One it does not hold was only a reference if it was shaped like an
			// id at all: a bare `((...))` is also how somebody writes an aside,
			// and this is the only form that cannot say which it meant.
			if (!target) return looksLikeBlockId(uid) ? this.unresolved(match) : match;

			// A Roam reference shows the block where it stands, which an embed
			// does and a link does not - so which of the two is the faithful
			// reading depends on what the reader wants back.
			return this.options.embedBlockReferences ? `![[${target}]]` : `[[${target}]]`;
		});
	}

	/**
	 * What is left where a reference named a block the graph does not hold.
	 *
	 * Kept as Roam wrote it by default: `((a parenthetical))` is often nobody's
	 * id at all, and an id that is one belongs to a page left out of a partial
	 * export, which the reader may want to go and fetch.
	 */
	private unresolved(match: string): string {
		return this.options.dropUnresolvedReferences ? '' : match;
	}

	/**
	 * Fold a block's own timestamps into the page's oldest and newest.
	 *
	 * The recursion carries these from block to block, so one reached any other
	 * way - a table's cells, which are walked rather than recursed into - folds
	 * its own in here, or a page whose latest edit happened inside a table comes
	 * out dated before its own content.
	 */
	private accumulateTimestamps(json: RoamPage | RoamBlock, createdTimestamp: number, updatedTimestamp: number): void {
		const jsonEditTime = json['edit-time'];
		const jsonCreateTime = json['create-time'];

		if (this.newestTimestamp < this.oldestTimestamp) {
			this.oldestTimestamp = this.newestTimestamp;
		}

		this.newestTimestamp = (!jsonEditTime || updatedTimestamp > jsonEditTime)
			? updatedTimestamp
			: jsonEditTime;

		if (jsonCreateTime !== undefined) {
			// Missing timestamps arrive as 0.
			if (createdTimestamp > 10) {
				this.oldestTimestamp = Math.min(createdTimestamp, jsonCreateTime);
			}
			else {
				this.oldestTimestamp = jsonCreateTime;
			}
		}
		else {
			this.oldestTimestamp = createdTimestamp;
		}
	}

	/**
	 * A block and everything under it, converted but not yet laid out.
	 *
	 * What a block *says* is settled here and how the page is *shaped* is
	 * settled after, so the outline and the flattened form are two readings of
	 * one conversion rather than two conversions.
	 */
	private async render(graphFolder: string, attachmentsFolder: string, block: RoamBlock, createdTimestamp: number, updatedTimestamp: number): Promise<OutlineNode | null> {
		this.accumulateTimestamps(block, createdTimestamp, updatedTimestamp);

		if (block.string && isTableMarker(block.string)) {
			// The marker's children are the table, so they are read as cells
			// rather than recursed into as bullets. A marker with no rows under
			// it leaves nothing behind, marker included.
			const table = await this.convertTable(graphFolder, attachmentsFolder, block);
			return table ? { text: '', anchor: null, verbatim: table, children: [] } : null;
		}

		// A block Roam left empty writes no line of its own, while what is under
		// it stays where it was. A block that scrubs away to nothing is not the
		// same thing: it had something to say and keeps its place.
		const scrubbed = block.string
			? await this.roamMarkupScrubber(graphFolder, attachmentsFolder, block.string)
			: null;

		const text = scrubbed === null ? null : block.heading
			? `${'#'.repeat(block.heading)} ${withoutWholeBold(scrubbed)}`
			: scrubbed;

		return {
			text,
			anchor: block.uid && this.options.isReferenced?.(block.uid) ? block.uid : null,
			verbatim: null,
			children: await this.renderChildren(graphFolder, attachmentsFolder, block.children ?? []),
		};
	}

	private async renderChildren(graphFolder: string, attachmentsFolder: string, children: RoamBlock[], skip?: Map<RoamBlock, string>): Promise<OutlineNode[]> {
		const rendered: OutlineNode[] = [];

		for (const child of children) {
			if (skip?.has(child)) continue;

			const block = await this.render(graphFolder, attachmentsFolder, child, this.oldestTimestamp, this.newestTimestamp);
			if (block) rendered.push(block);
		}

		return rendered;
	}

	/**
	 * The outline as Roam kept it: a bullet a block, four spaces a level.
	 *
	 * A block that says nothing still keeps its bullet, which is what Roam
	 * shows - only a table marker with nothing under it goes without a line.
	 */
	private asOutline(blocks: OutlineNode[], indent: string): string[] {
		const lines: string[] = [];

		for (const block of blocks) {
			if (block.verbatim !== null) {
				lines.push(block.verbatim);
				continue;
			}

			if (block.text === null) {
				// An empty block with nothing under it is still a blank line, and
				// one with children gives its place over to them.
				if (block.children.length === 0) lines.push('');
				else lines.push(...this.asOutline(block.children, indent + INDENT));
				continue;
			}

			// A block can hold several lines - a fence, say - and every one after
			// the first has to be indented or it falls out of the item
			const continuation = indent + '  ';
			const [first, ...rest] = withContinuation(block.text.split('\n'), continuation);
			const written = anchorLines([`${indent}- ${first}`, ...rest], block.anchor, continuation);

			lines.push(written.join('\n'), ...this.asOutline(block.children, indent + INDENT));
		}

		return lines;
	}

	async jsonToMarkdown(graphFolder: string, attachmentsFolder: string, json: RoamPage | RoamBlock, setTitleProperty: string, createdTimestamp: number, updatedTimestamp: number): Promise<string> {
		this.accumulateTimestamps(json, createdTimestamp, updatedTimestamp);

		// A page's attributes are lifted out of the outline into its properties,
		// so what is left of the page is the outline alone.
		const attributes = await this.attributesOf(graphFolder, attachmentsFolder, json);
		const blocks = await this.renderChildren(graphFolder, attachmentsFolder, json.children ?? [], attributes);

		const markdown = this.options.deOutline
			? [deOutline(blocks)]
			: this.asOutline(blocks, '');

		const frontMatter: FrontMatterCache = {};

		if (this.titleYAML) {
			frontMatter.title = setTitleProperty;
		}

		if (this.fileDateYAML) {
			const TSFormat = 'YYYY-MM-DD HH:mm:ss';

			const formatUpdateDate = this.newestTimestamp ? moment(this.newestTimestamp).format(TSFormat) : moment(new Date()).format(TSFormat);
			const formatCreateDate = this.oldestTimestamp ? moment(this.oldestTimestamp).format(TSFormat) : formatUpdateDate;

			frontMatter.created = formatCreateDate;
			frontMatter.updated = formatUpdateDate;
		}

		for (const [block, value] of attributes) {
			const name = this.attributeNameOf(block);
			frontMatter[name] = value;
			this.attributeNames.add(name);
		}

		// Through stringifyYaml rather than written by hand: a title holding a
		// quote, and an attribute whose value starts with `[[`, each need
		// quoting that a template string does not do.
		return serializeFrontMatter(frontMatter) + markdown.join('\n');
	}

	/**
	 * The attributes a page carries, by the block each was written on.
	 *
	 * Roam writes an attribute as `Name:: value`, anywhere in the outline. The
	 * ones at the top of a page are what a page is *about* - the author of a
	 * book, the status of a project - so those become properties, which is
	 * where Obsidian keeps the same thing and what a Base reads (#245).
	 *
	 * A block with children stays where it is: Roam uses the same syntax for a
	 * heading with an outline under it, and lifting one would leave its
	 * children with nothing above them. So does an attribute deeper in the
	 * outline, which belongs to the block it sits under rather than the page,
	 * and which properties have nowhere to put.
	 */
	private async attributesOf(graphFolder: string, attachmentsFolder: string, page: RoamPage | RoamBlock): Promise<Map<RoamBlock, string>> {
		const attributes = new Map<RoamBlock, string>();
		if (this.options.keepAttributesInOutline) return attributes;

		for (const block of page.children ?? []) {
			if (block.children?.length) continue;

			const value = attributeValue(block.string);
			if (value === null) continue;

			// A property cannot carry an anchor, so an attribute something
			// points at stays in the outline where the reference can reach it.
			if (block.uid && this.options.isReferenced?.(block.uid)) continue;

			// Lifted out of the outline, it is not walked with the rest, so its
			// own timestamps are folded in here or the page is dated without it.
			this.accumulateTimestamps(block, this.oldestTimestamp, this.newestTimestamp);
			attributes.set(block, await this.roamMarkupScrubber(graphFolder, attachmentsFolder, value));
		}

		return attributes;
	}

	private attributeNameOf(block: RoamBlock): string {
		return block.string.slice(0, block.string.indexOf('::')).trim();
	}

	/**
	 * A Roam table, as a markdown pipe table.
	 *
	 * Roam builds a table out of the marker's children, a column for each level
	 * of nesting: a block is a cell, and its children are the cells of the next
	 * column along. A cell with several children is several rows of the table
	 * rather than one, sharing that cell - so every path from the marker down to
	 * a block with no children is a row, and a cell already shown to its left is
	 * left empty on the rows below it.
	 *
	 * The first row is the header, which is how Roam shows it too.
	 *
	 * It is written at the left margin with a blank line either side, whatever
	 * depth the marker sat at: Obsidian does not render a pipe table indented
	 * inside a list item, so keeping the outline's indentation would keep the
	 * bullets tidy and leave the table as rows of text.
	 */
	private async convertTable(graphFolder: string, attachmentsFolder: string, marker: RoamPage | RoamBlock): Promise<string> {
		const rows: string[][] = [];

		const walk = async (block: RoamBlock, before: string[]) => {
			this.accumulateTimestamps(block, this.oldestTimestamp, this.newestTimestamp);

			const scrubbed = await this.roamMarkupScrubber(graphFolder, attachmentsFolder, block.string ?? '');
			// A pipe would end the cell and a newline the row, so neither can
			// stay as itself.
			const cells = [...before, scrubbed.replace(/\|/g, '\\|').replace(/\n/g, '<br>')];

			const children = block.children ?? [];
			if (children.length === 0) {
				rows.push(cells);
				return;
			}

			let carried = cells;
			for (const child of children) {
				await walk(child, carried);
				// The cells to the left have been shown on the row above.
				carried = cells.map(() => '');
			}
		};

		for (const row of marker.children ?? []) await walk(row, []);

		if (rows.length === 0) return '';

		// Roam lets a row stop short; markdown wants every row the same width.
		const width = Math.max(...rows.map(row => row.length));
		for (const row of rows) {
			while (row.length < width) row.push('');
		}

		rows.splice(1, 0, rows[0].map(() => '---'));

		return `\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}\n`;
	}
}

/**
 * A fenced block whose fences each have a line to themselves.
 *
 * Roam writes the closing fence against the last line of the code -
 * ```` ```js\ncode``` ```` - and a fence with code in front of it is not a
 * fence at all: it is more code, and the block runs on to the end of the note
 * swallowing whatever follows. Every line then gets the item's indentation
 * where the block is laid out, so the opening fence, the code and the closing
 * fence all arrive at the same level, which is what a list item needs.
 */
function withFencesOnTheirOwnLines(text: string): string {
	if (!text.includes('```')) return text;

	const written: string[] = [];
	let open = false;

	for (const line of text.split('\n')) {
		if (!open) {
			written.push(line);
			// A fence opens the block unless the same line closes it again.
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

/**
 * A heading without the bold wrapped round the whole of it.
 *
 * Roam marks a heading on the block rather than in its text, so a block can be
 * a heading and be written in bold as well - the help graph has sixty of them.
 * A heading is already bold, so the markup says nothing and only shows. Bold
 * over part of a heading is kept: that one still marks something out.
 */
function withoutWholeBold(text: string): string {
	const trimmed = text.trim();
	const inner = trimmed.slice(2, -2);

	return trimmed.startsWith('**') && trimmed.endsWith('**') && inner.length > 0 && !inner.includes('**')
		? inner
		: text;
}

/**
 * What `Name:: value` says, or nothing when the block does not say it.
 *
 * A name runs to the first `::` and holds no markup of its own: `[[a]] :: b`
 * is a link beside a pair of colons rather than an attribute, and a name over
 * a line long is a sentence that happens to contain them. Neither name nor
 * value spans a line, so a block of several is left in the outline whatever it
 * begins with.
 */
function attributeValue(blockString: string | undefined): string | null {
	const attribute = /^([^\n[\]{}:]{1,80})::([^\n]*)$/.exec(blockString ?? '');
	if (!attribute) return null;

	const [, name, value] = attribute;
	if (!name.trim() || !value.trim()) return null;

	return value.trim();
}
