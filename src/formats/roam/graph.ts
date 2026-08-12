import { RoamPageConverter, RoamConverterOptions } from './convert';
import { RoamBlock, RoamPage } from './models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from './utils';
import { availableFileName, sanitizeFilePath } from '../../util';
import { BlockTarget, extractBlockReferenceUIDs } from './block-refs';
import { BlockIndex } from '../../block-refs';
import { isTableMarker } from './convert';

export interface RoamGraphOptions extends RoamConverterOptions {
	graphFolder: string;
	prepareNote?: (filePath: string) => Promise<void>;
	reportFailed?: (id: string, reason: string) => void;
	emptyTitleReason?: string;
}

export interface ConvertedGraph {
	pages: Map<string, string>;
	uids: Map<string, string>;
	attributeNames: string[];
}

export class RoamGraphConverter {
	private options: RoamGraphOptions;
	private graphFolder: string;

	private blocks = new BlockIndex();
	private noteNames = new Map<string, string>();

	constructor(options: RoamGraphOptions) {
		this.options = options;
		this.graphFolder = options.graphFolder;
	}

	async convert(allPages: RoamPage[]): Promise<ConvertedGraph> {
		// Resolve names and cross-page references before rendering any page.
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

			await this.options.prepareNote?.(filename);
			const converter = this.newConverter();
			const markdownOutput = await converter.jsonToMarkdown(this.graphFolder, filename, pageData);
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

	private linkTo(pageName: string): string {
		return pageName.includes('/') ? `${this.graphFolder}/${pageName}` : pageName;
	}

	private resolveBlockReference(uid: string): BlockTarget | null {
		const block = this.blocks.resolve(uid);
		if (!block) return null;

		return `${this.linkTo(block.page)}#^${block.anchor}`;
	}

	/** Assigns unique names once so files and links use the same result. */
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

	private index(pages: RoamPage[]): void {
		const walk = (pageName: string, block: RoamBlock, insideTable: boolean) => {
			const marker = isTableMarker(block.string);

			// Tables cannot carry block anchors after conversion.
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

	private noteNameFor(page: RoamPage): string {
		const named = convertDateString(sanitizeFileNameKeepPath(page.title), this.options.userDNPFormat).trim();

		return sanitizeFilePath(named, this.graphFolder);
	}

}
