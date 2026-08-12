/**
 * A whole Roam graph, converted.
 *
 * A page on its own is not enough to convert a graph: a block reference names
 * a block by an id that can live on any other page, and the block it names has
 * to grow an anchor for the reference to reach. So the graph is walked once to
 * find where every block is, converted page by page, and walked again to
 * resolve what the first pass could not.
 *
 * Everything the vault owns arrives as a callback, so the whole conversion
 * runs in a test: where a note is about to be written, and how a file the
 * graph links to is downloaded.
 */
import { RoamPageConverter, RoamConverterOptions } from './convert';
import { RoamBlock, RoamPage } from './models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from './utils';
import { sanitizeFilePath } from '../../util';
import { BlockTarget, extractBlockReferenceUIDs } from './block-refs';

export interface RoamGraphOptions extends RoamConverterOptions {
	/** Where the graph's notes are written, as a vault path. */
	graphFolder: string;
	/**
	 * A note is about to be converted. The importer creates its folder here, so
	 * that an attachment resolves against the note's real parent.
	 */
	prepareNote?: (filePath: string) => Promise<void>;
	/** A page that cannot be written, and why. */
	reportFailed?: (id: string, reason: string) => void;
	/** The reason given for a page whose title is empty. */
	emptyTitleReason?: string;
}

/** What a graph converted to: the notes to write, and where each came from. */
export interface ConvertedGraph {
	/** Note path to its markdown, in the order the pages arrived. */
	pages: Map<string, string>;
	/** Note path to the uid of the Roam page it came from. */
	uids: Map<string, string>;
	/**
	 * Every attribute the graph turned into a property, in the order it was
	 * first seen. These are the columns the graph's Base shows.
	 */
	attributeNames: string[];
}

export class RoamGraphConverter {
	private options: RoamGraphOptions;
	private graphFolder: string;

	/** The note each block that carries an id ended up on, by that id. */
	private blocks = new Map<string, string>();
	/** The blocks something points at, which are the ones needing an anchor. */
	private referenced = new Set<string>();

	constructor(options: RoamGraphOptions) {
		this.options = options;
		this.graphFolder = options.graphFolder;
	}

	async convert(allPages: RoamPage[]): Promise<ConvertedGraph> {
		// Where every block is, and which of them something points at. Both
		// have to be known before any page is converted: a reference reaches
		// forward as readily as back.
		this.index(allPages);

		const markdownPages: Map<string, string> = new Map();
		const pageUids: Map<string, string> = new Map();
		const attributeNames = new Set<string>();

		for (const pageData of allPages) {
			const pageName = this.noteNameFor(pageData);
			if (pageName === '') {
				this.options.reportFailed?.(pageData.uid, this.options.emptyTitleReason ?? 'The page has no title');
				console.error('Cannot import data with an empty title', pageData);
				continue;
			}
			const filename = `${this.graphFolder}/${pageName}.md`;

			// if title option is enabled
			const YAMLtitle = this.options.titleYAML ? pageData.title : '';

			// if timestamp option is enabled
			// set up numbers to pass, default to 0
			let pageCreateTimestamp: number = 0;
			let pageEditTimestamp: number = 0;
			if (this.options.fileDateYAML) {
				// get page creation time and update time
				const pageCreateTime = pageData['create-time'];
				const pageEditTime = pageData['edit-time'];

				// type check both for numbers, set to 0 if there's a type mismatch
				if (typeof pageCreateTime === 'number') {
					pageCreateTimestamp = pageCreateTime;
				}

				if (typeof pageEditTime === 'number') {
					pageEditTimestamp = pageEditTime;
				}
			}

			await this.options.prepareNote?.(filename);
			const converter = this.newConverter();
			const markdownOutput = await converter.jsonToMarkdown(this.graphFolder, filename, pageData, YAMLtitle, pageCreateTimestamp, pageEditTimestamp);
			markdownPages.set(filename, markdownOutput);
			if (pageData.uid) pageUids.set(filename, pageData.uid);
			for (const name of converter.attributeNames) attributeNames.add(name);
		}

		return { pages: markdownPages, uids: pageUids, attributeNames: [...attributeNames] };
	}

	private newConverter(): RoamPageConverter {
		return new RoamPageConverter({
			...this.options,
			resolveBlockReference: uid => this.resolveBlockReference(uid),
			isReferenced: uid => this.referenced.has(uid),
		});
	}

	/**
	 * How a note in this graph is linked to.
	 *
	 * A plain title is left plain, the way a converted `[[page]]` is, so a
	 * reference and a link to the same page read alike. A title Roam wrote
	 * with a slash made a folder here, and a bare `[[a/b]]` would be read as a
	 * path, so that one is written out in full.
	 */
	private linkTo(pageName: string): string {
		return pageName.includes('/') ? `${this.graphFolder}/${pageName}` : pageName;
	}

	private resolveBlockReference(uid: string): BlockTarget | null {
		const pageName = this.blocks.get(uid);
		if (pageName === undefined) return null;

		return `${this.linkTo(pageName)}#^${uid}`;
	}

	/**
	 * Every block by its id, and the ids something points at.
	 *
	 * Only a reference to a block that is really there counts: `((a passing
	 * thought))` is somebody's parenthesis, not an id, and anchoring a block
	 * nothing reaches for would leave a `^id` on the page for no reason.
	 */
	private index(pages: RoamPage[]): void {
		const mentioned = new Set<string>();

		const walk = (pageName: string, block: RoamBlock) => {
			if (block.uid) this.blocks.set(block.uid, pageName);
			for (const uid of extractBlockReferenceUIDs(block.string ?? '')) mentioned.add(uid);

			for (const child of block.children ?? []) walk(pageName, child);
		};

		for (const page of pages) {
			const pageName = this.noteNameFor(page);
			for (const block of page.children ?? []) walk(pageName, block);
		}

		for (const uid of mentioned) {
			if (this.blocks.has(uid)) this.referenced.add(uid);
		}
	}

	/**
	 * What a page is called as a note, which is what a link to it has to say.
	 *
	 * Through the same length limit the write goes through, and per path
	 * segment so a title Roam wrote with a slash still makes its folders. A
	 * page titled with a whole sentence - the demo graph has one 250 characters
	 * long - is written under a name the filesystem will take, and a link
	 * naming the untruncated title would reach nothing.
	 */
	private noteNameFor(page: RoamPage): string {
		const named = convertDateString(sanitizeFileNameKeepPath(page.title), this.options.userDNPFormat).trim();

		return sanitizeFilePath(named, this.graphFolder);
	}

}
