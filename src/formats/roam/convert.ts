/**
 * Roam's block markup and page structure, converted to markdown.
 *
 * Lifted out of the importer so it can run without a vault: the settings it
 * used to read off the class are passed in, and downloading an uploaded file
 * is a callback the importer supplies. Nothing here touches Obsidian.
 */
import { moment } from 'obsidian';
import { RoamBlock, RoamPage } from './models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from './utils';

const roamSpecificMarkup = ['POMO', 'word-count', 'date', 'slider', 'encrypt', 'TaoOfRoam', 'orphans', 'count', 'character-count', 'comment-button', 'query', 'streak', 'attr-table', 'mentions', 'search', 'roam/render', 'calc'];
const roamSpecificMarkupRe = new RegExp(`\\{\\{(\\[\\[)?(${roamSpecificMarkup.join('|')})(\\]\\])?.*?\\}\\}(\\})?`, 'g');

/**
 * The block Roam marks a table with.
 *
 * The brackets are one alternation rather than two optional groups, so only
 * the two spellings Roam writes match - `{{[[table}}` is not one of them.
 */
const roamTableRe = /^\{\{(\[\[table\]\]|table)\}\}$/i;

export interface RoamConverterOptions {
	/** The daily-note format to rewrite Roam's own date pages into. */
	userDNPFormat: string;
	fileDateYAML: boolean;
	titleYAML: boolean;
	downloadAttachments: boolean;
	/**
	 * Fetch the files a block links to and rewrite the links. Left out when
	 * there is nowhere to put them - the block text is then unchanged.
	 */
	downloadFirebaseFile?: (blockText: string, attachmentsFolder: string) => Promise<string>;
}

/**
 * Converts one page. Holds the timestamp accumulators the recursion carries,
 * so one converter belongs to one page.
 */
export class RoamPageConverter {
	// setup to hold the newest and oldest timestamp value from a given page
	newestTimestamp: number = 0;
	oldestTimestamp: number = 0;

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
		// Remove roam-specific components
		blockText = blockText.replace(roamSpecificMarkupRe, '');

		if (blockText.substring(0, 8) == ':hiccup ' && blockText.includes(':hr')) {
			return '---';
		} // Horizontal line in markup, replace it with MD

		// Before page names are sanitised: [[>]] is Roam's blockquote, not a link,
		// and sanitising it leaves an empty [[]] that nothing later can recognise.
		blockText = blockText.replace(/\[\[>\]\]/g, '>');

		//sanitize [[page names]]
		//check for roam DNP and convert to obsidian DNP
		blockText = blockText.replace(/\[\[(.*?)\]\]/g, (match, group1) => `[[${convertDateString(sanitizeFileNameKeepPath(group1), this.userDNPFormat)}]]`);

