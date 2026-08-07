import { ImportContext } from '../import-context';
import { Notice, TFile, requestUrl } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { helpUrl } from '../constants';
import { sanitizeFileName } from '../util';
import { BlockInfo, RoamBlock, RoamPage } from './roam/models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from './roam/utils';
import { RoamPageConverter } from './roam/convert';
import { blockRefRegex, extractBlockReferenceUIDs } from './roam/block-refs';

const regex = /{{pdf:|{{\[\[pdf|{{\[\[audio|{{audio:|{{video:|{{\[\[video/;
const imageRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)\)/;
const binaryRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)/;

/** The help page this importer's own guide lives at; see main.ts's registry. */
const HELP_PERMALINK = 'import/roam';

export class RoamJSONImporter extends FormatImporter {
	interruption = 'pause' as const;

	downloadAttachments: boolean = false;
	progress: ImportContext;
	userDNPFormat: string;

	// YAML options
	fileDateYAML: boolean = false;
	titleYAML: boolean = false;

	init() {
		// Above the chooser, because it is where the thing to choose comes from
		this.addSetting('source')
			?.setName('Export your data')
			.setDesc('Export your data in JSON format.')
			.addButton(button => button
				.setButtonText('Open')
				.onClick(() => window.open(helpUrl(HELP_PERMALINK))));

		this.addFileChooserSetting('Roam (.json)', ['json'], false,
			'Pick the JSON file from your Roam export.');
		this.addOutputLocationSetting('Roam');
		this.userDNPFormat = this.getUserDNPFormat();

		this.addSetting()
			?.setName('Import settings')
			.setHeading();

		this.addSetting()
			?.setName('Download all attachments')
			.setDesc('If enabled, all attachments uploaded to Roam will be downloaded to your attachments folder.')
			.addToggle(toggle => {
				toggle.setValue(this.downloadAttachments);
				toggle.onChange(async (value) => {
					this.downloadAttachments = value;
				});
			});

		this.addSetting()
			?.setName('Add YAML created/update date')
			.setDesc('If enabled, notes will have the create-time and edit-time from Roam added as properties.')
			.addToggle(toggle => {
				toggle.setValue(this.fileDateYAML);
				toggle.onChange(async (value) => {
					this.fileDateYAML = value;
				});
			});

		this.addSetting()
			?.setName('Add YAML title')
			.setDesc('If enabled, notes will have the full title added as a property (regardless of illegal file name characters).')
			.addToggle(toggle => {
				toggle.setValue(this.titleYAML);
				toggle.onChange(async (value) => {
					this.titleYAML = value;
				});
			});

		// A Roam page is addressed by its title, so the note of that name is the
		// page - no id needed, and none to write
		this.addDuplicateHandlingSetting();
	}

	async import(progress: ImportContext) {
		this.progress = progress;
		let { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		let outputFolder = await this.getOutputFolder();
		if (!outputFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		for (let file of files) {
			if (await progress.shouldStop()) {
				return;
			}

			const graphName = sanitizeFileName(file.basename);
			const graphFolder = `${outputFolder.path}/${graphName}`;
			const attachmentsFolder = `${outputFolder.path}/${graphName}/Attachments`;

			// create the base graph folders
			await this.createFolders(graphFolder);
			await this.createFolders(attachmentsFolder);

			// read the graph
			const data = await file.readText();
			const allPages = JSON.parse(data) as RoamPage[];

			// PRE-PROCESS: map the blocks for easy lookup //
			const [blockLocations, toPostProcess] = this.preprocess(allPages);

			const markdownPages: Map<string, string> = new Map();
			for (const pageData of allPages) {
				let pageName = convertDateString(sanitizeFileNameKeepPath(pageData.title), this.userDNPFormat).trim();
				if (pageName === '') {
					progress.reportFailed(pageData.uid, 'Title is empty');
					console.error('Cannot import data with an empty title', pageData);
					continue;
				}
				const filename = `${graphFolder}/${pageName}.md`;

				// if title option is enabled
				const YAMLtitle = this.titleYAML ? pageData.title : '';

				// if timestamp option is enabled
				// set up numbers to pass, default to 0
				let pageCreateTimestamp: number = 0;
				let pageEditTimestamp: number = 0;
				if (this.fileDateYAML) {
					// get page creation time and update time
					let pageCreateTime = pageData['create-time'];
					let pageEditTime = pageData['edit-time'];

					// type check both for numbers, set to 0 if there's a type mismatch
					if (typeof pageCreateTime === 'number') {
						pageCreateTimestamp = pageCreateTime;
					}

					if (typeof pageEditTime === 'number') {
						pageEditTimestamp = pageEditTime;
					}
				}

				const converter = this.newConverter();
				const markdownOutput = await converter.jsonToMarkdown(graphFolder, attachmentsFolder, pageData, '', false, YAMLtitle, pageCreateTimestamp, pageEditTimestamp);
				markdownPages.set(filename, markdownOutput);
			}

			// POST-PROCESS: fix block refs //
			for (const callingBlock of toPostProcess.values()) {
				const callingBlockStringScrubbed = await this.newConverter()
					.roamMarkupScrubber(graphFolder, attachmentsFolder, callingBlock.blockString, true);
				const newCallingBlockReferences = await this.extractAndProcessBlockReferences(markdownPages, blockLocations, graphFolder, callingBlockStringScrubbed);

				const callingBlockFilePath = `${graphFolder}/${callingBlock.pageName}.md`;
				const callingBlockMarkdown = markdownPages.get(callingBlockFilePath);
				if (callingBlockMarkdown) {
					let lines = callingBlockMarkdown.split('\n');

					let index = lines.findIndex((item: string) => item.contains('* ' + callingBlockStringScrubbed));
					if (index !== -1) {
						lines[index] = lines[index].replace(callingBlockStringScrubbed, newCallingBlockReferences);
					}

					markdownPages.set(callingBlockFilePath, lines.join('\n'));
				}
			}

			// WRITE-PROCESS: create the actual pages //
			const { vault } = this;
			const totalCount = markdownPages.size;
			let index = 1;
			for (const [filename, markdownOutput] of markdownPages.entries()) {
				if (await progress.shouldStop()) {
					return;
				}

				try {
					//create folders for nested pages [[some/nested/subfolder/page]]
					const { parent, name } = parseFilePath(filename);
					const folder = await this.createFolders(parent);

					// A Roam page is addressed by its title, so a page imported
					// before is the note of that name. Case-insensitively: on
					// macOS "Page.md" and "page.md" are one file, and the exact
					// lookup used to miss that and fail the page on create.
					const existingFile = this.duplicateHandling === DuplicateHandling.CreateCopy
						? null
						: vault.getAbstractFileByPathInsensitive(filename);

					if (existingFile instanceof TFile) {
						if (this.duplicateHandling === DuplicateHandling.Skip) {
							progress.reportSkipped(filename, 'page already exists');
							index++;
							continue;
						}

						if (await vault.read(existingFile) === markdownOutput) {
							progress.reportSkipped(filename, 'page unchanged since last import');
							index++;
							continue;
						}

						await vault.modify(existingFile, markdownOutput);
					}
					else {
						await this.createFile(folder, name, markdownOutput);
					}
					progress.reportNoteSuccess(filename);
					progress.reportProgress(index, totalCount);
				}
				catch (error) {
					console.error('Error saving Markdown to file:', filename, error);
					progress.reportFailed(filename);
				}

				index++;
			}
		}
	}

	private getUserDNPFormat(): string {
		// @ts-expect-error : Internal Method
		const dailyNotePluginInstance = this.app.internalPlugins.getPluginById('daily-notes').instance;
		if (!dailyNotePluginInstance) {
			console.warn('Daily note plugin is not enabled. Roam import defaulting to "YYYY-MM-DD" format.');
			return 'YYYY-MM-DD';
		}

		let dailyPageFormat = dailyNotePluginInstance.options.format;
		return dailyPageFormat || 'YYYY-MM-DD';
	}

	/** The conversion, with this importer's settings and its downloader. */
	private newConverter(): RoamPageConverter {
		return new RoamPageConverter({
			userDNPFormat: this.userDNPFormat,
			fileDateYAML: this.fileDateYAML,
			titleYAML: this.titleYAML,
			downloadAttachments: this.downloadAttachments,
			downloadFirebaseFile: (blockText, folder) => this.downloadFirebaseFile(blockText, folder),
		});
	}

	private preprocess(pages: RoamPage[]): Map<string, BlockInfo>[] {
		// preprocess/map the graph so each block can be quickly found 
		let blockLocations: Map<string, BlockInfo> = new Map();
		let toPostProcessblockLocations: Map<string, BlockInfo> = new Map();
		const userDNPFormat = this.userDNPFormat;

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
				for (let child of block.children) {
					processBlock(page, child);
				}
			}
		}

		for (let page of pages) {
			if (page.children) {
				for (let block of page.children) {
					processBlock(page, block);
				}
			}
		}

		return [blockLocations, toPostProcessblockLocations];
	}


	// setup to hold the newest and oldest timestamp value from a given page
	newestTimestamp: number = 0;
	oldestTimestamp: number = 0;


	private async modifySourceBlockString(markdownPages: Map<string, string>, sourceBlock: BlockInfo, graphFolder: string, sourceBlockUID: string) {
		if (!sourceBlock.blockString.endsWith('^' + sourceBlockUID)) {
			const sourceBlockFilePath = `${graphFolder}/${sourceBlock.pageName}.md`;
			let markdown = markdownPages.get(sourceBlockFilePath);

			if (markdown) {
				let lines = markdown.split('\n');

				// Edit the specific line, for example, the 5th line.
				let index = lines.findIndex((item: string) => item.contains('* ' + sourceBlock.blockString));
				if (index !== -1) {
					let newSourceBlockString = sourceBlock.blockString + ' ^' + sourceBlockUID;

					// replace the line before updating sourceBlock
					lines[index] = lines[index].replace(sourceBlock.blockString, newSourceBlockString);
					sourceBlock.blockString = sourceBlock.blockString + ' ^' + sourceBlockUID;
				}

				markdownPages.set(sourceBlockFilePath, lines.join('\n'));
			}
		}
	}

	private async extractAndProcessBlockReferences(markdownPages: Map<string, string>, blockLocations: Map<string, BlockInfo>, graphFolder: string, inputString: string): Promise<string> {
		const blockReferences = extractBlockReferenceUIDs(inputString);

		// If there are no block references, return the input string as is
		if (blockReferences.length === 0) {
			return inputString;
		}

		// Asynchronously process each block reference
		let processedBlocks: string[] = [];

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
				let strippedSourceBlockString = sourceBlock.blockString.replace(/\[\[|\]\]/g, '');
				// create the obsidian alias []()
				let processedBlock = `[[${graphFolder}/${sourceBlock.pageName}#^${sourceBlockUID}|${strippedSourceBlockString}]]`;
				// Modify the source block markdown page asynchronously so the new obsidian alias points to something
				await this.modifySourceBlockString(markdownPages, sourceBlock, graphFolder, sourceBlockUID);

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

	private async downloadFirebaseFile(line: string, attachmentsFolder: string): Promise<string> {
		const { progress, vault } = this;

		let url = '';
		try {
			let link: RegExpMatchArray | null;
			let syntaxLink: RegExpMatchArray | null;
			if (regex.test(line)) {
				link = line.match(/https:\/\/firebasestorage(.*?)\?alt(.*?)\}/);
				syntaxLink = line.match(/{{.*https:\/\/firebasestorage.*?alt=media&.*?(?=\s|$)/);

			}
			else if (imageRegex.test(line)) {
				link = line.match(imageRegex);
				syntaxLink = line.match(/!\[.*https:\/\/firebasestorage.*?alt=media&.*?(?=\s|$)/);
			}
			else {
				// I expect this to be a bare link which is typically a binary file
				link = line.match(binaryRegex);
				syntaxLink = line.match(/https:\/\/firebasestorage.*?alt=media&.*?(?=\s|$)/);
			}

			if (link && syntaxLink) {
				const firebaseShort = 'https://firebasestorage' + link[1];

				let filename = decodeURIComponent(firebaseShort.split('/').last() || '');
				if (filename) {
					// Ensure the required subfolders exist
					const filenameParts = filename.split('/');
					if (filenameParts.length > 1) {
						filenameParts.splice(-1, 1);
						await this.createFolders(`${attachmentsFolder}/${filenameParts.join('/')}`);
					}
				}
				else {
					// If we can't find the filename, then generate one with a timestamp and the original extension.
					const timestamp = Math.floor(Date.now() / 1000);
					const extMatch = firebaseShort.slice(-5).match(/(.*?)\.(.+)/);
					if (!extMatch) {
						progress.reportSkipped(link[1], 'Unexpected file extension');
						return line;
					}

					filename = `${timestamp}.${extMatch[2]}`;
				}

				const newFilePath = `${attachmentsFolder}/${filename}`;

				const existingFile = vault.getAbstractFileByPath(newFilePath);
				if (existingFile) {
					progress.reportSkipped(link[1], 'File already exists');
					return line;
				}

				url = link[0].slice(0, -1);
				const data = (await requestUrl(url)).arrayBuffer;

				await vault.createBinary(newFilePath, data);

				progress.reportAttachmentSuccess(url);

				// const newLine = line.replace(link.input, newFilePath)
				return line.replace(syntaxLink[0], `![[${newFilePath}]]`);

			}
		}
		catch (error) {
			console.error(error);
			progress.reportFailed(url, error);
		}

		return line;
	}
}
