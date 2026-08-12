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
import { BlockInfo, RoamBlock, RoamPage } from './models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from './utils';
import { blockRefRegex, extractBlockReferenceUIDs } from './block-refs';

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
}

export class RoamGraphConverter {
	private options: RoamGraphOptions;
	private graphFolder: string;

	constructor(options: RoamGraphOptions) {
		this.options = options;
		this.graphFolder = options.graphFolder;
	}

	async convert(allPages: RoamPage[]): Promise<ConvertedGraph> {
		// PRE-PROCESS: map the blocks for easy lookup //
		const [blockLocations, toPostProcess] = this.preprocess(allPages);

		const markdownPages: Map<string, string> = new Map();
		const pageUids: Map<string, string> = new Map();

		for (const pageData of allPages) {
			const pageName = convertDateString(sanitizeFileNameKeepPath(pageData.title), this.options.userDNPFormat).trim();
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
			const markdownOutput = await converter.jsonToMarkdown(this.graphFolder, filename, pageData, '', false, YAMLtitle, pageCreateTimestamp, pageEditTimestamp);
			markdownPages.set(filename, markdownOutput);
			if (pageData.uid) pageUids.set(filename, pageData.uid);
		}

		// POST-PROCESS: fix block refs //
		for (const callingBlock of toPostProcess.values()) {
			const callingBlockStringScrubbed = await this.newConverter()
				.roamMarkupScrubber(this.graphFolder, `${this.graphFolder}/${callingBlock.pageName}.md`, callingBlock.blockString, true);
			const newCallingBlockReferences = await this.extractAndProcessBlockReferences(markdownPages, blockLocations, callingBlockStringScrubbed);

			const callingBlockFilePath = `${this.graphFolder}/${callingBlock.pageName}.md`;
			const callingBlockMarkdown = markdownPages.get(callingBlockFilePath);
			if (callingBlockMarkdown) {
				const lines = callingBlockMarkdown.split('\n');

				const index = lines.findIndex((item: string) => item.contains('- ' + callingBlockStringScrubbed));
				if (index !== -1) {
					lines[index] = lines[index].replace(callingBlockStringScrubbed, newCallingBlockReferences);
				}

				markdownPages.set(callingBlockFilePath, lines.join('\n'));
			}
		}

		return { pages: markdownPages, uids: pageUids };
	}

	private newConverter(): RoamPageConverter {
		return new RoamPageConverter(this.options);
	}

	private preprocess(pages: RoamPage[]): Map<string, BlockInfo>[] {
		// preprocess/map the graph so each block can be quickly found
		const blockLocations: Map<string, BlockInfo> = new Map();
		const toPostProcessblockLocations: Map<string, BlockInfo> = new Map();
		const userDNPFormat = this.options.userDNPFormat;

		function processBlock(page: RoamPage, block: RoamBlock) {
			if (block.uid) {
				//check for roam DNP and convert to obsidian DNP
				const dateObject = new Date(page.uid);
				if (!isNaN(dateObject.getTime())) {
					// The string can be converted to a Date object
					const newPageTitle = convertDateString(page.title, userDNPFormat);
					page.title = newPageTitle;
				}

				const info = {
					pageName: sanitizeFileNameKeepPath(page.title),
					blockString: block.string,
				};

				const containsBlockRefRegex = /.*?(\(\(.*?\)\)).*?/g;
				if (containsBlockRefRegex.test(block.string)) {
					toPostProcessblockLocations.set(block.uid, info);
				}
				blockLocations.set(block.uid, info);
			}

			if (block.children) {
				for (const child of block.children) {
					processBlock(page, child);
				}
			}
		}

		for (const page of pages) {
			if (page.children) {
				for (const block of page.children) {
					processBlock(page, block);
				}
			}
		}

		return [blockLocations, toPostProcessblockLocations];
	}

	private modifySourceBlockString(markdownPages: Map<string, string>, sourceBlock: BlockInfo, sourceBlockUID: string) {
		if (!sourceBlock.blockString.endsWith('^' + sourceBlockUID)) {
			const sourceBlockFilePath = `${this.graphFolder}/${sourceBlock.pageName}.md`;
			const markdown = markdownPages.get(sourceBlockFilePath);

			if (markdown) {
				const lines = markdown.split('\n');

				// Edit the specific line, for example, the 5th line.
				const index = lines.findIndex((item: string) => item.contains('- ' + sourceBlock.blockString));
				if (index !== -1) {
					const newSourceBlockString = sourceBlock.blockString + ' ^' + sourceBlockUID;

					// replace the line before updating sourceBlock
					lines[index] = lines[index].replace(sourceBlock.blockString, newSourceBlockString);
					sourceBlock.blockString = sourceBlock.blockString + ' ^' + sourceBlockUID;
				}

				markdownPages.set(sourceBlockFilePath, lines.join('\n'));
			}
		}
	}

	private async extractAndProcessBlockReferences(markdownPages: Map<string, string>, blockLocations: Map<string, BlockInfo>, inputString: string): Promise<string> {
		const blockReferences = extractBlockReferenceUIDs(inputString);

		// If there are no block references, return the input string as is
		if (blockReferences.length === 0) {
			return inputString;
		}

		// Asynchronously process each block reference
		const processedBlocks: string[] = [];

		for (const sourceBlockUID of blockReferences) {
			try {
				const sourceBlock = blockLocations.get(sourceBlockUID);

				if (!sourceBlock) {
					// no block with that uid exists
					// most likely just double ((WITH_REGULAR_TEXT))
					processedBlocks.push(sourceBlockUID);
					continue;
				}

				// the source block string needs to be stripped of any page syntax or the alias won't work
				const strippedSourceBlockString = sourceBlock.blockString.replace(/\[\[|\]\]/g, '');
				// create the obsidian alias []()
				const processedBlock = `[[${this.graphFolder}/${sourceBlock.pageName}#^${sourceBlockUID}|${strippedSourceBlockString}]]`;
				// Modify the source block markdown page so the new obsidian alias points to something
				this.modifySourceBlockString(markdownPages, sourceBlock, sourceBlockUID);

				processedBlocks.push(processedBlock);
			}
			catch {
				// no block with that uid exists
				// most likely just double ((WITH_REGULAR_TEXT))
				processedBlocks.push(sourceBlockUID);
			}
		}

		// Replace the block references in the input string with the processed ones
		let index = 0;
		const processedString = inputString.replace(blockRefRegex, () => processedBlocks[index++]);

		return processedString;
	}
}
