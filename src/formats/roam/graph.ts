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
import { availableFileName, sanitizeFilePath } from '../../util';
import { BlockTarget, extractBlockReferenceUIDs } from './block-refs';
import { BlockIndex } from '../../block-refs';
import { isTableMarker } from './convert';

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

	/** Where every block that carries a uid is, and which of them are pointed at. */
	private blocks = new BlockIndex();
	/** What each page is called as a note, by the title Roam gave it. */
	private noteNames = new Map<string, string>();

	constructor(options: RoamGraphOptions) {
		this.options = options;
		this.graphFolder = options.graphFolder;
	}

	async convert(allPages: RoamPage[]): Promise<ConvertedGraph> {
		// What every page is called, then where every block is: all of it before
		// any page is converted, since a link reaches forward as readily as back
		// and has to name the note that will actually be written.
		this.name(allPages);
		this.index(allPages);

		const markdownPages: Map<string, string> = new Map();
		const pageUids: Map<string, string> = new Map();
		const attributeNames = new Set<string>();

		for (const pageData of allPages) {
			const pageName = this.noteNames.get(pageData.title) ?? '';
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
			isReferenced: uid => this.blocks.isReferenced(uid),
			resolvePageName: title => this.noteNames.get(title) ?? null,
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
		const block = this.blocks.resolve(uid);
		if (!block) return null;

		return `${this.linkTo(block.page)}#^${block.anchor}`;
	}

	/**
	 * What every page will be called as a note.
	 *
	 * Sanitising two different titles can arrive at one name - `A[B]` and `AB`
	 * both lose their brackets, and two long titles can be cut to the same
	 * prefix - so the name is claimed here rather than where the note is
	 * written. Deciding it once is also what keeps a link and its file
	 * agreeing, since both read it from here.
	 */
	private name(pages: RoamPage[]): void {
		const taken = new Set<string>();

		for (const page of pages) {
			if (this.noteNames.has(page.title)) continue;

			const wanted = this.noteNameFor(page);
			if (wanted === '') continue;

			const free = availableFileName(wanted, candidate => taken.has(candidate.toLowerCase()));
			taken.add(free.toLowerCase());
			this.noteNames.set(page.title, free);
		}
	}

	/**
	 * Every block by its uid, and the uids something points at.
	 *
	 * A block that cannot carry an anchor is left out, so a reference to it
	 * stays as Roam wrote it rather than becoming a link to an anchor that was
	 * never written. A table is the case: its marker becomes the table and its
	 * cells become rows, and markdown gives neither anywhere to put a `^id`.
	 */
	private index(pages: RoamPage[]): void {
		const walk = (pageName: string, block: RoamBlock, insideTable: boolean) => {
			// Asked of the block itself rather than of its parent: a marker
			// nested anywhere is still a marker, and asking one level up left
			// the deeper ones indexed.
			const marker = isTableMarker(block.string);

			// A Roam uid is short and legal already, so it is its own anchor.
			if (block.uid && !insideTable && !marker) this.blocks.define(block.uid, pageName);
			for (const uid of extractBlockReferenceUIDs(block.string ?? '')) this.blocks.mention(uid);

			for (const child of block.children ?? []) walk(pageName, child, insideTable || marker);
		};

		for (const page of pages) {
			const pageName = this.noteNames.get(page.title);
			if (pageName === undefined) continue;

			for (const block of page.children ?? []) walk(pageName, block, false);
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
