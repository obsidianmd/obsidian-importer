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

export interface RoamConverterOptions {
	graphFolder: string;
	attachmentsFolder: string;
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

		blockText = blockText.replace(/\[\[>\]\]/g, '>');
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

	async jsonToMarkdown(graphFolder: string, attachmentsFolder: string, json: RoamPage | RoamBlock, indent: string = '', isChild: boolean = false, setTitleProperty: string, createdTimestamp: number, updatedTimestamp: number): Promise<string> {
		let markdown: string[] = [];
		let frontMatterYAML: string[] = [];
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

		if ('string' in json && json.string) {
			const prefix = json.heading ? '#'.repeat(json.heading) + ' ' : '';
			const scrubbed = await this.roamMarkupScrubber(graphFolder, attachmentsFolder, json.string);
			markdown.push(`${isChild ? indent + '* ' : indent}${prefix}${scrubbed}`);
		}

		if (json.children) {
			for (const child of json.children) {
				markdown.push(await this.jsonToMarkdown(graphFolder, attachmentsFolder, child, indent + '  ', true, '', this.oldestTimestamp, this.newestTimestamp));
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
}
