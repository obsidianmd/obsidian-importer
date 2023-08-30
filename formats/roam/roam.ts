import { RoamPage, RoamBlock, JsonObject, BlockInfo } from './models/roam-json';
import { PickedFile, path} from 'filesystem';
import { RoamJSONImporter } from 'formats/roam-json';
import { sanitizeFileName} from '../../util';
import { sanitizeFileNameKeepPath, getUserDNPFormat, convertDateString  } from './roam_utils';
import { TFile, TFolder } from 'obsidian';
import { downloadFirebaseFile } from './roam_dl_attachment';
import { ProgressReporter } from '../../main';

// ### APPROACH 
// ## Pre-process
//		create a map of the json import and which blocks contain block refs
// ## Write-process
//		process and write pages to markdown
// 		Sanatize file names
// ## Post-Process
// 		process markdown and fix block refs (using the pre-process map)
// 		confirm page names match

const userDNPFormat = getUserDNPFormat();

function preprocess(pages: RoamPage[]): Map<string, BlockInfo>[] {
    // preprocess/map the graph so each block can be quickly found 
    // as well as it's line in the markdown file
	let blockLocations: Map<string, BlockInfo> = new Map();
	let toPostProcessblockLocations: Map<string, BlockInfo> = new Map();

	for (let page of pages) {
		let lineNumber = 0;

		function processBlock(block: RoamBlock, level: number) {
			lineNumber++;

			if (block.uid) {
				//check for roam DNP and convert to obsidian DNP
				const dateObject = new Date(page.uid);
				if (!isNaN(dateObject.getTime())) {
					// The string can be converted to a Date object
					const newPageTitle = convertDateString(page.title, userDNPFormat)
					page.title = newPageTitle
				}
				// TODO why is lineNumber sometimes innaccurate?
				const blockRefRegex = /.*?(\(\(.*?\)\)).*?/g
				if (blockRefRegex.test(block.string)) {
					toPostProcessblockLocations.set(block.uid, {
						pageName: sanitizeFileNameKeepPath(page.title),
						lineNumber: lineNumber,
						blockString:block.string,
					});
				}
				blockLocations.set(block.uid, {
					pageName: sanitizeFileNameKeepPath(page.title),
					lineNumber: lineNumber,
					blockString:block.string,
				});
			}

			if (block.children) {
				for (let child of block.children) {
				processBlock(child, level + 1);
				}
			}
		}

		if (page.children) {
		for (let block of page.children) {
			processBlock(block, 0);
		}
		}
	}

	return [blockLocations, toPostProcessblockLocations];
}