		// Regular expression to find nested pages [[SOME/TEXT]]     
		// Replace each match with an Obsidian alias [[Artificial Intelligence|AI]]
		blockText = blockText.replace(/\[\[(.*\/.*)\]\]/g, (_, group1) => `[[${graphFolder}/${group1}|${group1}]]`);
		// regular block alias
		blockText = blockText.replace(/\[.+?\]\((\(.+?\)\))\)/g, '$1');
		// page alias
		blockText = blockText.replace(/\[(.+?)\]\(\[\[(.+?)\]\]\)/g, '[[$2|$1]]');

		blockText = blockText.replace(/{{TODO}}|{{\[\[TODO\]\]}}/g, '[ ]');
		blockText = blockText.replace(/{{DONE}}|{{\[\[DONE\]\]}}/g, '[x]');
		blockText = blockText.replace('::', ':'); // Attributes::

		blockText = blockText.replace(/{{.*?\bvideo\b.*?(\bhttp.*?\byoutu.*?)}}/g, '![]($1)'); // youtube embeds
		blockText = blockText.replace(/(https?:\/\/twitter\.com\/(?:#!\/)?\w+\/status\/\d+(?:\?[\w=&-]+)?)/g, '![]($1)'); // twitter embeds
		blockText = blockText.replace(/__(.+?)__/g, '*$1*'); // __ __ itallic
		blockText = blockText.replace(/\^\^(.+?)\^\^/g, '==$1=='); // ^^ ^^ highlight

		// block and page embeds {{embed: ((asdf))}} {{[[embed]]: [[asadf]]}}
		blockText = blockText.replace(/{{\[{0,2}embed.*?(\(\(.*?\)\)).*?}}/g, '$1');
		blockText = blockText.replace(/{{\[{0,2}embed.*?(\[\[.*?\]\]).*?}}/g, '$1');
		// download files uploaded to Roam
		if (this.downloadAttachments && !skipDownload) {
			if (blockText.includes('firebasestorage')) {
				blockText = await this.downloadFirebaseFile(blockText, attachmentsFolder);
			}
		}
		// blockText = blockText.replaceAll("{{[[table]]}}", ""); 
		// blockText = blockText.replaceAll("{{[[kanban]]}}", "");
		// blockText = blockText.replaceAll("{{mermaid}}", "");
		// blockText = blockText.replaceAll("{{[[mermaid]]}}", "");
		// blockText = blockText.replaceAll("{{diagram}}", "");
		// blockText = blockText.replaceAll("{{[[diagram]]}}", "");

		// blockText = blockText.replace(/\!\[(.+?)\]\((.+?)\)/g, "$1 $2"); //images with description
		// blockText = blockText.replace(/\!\[\]\((.+?)\)/g, "$1"); //imags with no description
		// blockText = blockText.replace(/\[(.+?)\]\((.+?)\)/g, "$1: $2"); //alias with description
		// blockText = blockText.replace(/\[\]\((.+?)\)/g, "$1"); //alias with no description
		// blockText = blockText.replace(/\[(.+?)\](?!\()(.+?)\)/g, "$1"); //alias with embeded block (Odd side effect of parser)

		return blockText;
	};

	/**
	 * Fold a block's own timestamps into the page's oldest and newest.
	 *
	 * The recursion carries these down from block to block, so one reached any
	 * other way - a table's cells, which are walked rather than recursed into -
	 * has to fold its own in, or a page whose latest edit happened inside a
	 * table comes out dated before its own content.
	 */
	private accumulateTimestamps(json: RoamPage | RoamBlock, createdTimestamp: number, updatedTimestamp: number): void {
		// use Roam's create-time and edit-time values to set timestamps
		const jsonEditTime = json['edit-time'];
		const jsonCreateTime = json['create-time'];

		// for YAML frontmatter
		// can't be edited before it was created, compare timestamps
		if (this.newestTimestamp < this.oldestTimestamp) {
			this.oldestTimestamp = this.newestTimestamp;
		}

		// check the edit-time of the block, compare to what was passed, use the most recent date
		// if undefined, set newestTimestamp to the value of updatedTimestamp
		this.newestTimestamp = (!jsonEditTime || updatedTimestamp > jsonEditTime)
			? updatedTimestamp
			: jsonEditTime;

		// if the create time is defined, set oldestTimestamp to the lower of the createdTimestamp value or jsonCreateTime
		// else, set oldestTimestamp to the value of createdTimestamp
		if (jsonCreateTime !== undefined) {
			if (createdTimestamp > 10) { // passed as a 0
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
		let frontMatterYAML: string[] = [];

		this.accumulateTimestamps(json, createdTimestamp, updatedTimestamp);

		if ('string' in json && json.string && roamTableRe.test(json.string.trim())) {
			// The block's children are the table's rows, so they are read as
			// cells here instead of being recursed into as bullets.
			const table = await this.convertRoamTable(graphFolder, attachmentsFolder, json);
			if (table) markdown.push(table);
		}
		else {
			if ('string' in json && json.string) {
				const prefix = json.heading ? '#'.repeat(json.heading) + ' ' : '';
				const scrubbed = await this.roamMarkupScrubber(graphFolder, attachmentsFolder, json.string);
				markdown.push(`${isChild ? indent + '* ' : indent}${prefix}${scrubbed}`);
			}

			if (json.children) {
				for (const child of json.children) {
					const converted = await this.jsonToMarkdown(graphFolder, attachmentsFolder, child, indent + '  ', true, '', this.oldestTimestamp, this.newestTimestamp);
					// A table marker with no rows under it converts to nothing,
					// and leaves no line behind either. Every other block keeps
					// its line, empty or not, the way it always has.
					if (converted || !roamTableRe.test((child.string ?? '').trim())) {
						markdown.push(converted);
					}
				}
			}
		}

		// once processing children is completed, add the YAML to the top
		// check if any YAML options are set, add YAML frontmatter if enabled
		// only run on the initial set, skip if child 
		if ((this.fileDateYAML || this.titleYAML) && !isChild) {

			let timeCreated = this.oldestTimestamp;

			frontMatterYAML.push('---');

			// if "add title" option enabled, quotes added to prevent errors in frontmatter
			if (this.titleYAML) {
				frontMatterYAML.push(`title: "${setTitleProperty}"`);
			}

			// if "timestamps" option enabled
			if (this.fileDateYAML) {
				// if create is missing, use updated
				// if updated is missing, use current Date()
				let TSFormat = 'YYYY-MM-DD HH:mm:ss';

				let formatUpdateDate = this.newestTimestamp ? moment(this.newestTimestamp).format(TSFormat) : moment(new Date()).format(TSFormat);
				let formatCreateDate = timeCreated ? moment(timeCreated).format(TSFormat) : formatUpdateDate;

				frontMatterYAML.push('created: ' + formatCreateDate);
				frontMatterYAML.push('updated: ' + formatUpdateDate);
			}

			frontMatterYAML.push('---');

			// Add frontmatter YAML to the top of the markdown array
			markdown.unshift(frontMatterYAML.join('\n'));
		}

		return markdown.join('\n');
	}

	/**
	 * A Roam table, as a markdown pipe table.
	 *
	 * Roam stores a table as the marker block's children: each child is a row,
	 * and the columns of that row are its first child, that child's first
	 * child, and so on down a linear chain. The first row is read as the
	 * header, which is what Roam shows too.
	 *
	 * The table is written at the left margin with a blank line either side,
	 * whatever depth the marker sat at. Obsidian does not render a pipe table
	 * indented inside a list item, so keeping the outline's indentation here
	 * would keep the bullets tidy and leave the table as rows of text.
	 */
	private async convertRoamTable(graphFolder: string, attachmentsFolder: string, json: RoamPage | RoamBlock): Promise<string> {
		const rows: string[][] = [];

		for (const row of json.children ?? []) {
			const cells: string[] = [];

			for (let cell: RoamBlock | undefined = row; cell; cell = cell.children?.[0]) {
				this.accumulateTimestamps(cell, this.oldestTimestamp, this.newestTimestamp);

				if (cell.children && cell.children.length > 1) {
					// Only the first child continues the row, so anything Roam
					// allowed alongside it is not part of the table and cannot
					// be shown. Say so rather than dropping it quietly.
					console.warn(`Roam table cell "${cell.string}" has ${cell.children.length} children; only the first is read as the next column.`);
				}

				const scrubbed = await this.roamMarkupScrubber(graphFolder, attachmentsFolder, cell.string ?? '');
				// A pipe ends the cell and a newline ends the row, so neither
				// can survive as itself.
				cells.push(scrubbed.replace(/\|/g, '\\|').replace(/\n/g, '<br>'));
			}

			rows.push(cells);
		}

		if (rows.length === 0) return '';

		// Roam lets a row stop short; markdown wants every row the same width.
		const width = Math.max(...rows.map(row => row.length));
		for (const row of rows) {
			while (row.length < width) row.push('');
		}

		rows.splice(1, 0, rows[0].map(() => '---'));

		return '\n' + rows.map(row => `| ${row.join(' | ')} |`).join('\n') + '\n';
	}
}
