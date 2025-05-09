import { ImportContext } from 'main';
import { Notice, Setting, TFile } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { sanitizeFileName } from '../util';
import { BlockInfo, RoamBlock, RoamPage } from './roam/models/roam-json';
import { convertDateString, sanitizeFileNameKeepPath } from './roam/utils';
import { moment } from 'obsidian';

const roamSpecificMarkup = ['POMO', 'word-count', 'date', 'slider', 'encrypt', 'TaoOfRoam', 'orphans', 'count', 'character-count', 'comment-button', 'query', 'streak', 'attr-table', 'mentions', 'search', 'roam\/render', 'calc'];
const roamSpecificMarkupRe = new RegExp(`\\{\\{(\\[\\[)?(${roamSpecificMarkup.join('|')})(\\]\\])?.*?\\}\\}(\\})?`, 'g');

const regex = /{{pdf:|{{\[\[pdf|{{\[\[audio|{{audio:|{{video:|{{\[\[video/;
const imageRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)\)/;
const binaryRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)/;

const blockRefRegex = /(?<=\(\()\b(.*?)\b(?=\)\))/g;

export class RoamJSONImporter extends FormatImporter {
	downloadAttachments: boolean = false;
	progress: ImportContext;
	userDNPFormat: string;

	// YAML options
	fileDateYAML: boolean = false;
	titleYAML: boolean = false;

	init() {
		this.addFileChooserSetting('Roam (.json)', ['json']);
		this.addOutputLocationSetting('Roam');
		this.userDNPFormat = this.getUserDNPFormat();

		new Setting(this.modal.contentEl)
			.setName('Import settings')
			.setHeading();

		new Setting(this.modal.contentEl)
			.setName('Download all attachments')
			.setDesc('If enabled, all attachments uploaded to Roam will be downloaded to your attachments folder.')
			.addToggle(toggle => {
				toggle.setValue(this.downloadAttachments);
				toggle.onChange(async (value) => {
					this.downloadAttachments = value;
				});
			});

		new Setting(this.modal.contentEl)
			.setName('Add YAML created/update date')
			.setDesc('If enabled, notes will have the create-time and edit-time from Roam added as properties.')
			.addToggle(toggle => {
				toggle.setValue(this.fileDateYAML);
				toggle.onChange(async (value) => {
					this.fileDateYAML = value;
				});
			});

		new Setting(this.modal.contentEl)
			.setName('Add YAML title')
			.setDesc('If enabled, notes will have the full title added as a property (regardless of illegal file name characters).')
			.addToggle(toggle => {
				toggle.setValue(this.titleYAML);
				toggle.onChange(async (value) => {
					this.titleYAML = value;
				});
			});
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
			if (progress.isCancelled()) {
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
			for (let index in allPages) {
				const pageData = allPages[index];

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

				const markdownOutput = await this.jsonToMarkdown(graphFolder, attachmentsFolder, pageData, '', false, YAMLtitle, pageCreateTimestamp, pageEditTimestamp);
				markdownPages.set(filename, markdownOutput);
			}

			// POST-PROCESS: fix block refs //
			for (const callingBlock of toPostProcess.values()) {
				const callingBlockStringScrubbed = await this.roamMarkupScrubber(graphFolder, attachmentsFolder, callingBlock.blockString, true);
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
				if (progress.isCancelled()) {
					return;
				}

				try {
					//create folders for nested pages [[some/nested/subfolder/page]]
					const { parent } = parseFilePath(filename);
					await this.createFolders(parent);
					const existingFile = vault.getAbstractFileByPath(filename) as TFile;
					if (existingFile) {
						await vault.modify(existingFile, markdownOutput);
					}
					else {
						await vault.create(filename, markdownOutput);
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
			console.log('Daily note plugin is not enabled. Roam import defaulting to "YYYY-MM-DD" format.');
			return 'YYYY-MM-DD';
		}

		let dailyPageFormat = dailyNotePluginInstance.options.format;
		return dailyPageFormat || 'YYYY-MM-DD';
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

				const blockRefRegex = /.*?(\(\(.*?\)\)).*?/g;
				if (blockRefRegex.test(block.string)) {
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

	private async roamMarkupScrubber(graphFolder: string, attachmentsFolder: string, blockText: string, skipDownload: boolean = false): Promise<string> {
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
		blockText = blockText.replace(/\_\_(.+?)\_\_/g, '*$1*'); // __ __ itallic
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

	// setup to hold the newest and oldest timestamp value from a given page
	newestTimestamp: number = 0;
	oldestTimestamp: number = 0;

	private async jsonToMarkdown(graphFolder: string, attachmentsFolder: string, json: RoamPage | RoamBlock, indent: string = '', isChild: boolean = false, setTitleProperty: string, createdTimestamp: number, updatedTimestamp: number): Promise<string> {
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
		// Find all the matches using the regular expression
		const blockReferences = inputString.match(blockRefRegex);

		// If there are no block references, return the input string as is
		if (!blockReferences) {
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
			catch (error) {
				// no block with that uid exists
				// most likely just double ((WITH_REGULAR_TEXT))
				processedBlocks.push(sourceBlockUID);
			}
		}

		// Replace the block references in the input string with the processed ones
		let index = 0;
		const processedString = inputString.replace(/\(\(\b.*?\b\)\)/g, () => processedBlocks[index++]);

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
						this.createFolders(`${attachmentsFolder}/${filenameParts.join('/')}`);
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
				const response = await fetch(url, {});
				const data = await response.arrayBuffer();

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