const roamMarkupScrubber = async (graphFolder:string, attachmentsFolder:string, blockText: string, downloadAttachments: boolean = false) => {
	// get rid of roam-specific components
	let stringsToReplace = ["POMO","word-count","date","slider","encrypt","TaoOfRoam","orphans","count","character-count","comment-button", "query","streak","attr-table","mentions","search","roam\/render","calc"];
	const regexPatterns = new RegExp(`\\{\\{(\\[\\[)?(${stringsToReplace.join("|")})(\\]\\])?.*?\\}\\}(\\})?`, "g");
	blockText = blockText.replace(regexPatterns, "");

	if (blockText.substring(0, 8) == ":hiccup " && blockText.includes(":hr"))
	  return "---"; // Horizontal line in markup, replace it with MD

    //sanatize [[page names]]
	//check for roam DNP and convert to obsidian DNP
	blockText = blockText.replace(/\[\[(.*?)\]\]/g, (match, group1) => `[[${convertDateString(sanitizeFileNameKeepPath(group1), userDNPFormat)}]]`);
	

    // Regular expression to find nested pages [[SOME/TEXT]]     
    // Replace each match with an Obsidian alias [[Artificial Intelligence|AI]]
	blockText = blockText.replace(/\[\[(.*\/.*)\]\]/g, (_, group1) => `[[${graphFolder}/${group1}|${group1}]]`);
	// regular block alias
	blockText = blockText.replaceAll(/\[.+?\]\((\(.+?\)\))\)/g, "$1")
	// page alias
	blockText = blockText.replaceAll(/\[(.+?)\]\(\[\[(.+?)\]\]\)/g, "[[$2|$1]]")

	blockText = blockText.replaceAll("[[>]]", ">");
	blockText = blockText.replaceAll("{{TODO}}", "[ ]");
	blockText = blockText.replaceAll("{{[[TODO]]}}", "[ ]");
	blockText = blockText.replaceAll("{{DONE}}", "[x]");
	blockText = blockText.replaceAll("{{[[DONE]]}}", "[x]");
	blockText = blockText.replace("::", ":"); // Attributes::

	blockText = blockText.replaceAll(/{{.*?\bvideo\b.*?(\bhttp.*?\byoutu.*?)}}/g, "![]($1)"); // youtube embeds
	blockText = blockText.replaceAll(/(https?:\/\/twitter\.com\/(?:#!\/)?\w+\/status\/\d+(?:\?[\w=&-]+)?)/g, "![]($1)"); // twitter embeds
	blockText = blockText.replaceAll(/\_\_(.+?)\_\_/g, "*$1*"); // __ __ itallic
	blockText = blockText.replaceAll(/\^\^(.+?)\^\^/g, "==$1=="); // ^^ ^^ highlight
    
	// block and page embeds {{embed: ((asdf))}} {{[[embed]]: [[asadf]]}}
	blockText = blockText.replaceAll(/{{\[{0,2}embed.*?(\(\(.*?\)\)).*?}}/g, "$1")
	blockText = blockText.replaceAll(/{{\[{0,2}embed.*?(\[\[.*?\]\]).*?}}/g, "$1")
	// download files uploaded to Roam
	if (downloadAttachments) {
		if (blockText.includes('firebasestorage')) {
			blockText =  await downloadFirebaseFile(blockText, attachmentsFolder)
		}
	}
    // blockText = blockText.replaceAll("{{[[table]]}}", ""); 
	// blockText = blockText.replaceAll("{{[[kanban]]}}", "");
	// blockText = blockText.replaceAll("{{mermaid}}", "");
	// blockText = blockText.replaceAll("{{[[mermaid]]}}", "");
    // blockText = blockText.replaceAll("{{diagram}}", "");
	// blockText = blockText.replaceAll("{{[[diagram]]}}", "");

	//   blockText = blockText.replaceAll(/\!\[(.+?)\]\((.+?)\)/g, "$1 $2"); //images with description
	//   blockText = blockText.replaceAll(/\!\[\]\((.+?)\)/g, "$1"); //imags with no description
	//   blockText = blockText.replaceAll(/\[(.+?)\]\((.+?)\)/g, "$1: $2"); //alias with description
	//   blockText = blockText.replaceAll(/\[\]\((.+?)\)/g, "$1"); //alias with no description
	//   blockText = blockText.replaceAll(/\[(.+?)\](?!\()(.+?)\)/g, "$1"); //alias with embeded block (Odd side effect of parser)

	return blockText;
  };

async function jsonToMarkdown(graphFolder:string, attachmentsFolder:string, downloadAttachments:boolean,json: JsonObject, indent: string = '', isChild: boolean = false ): Promise<string> {
    let markdown : string[] = [];

    if (json.string) {
        let prefix = '';
        if (json.heading) {
            prefix = '#'.repeat(json.heading) + ' ';
        }
        markdown.push(`${isChild ? indent + '* ' : indent}${prefix}${(await roamMarkupScrubber(graphFolder, attachmentsFolder, json.string, downloadAttachments))}`);
    }

    if (json.children) {
        for (const child of json.children) {
            markdown.push(await jsonToMarkdown(graphFolder, attachmentsFolder, downloadAttachments, child, indent + '  ', true));
        }
    }
	const joinedMarkdown: string = markdown.join("\n");
    return joinedMarkdown;
}

export async function importRoamJson (importer:RoamJSONImporter, progress: ProgressReporter, files:PickedFile[], folder:TFolder, downloadAttachments:boolean = true) {
    for (let file of files) {
        const graphName = sanitizeFileName(file.basename);
        const graphFolder = `${folder.path}/${graphName}`
		const attachmentsFolder = `${folder.path}/${graphName}/Attachments`
        // create the base graph folders
        await importer.createFolders(graphFolder)
		await importer.createFolders(attachmentsFolder)

		// read the graph
		// TODO is this async?
        // const data = fs.readFileSync(file.filepath, "utf8")
		const data = await file.readText(file.filepath)
        const allPages = JSON.parse(data) as RoamPage[]


        // PRE-PROCESS: map the blocks for easy lookup //
        const [blockLocations, toPostProcess] = preprocess(allPages)
		
        // WRITE-PROCESS: create the actual pages //
        for (let index in allPages) {
            const pageData = allPages[index]

			const pageName = convertDateString(sanitizeFileNameKeepPath(pageData.title), userDNPFormat)
            const filename =  `${graphFolder}/${pageName}.md`
            // convert json to nested markdown

			const markdownOutput = await jsonToMarkdown(graphFolder, attachmentsFolder, downloadAttachments, pageData);
            
			
            try {
				//create folders for nested pages [[some/nested/subfolder/page]]
                await importer.createFolders(path.dirname(filename))
				const existingFile = app.vault.getAbstractFileByPath(filename) as TFile;
				if (existingFile) {
					await app.vault.modify(existingFile, markdownOutput);
					// console.log("Markdown replaced in existing file:", existingFile.path);
				} else {
					const newFile = await app.vault.create(filename, markdownOutput);
					// console.log("Markdown saved to new file:", newFile.path);
				}
				progress.reportNoteSuccess(filename);
			} catch (error) {
				console.error("Error saving Markdown to file:", filename, error);
				progress.reportFailed(pageName);
			}
        }

		// POST-PROCESS: fix block refs //
		async function modifySourceBlockString(sourceBlockUID:string) {
			const sourceBlock = blockLocations.get(sourceBlockUID);
			
			if (!sourceBlock.blockString.endsWith("^" + sourceBlockUID)) {
				const sourceBlockFilePath = `${graphFolder}/${sourceBlock.pageName}.md`
				let sourceBlockFile = this.app.vault.getAbstractFileByPath(sourceBlockFilePath)

				if (sourceBlockFile instanceof TFile) {
					let fileContent = await this.app.vault.read(sourceBlockFile);
					let lines = fileContent.split('\n');

					// Edit the specific line, for example, the 5th line.
					let index = lines.findIndex((item: string) => item.contains( "* "+sourceBlock.blockString));
					// console.log(sourceBlock)
					if (index !== -1) {
						let newSourceBlockString = sourceBlock.blockString + ' ^' + sourceBlockUID;
						// replace the line before updating sourceBlock
						lines[index] = lines[index].replace(sourceBlock.blockString, newSourceBlockString);	
						sourceBlock.blockString = sourceBlock.blockString + ' ^' + sourceBlockUID;
					}
						let newContent = lines.join('\n');
						
						await this.app.vault.modify(sourceBlockFile, newContent);

				}
				
			} 
		}
		
		async function extractAndProcessBlockReferences(inputString: string): Promise<string> {
			const blockRefRegex = /(?<=\(\()\b(.*?)\b(?=\)\))/g;
		
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
					// the source block string needs to be stripped of any page syntax or the alias won't work
					let strippedSourceBlockString = sourceBlock.blockString.replace(/\[\[|\]\]/g, '')
					// create the obsidian alias []()
					let processedBlock = `[[${graphFolder}/${sourceBlock.pageName}#^${sourceBlockUID}|${strippedSourceBlockString}]]`
					// Modify the source block markdown page asynchronously so the new obsidian alias points to something
					await modifySourceBlockString(sourceBlockUID);
					
					processedBlocks.push(processedBlock);
				} catch (error) {
					// no block with that uid exists
					// most likely just double ((WITH_REGULAR_TEXT))
					// console.error(error)
					// console.error(error)
					processedBlocks.push(sourceBlockUID);
				}
			}
		
			// Replace the block references in the input string with the processed ones
			let index = 0;
			const processedString = inputString.replace(/\(\(\b.*?\b\)\)/g, () => processedBlocks[index++]);
			
			return processedString;
		}

		for (const [callingBlockUID, callingBlock] of toPostProcess.entries()) {
			// extract UIDs from the callingBlock.blockString
			// first Edit the referenced Bloc to add in a block UID

			// Then go back and update the original block with the new reference syntax
			// [SOURCE_TEXT]([[SOURCE_PAGE#^SOURCE_BLOCK_UID]])
			const callingBlockStringScrubbed = await roamMarkupScrubber(graphFolder, attachmentsFolder, callingBlock.blockString, false)
			
			const newCallingBlockReferences = await extractAndProcessBlockReferences(callingBlock.blockString)

			const callingBlockFilePath = `${graphFolder}/${callingBlock.pageName}.md`
			let callingBlockFile = app.vault.getAbstractFileByPath(callingBlockFilePath)
			
			if (callingBlockFile instanceof TFile) {
				let fileContent = await app.vault.read(callingBlockFile);
				let lines = fileContent.split('\n');

				let index = lines.findIndex((item: string) => item.contains( "* "+callingBlock.blockString));
				if (index !== -1) {
					lines[index] = lines[index].replace(callingBlock.blockString, newCallingBlockReferences);	
									
				}
					let newContent = lines.join('\n');
					
					await app.vault.modify(callingBlockFile, newContent);

			}

		  };
    }
}