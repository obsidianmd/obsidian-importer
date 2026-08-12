import { moment } from 'obsidian';
import { RoamBlock, RoamPage } from './models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from './utils';
import { BlockTarget, blockRefRegex } from './block-refs';

const INDENT = '    ';

const roamSpecificMarkup = ['POMO', 'word-count', 'date', 'slider', 'encrypt', 'TaoOfRoam', 'orphans', 'count', 'character-count', 'comment-button', 'query', 'streak', 'attr-table', 'mentions', 'search', 'roam/render', 'calc'];
const roamSpecificMarkupRe = new RegExp(`\\{\\{(\\[\\[)?(${roamSpecificMarkup.join('|')})(\\]\\])?.*?\\}\\}(\\})?`, 'g');

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

		blockText = blockText.replace(/{{TODO}}|{{\[\[TODO\]\]}}/g, '[ ]');
		blockText = blockText.replace(/{{DONE}}|{{\[\[DONE\]\]}}/g, '[x]');
		blockText = blockText.replace('::', ':');

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

	async jsonToMarkdown(graphFolder: string, attachmentsFolder: string, json: RoamPage | RoamBlock, indent: string = '', isChild: boolean = false, setTitleProperty: string, createdTimestamp: number, updatedTimestamp: number): Promise<string> {
		let markdown: string[] = [];
		let frontMatterYAML: string[] = [];
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

		if (json.children) {
			for (const child of json.children) {
				// The page is not a bullet, so its own blocks start at the margin
				markdown.push(await this.jsonToMarkdown(graphFolder, attachmentsFolder, child, isChild ? indent + INDENT : indent, true, '', this.oldestTimestamp, this.newestTimestamp));
			}
		}

		if ((this.fileDateYAML || this.titleYAML) && !isChild) {

			let timeCreated = this.oldestTimestamp;

			frontMatterYAML.push('---');

			if (this.titleYAML) {
				frontMatterYAML.push(`title: "${setTitleProperty}"`);
			}

			if (this.fileDateYAML) {
				let TSFormat = 'YYYY-MM-DD HH:mm:ss';

				let formatUpdateDate = this.newestTimestamp ? moment(this.newestTimestamp).format(TSFormat) : moment(new Date()).format(TSFormat);
				let formatCreateDate = timeCreated ? moment(timeCreated).format(TSFormat) : formatUpdateDate;

				frontMatterYAML.push('created: ' + formatCreateDate);
				frontMatterYAML.push('updated: ' + formatUpdateDate);
			}

			frontMatterYAML.push('---');

			markdown.unshift(frontMatterYAML.join('\n'));
		}

		return markdown.join('\n');
	}
}
