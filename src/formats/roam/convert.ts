import { FrontMatterCache, moment } from 'obsidian';
import { RoamBlock, RoamPage } from './models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from './utils';
import { BlockTarget, blockRefRegex } from './block-refs';
import { serializeFrontMatter } from '../../util';
import { convertRoamQueries } from './queries';

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

export interface RoamConverterOptions {
	userDNPFormat: string;
	fileDateYAML: boolean;
	titleYAML: boolean;
	downloadAttachments: boolean;
	downloadFirebaseFile?: (blockText: string, attachmentsFolder: string) => Promise<string>;
	/** Where the block with this id ended up, when the graph knows of one. */
	resolveBlockReference?: (uid: string) => BlockTarget | null;
	/** Whether another block points at this one, and so whether it needs an anchor. */
	isReferenced?: (uid: string) => boolean;
}

export class RoamPageConverter {
	newestTimestamp: number = 0;
	oldestTimestamp: number = 0;

	/** The attributes this page turned into properties, for the graph's Base. */
	readonly attributeNames = new Set<string>();

	private userDNPFormat: string;
	private downloadAttachments: boolean;
	private fileDateYAML: boolean;
	private titleYAML: boolean;
	private options: RoamConverterOptions;

	constructor(options: RoamConverterOptions) {
		this.options = options;
		this.userDNPFormat = options.userDNPFormat;
		this.downloadAttachments = options.downloadAttachments;
		this.fileDateYAML = options.fileDateYAML;
		this.titleYAML = options.titleYAML;
	}

	private async downloadFirebaseFile(blockText: string, attachmentsFolder: string): Promise<string> {
		return this.options.downloadFirebaseFile
			? this.options.downloadFirebaseFile(blockText, attachmentsFolder)
			: blockText;
	}

	async roamMarkupScrubber(graphFolder: string, attachmentsFolder: string, blockText: string, skipDownload: boolean = false): Promise<string> {
		blockText = blockText.replace(roamSpecificMarkupRe, '');

		if (blockText.substring(0, 8) == ':hiccup ' && blockText.includes(':hr')) {
			return '---';
		}

		blockText = blockText.replace(/\[\[>\]\]/g, '>');

		blockText = blockText.replace(/\[\[(.*?)\]\]/g, (match, group1) => `[[${convertDateString(sanitizeFileNameKeepPath(group1), this.userDNPFormat)}]]`);

		blockText = blockText.replace(/\[\[(.*\/.*)\]\]/g, (_, group1) => `[[${graphFolder}/${group1}|${group1}]]`);
		// As with an aliased block reference below, the alias holds no bracket
		// of its own, or a `[link](((uid)))` standing to the left of one is
		// taken into it.
		blockText = blockText.replace(/\[([^[\]]+?)\]\(\[\[(.+?)\]\]\)/g, '[[$2|$1]]');

		// After the page links are rewritten, so a query names the notes that
		// were actually written rather than the titles Roam had.
		blockText = convertRoamQueries(blockText);

		blockText = blockText.replace(/{{TODO}}|{{\[\[TODO\]\]}}/g, '[ ]');
		blockText = blockText.replace(/{{DONE}}|{{\[\[DONE\]\]}}/g, '[x]');

		blockText = blockText.replace(/{{.*?\bvideo\b.*?(\bhttp.*?\byoutu.*?)}}/g, '![]($1)');
		blockText = blockText.replace(/(https?:\/\/twitter\.com\/(?:#!\/)?\w+\/status\/\d+(?:\?[\w=&-]+)?)/g, '![]($1)');
		blockText = blockText.replace(/__(.+?)__/g, '*$1*');
		blockText = blockText.replace(/\^\^(.+?)\^\^/g, '==$1==');

		blockText = this.resolveEmbedsAndReferences(blockText);

		if (this.downloadAttachments && !skipDownload) {
			if (blockText.includes('firebasestorage')) {
				blockText = await this.downloadFirebaseFile(blockText, attachmentsFolder);
			}
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
			(match, uid) => {
				const target = resolve(uid);
				return target ? `![[${target}]]` : match;
			});

		// An aliased reference keeps the alias the user wrote. The alias holds
		// no bracket of its own: reaching across one takes in whatever stands
		// to the left, and by this point a converted `{{[[TODO]]}}` has left a
		// `[ ]` there to be taken.
		blockText = blockText.replace(/\[([^[\]]+?)\]\(\(\((.+?)\)\)\)/g, (match, alias, uid) => {
			const target = resolve(uid);
			return target ? `[[${target}|${alias}]]` : match;
		});

		return blockText.replace(blockRefRegex, (match, uid) => {
			const target = resolve(uid);
			return target ? `[[${target}]]` : match;
		});
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

	async jsonToMarkdown(graphFolder: string, attachmentsFolder: string, json: RoamPage | RoamBlock, indent: string = '', isChild: boolean = false, setTitleProperty: string, createdTimestamp: number, updatedTimestamp: number): Promise<string> {
		let markdown: string[] = [];

		this.accumulateTimestamps(json, createdTimestamp, updatedTimestamp);

		if ('string' in json && json.string && roamTableRe.test(json.string.trim())) {
			// The marker's children are the table, so they are read as cells
			// here rather than recursed into as bullets.
			return this.convertTable(graphFolder, attachmentsFolder, json);
		}

		if ('string' in json && json.string) {
			const prefix = json.heading ? '#'.repeat(json.heading) + ' ' : '';
			const scrubbed = await this.roamMarkupScrubber(graphFolder, attachmentsFolder, json.string);
			// A block can hold several lines - a fence, say - and every one after the
			// first has to be indented or it falls out of the item
			const [first, ...rest] = `${prefix}${scrubbed}`.split('\n');
			const continuation = isChild ? indent + '  ' : indent;
			const lines = [
				`${isChild ? indent + '- ' : indent}${first}`,
				...rest.map(line => line ? continuation + line : line),
			];

			// A block something else points at needs an anchor to be reached by.
			// It belongs at the end of the block, which for one holding several
			// lines is a line of its own: appended to a closing fence it would
			// land inside the code.
			if (json.uid && this.options.isReferenced?.(json.uid)) {
				if (lines.length > 1) lines.push(`${continuation}^${json.uid}`);
				else lines[0] += ` ^${json.uid}`;
			}

			markdown.push(lines.join('\n'));
		}

		// A page's attributes are lifted out of the outline into its properties,
		// so what is left of the page is the outline alone.
		const attributes = isChild ? new Map<RoamBlock, string>() : await this.attributesOf(graphFolder, attachmentsFolder, json);

		if (json.children) {
			for (const child of json.children) {
				if (attributes.has(child)) continue;

				// The page is not a bullet, so its own blocks start at the margin
				const converted = await this.jsonToMarkdown(graphFolder, attachmentsFolder, child, isChild ? indent + INDENT : indent, true, '', this.oldestTimestamp, this.newestTimestamp);

				// A table marker with no rows under it converts to nothing, and
				// leaves no line behind either. Every other block keeps its line,
				// empty or not, the way it always has.
				if (converted || !roamTableRe.test((child.string ?? '').trim())) {
					markdown.push(converted);
				}
			}
		}

		if (isChild) return markdown.join('\n');

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

		for (const block of page.children ?? []) {
			if (block.children?.length) continue;

			const value = attributeValue(block.string);
			if (value === null) continue;

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
