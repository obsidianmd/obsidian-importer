import { RoamPage, RoamBlock, BlockInfo } from './models/roam-json';
import { PickedFile, path } from 'filesystem';
import { RoamJSONImporter } from 'formats/roam-json';
import { sanitizeFileName } from '../../util';
import { sanitizeFileNameKeepPath, convertDateString } from './roam_utils';
import { TFile, TFolder, Vault } from 'obsidian';
import { downloadFirebaseFile } from './roam_dl_attachment';
import { ProgressReporter } from '../../main';

const roamSpecificMarkup = ['POMO', 'word-count', 'date', 'slider', 'encrypt', 'TaoOfRoam', 'orphans', 'count', 'character-count', 'comment-button', 'query', 'streak', 'attr-table', 'mentions', 'search', 'roam\/render', 'calc'];
const roamSpecificMarkupRe = new RegExp(`\\{\\{(\\[\\[)?(${roamSpecificMarkup.join('|')})(\\]\\])?.*?\\}\\}(\\})?`, 'g');

const blockRefRegex = /(?<=\(\()\b(.*?)\b(?=\)\))/g;

function preprocess(userDNPFormat: string, pages: RoamPage[]): Map<string, BlockInfo>[] {
	// preprocess/map the graph so each block can be quickly found 
	let blockLocations: Map<string, BlockInfo> = new Map();
	let toPostProcessblockLocations: Map<string, BlockInfo> = new Map();

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

async function roamMarkupScrubber(vault: Vault, userDNPFormat: string, graphFolder: string, attachmentsFolder: string, blockText: string, downloadAttachments: boolean): Promise<string> {
	// Remove roam-specific components
	blockText = blockText.replace(roamSpecificMarkupRe, '');

	if (blockText.substring(0, 8) == ':hiccup ' && blockText.includes(':hr')) {
		return '---';
	} // Horizontal line in markup, replace it with MD

	//sanitize [[page names]]
	//check for roam DNP and convert to obsidian DNP
	blockText = blockText.replace(/\[\[(.*?)\]\]/g, (match, group1) => `[[${convertDateString(sanitizeFileNameKeepPath(group1), userDNPFormat)}]]`);

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
	if (downloadAttachments) {
		if (blockText.includes('firebasestorage')) {
			blockText = await downloadFirebaseFile(vault, blockText, attachmentsFolder);
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

async function jsonToMarkdown(vault: Vault, userDNPFormat: string, graphFolder: string, attachmentsFolder: string, downloadAttachments: boolean, json: RoamPage | RoamBlock, indent: string = '', isChild: boolean = false): Promise<string> {
	let markdown: string[] = [];

	if ('string' in json && json.string) {
		const prefix = json.heading ? '#'.repeat(json.heading) + ' ' : '';
		const scrubbed = await roamMarkupScrubber(vault, userDNPFormat, graphFolder, attachmentsFolder, json.string, downloadAttachments);
		markdown.push(`${isChild ? indent + '* ' : indent}${prefix}${scrubbed}`);
	}

	if (json.children) {
		for (const child of json.children) {
			markdown.push(await jsonToMarkdown(vault, userDNPFormat, graphFolder, attachmentsFolder, downloadAttachments, child, indent + '  ', true));
		}
	}

	return markdown.join('\n');
}

async function modifySourceBlockString(markdownPages: Map<string, string>, sourceBlock: BlockInfo, graphFolder: string, sourceBlockUID: string) {
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

async function extractAndProcessBlockReferences(markdownPages: Map<string, string>, blockLocations: Map<string, BlockInfo>, graphFolder: string, inputString: string): Promise<string> {
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
			await modifySourceBlockString(markdownPages, sourceBlock, graphFolder, sourceBlockUID);

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

export async function importRoamJson(importer: RoamJSONImporter, progress: ProgressReporter, files: PickedFile[], outputFolder: TFolder, downloadAttachments: boolean = true) {
	const { vault } = importer;
	const userDNPFormat = importer.getUserDNPFormat();

	for (let file of files) {
		const graphName = sanitizeFileName(file.basename);
		const graphFolder = `${outputFolder.path}/${graphName}`;
		const attachmentsFolder = `${outputFolder.path}/${graphName}/Attachments`;

		// create the base graph folders
		await importer.createFolders(graphFolder);
		await importer.createFolders(attachmentsFolder);

		// read the graph
		const data = await file.readText();
		const allPages = JSON.parse(data) as RoamPage[];

		// PRE-PROCESS: map the blocks for easy lookup //
		const [blockLocations, toPostProcess] = preprocess(userDNPFormat, allPages);

		const markdownPages: Map<string, string> = new Map();
		for (let index in allPages) {
			const pageData = allPages[index];

			let pageName = convertDateString(sanitizeFileNameKeepPath(pageData.title), userDNPFormat).trim();
			if (pageName === '') {
				progress.reportFailed(pageData.uid, 'Title is empty');
				console.error('Cannot import data with an empty title', pageData);
				continue;
			}
			const filename = `${graphFolder}/${pageName}.md`;

			const markdownOutput = await jsonToMarkdown(vault, userDNPFormat, graphFolder, attachmentsFolder, downloadAttachments, pageData);
			markdownPages.set(filename, markdownOutput);
		}

		// POST-PROCESS: fix block refs //
		for (const [_, callingBlock] of toPostProcess.entries()) {
			const callingBlockStringScrubbed = await roamMarkupScrubber(vault, userDNPFormat, graphFolder, attachmentsFolder, callingBlock.blockString, false);
			const newCallingBlockReferences = await extractAndProcessBlockReferences(markdownPages, blockLocations, graphFolder, callingBlockStringScrubbed);

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
		for (const [filename, markdownOutput] of markdownPages.entries()) {
			try {
				//create folders for nested pages [[some/nested/subfolder/page]]
				await importer.createFolders(path.dirname(filename));
				const existingFile = vault.getAbstractFileByPath(filename) as TFile;
				if (existingFile) {
					await vault.modify(existingFile, markdownOutput);
				}
				else {
					await vault.create(filename, markdownOutput);
				}
				progress.reportNoteSuccess(filename);
			}
			catch (error) {
				console.error('Error saving Markdown to file:', filename, error);
				progress.reportFailed(filename);
			}
		}
	}
}