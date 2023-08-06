import { ImportResult } from '../../main';
import { readFileSync } from "fs"
import { RoamPage, RoamBlock, JsonObject, BlockParentTitle, BlockInfo } from './models/roam-json';
import { PickedFile } from 'filesystem';
import { RoamJSONImporter } from 'formats/roam-json';
import { sanitizeFileName, sanitizeFileNameKeepPath, getUserDNPFormat, convertDateString } from '../../util';
import { TFolder } from 'obsidian';
import path from 'path';
import { Console } from 'console';

const userDNPFormat = getUserDNPFormat();

function preprocess(pages: RoamPage[]): Map<string, BlockInfo> {
    // preprocess/map the graph so each block can be quickly found 
    // as well as it's line in the markdown file
	let blockLocations: Map<string, BlockInfo> = new Map();

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
				blockLocations.set(block.uid, {
				pageName: page.title,
				lineNumber: lineNumber
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

	return blockLocations;
}

const roamMarkupScrubber = (graphFolder:string, blockText: string, downloadAttachments: boolean = false) => {
	// get rid of roam-specific components
	if (
	  blockText.substring(0, 9) == "{{[[query" ||
	  blockText.substring(0, 7) == "{{query"
	)
	  return "";
	if (
		blockText.substring(0, 10) == "{{[[streak" ||
		blockText.substring(0, 8) == "{{streak"
	)
		return "";
	if (blockText.substring(0, 12) == "{{attr-table") return "";
	if (blockText.substring(0, 15) == "{{[[mentions]]:") return "";
	if (blockText.substring(0, 8) == ":hiccup " && blockText.includes(":hr"))
	  return "---"; // Horizontal line in markup, replace it with MD
    if (blockText.substring(0, 9) == "{{[[search") return "";

    //sanatize [[page names]]
	//check for roam DNP and convert to obsidian DNP
	blockText = blockText.replace(/\[\[(.*?)\]\]/g, (match, group1) => `[[${convertDateString(sanitizeFileNameKeepPath(group1), userDNPFormat)}]]`);
	
    // Regular expression to find nested pages [[SOME/TEXT]]     
    // Replace each match with an Obsidian alias [[Artificial Intelligence|AI]]
	blockText = blockText.replace(/\[\[(.*\/.*)\]\]/g, (_, group1) => `[[${graphFolder}/${group1}|${group1}]]`);

	blockText = blockText.replaceAll("[[>]]", ">");
	blockText = blockText.replaceAll("{{TODO}}", "[ ]");
	blockText = blockText.replaceAll("{{[[TODO]]}}", "[ ]");
	blockText = blockText.replaceAll("{{DONE}}", "[x]");
	blockText = blockText.replaceAll("{{[[DONE]]}}", "[x]");
	blockText = blockText.replaceAll("{{word-count}}", "");
	blockText = blockText.replaceAll("{{date}}", "");
	blockText = blockText.replaceAll("{{[[POMO]]}}", "");
	blockText = blockText.replaceAll("{{POMO}}", "");
	blockText = blockText.replaceAll("{{slider}}", "");
	blockText = blockText.replaceAll("{{[[slider]]}}", "");
    blockText = blockText.replaceAll("{{encrypt}}", "[ ]");
	blockText = blockText.replaceAll("{{[[encrypt]]}}", "[ ]");

	blockText = blockText.replaceAll("{{TaoOfRoam}}", "");
	blockText = blockText.replaceAll("{{orphans}}", "");
	blockText = blockText.replaceAll("{{[[orphans]]}}", "");
	blockText = blockText.replaceAll("{{count}}", "");
	blockText = blockText.replaceAll("{{character-count}}", "");
	blockText = blockText.replaceAll("{{comment-button}}", "");
	blockText = blockText.replace("::", ":"); // ::
	
	blockText = blockText.replaceAll(/{{\[\[roam\/render\]\][^}]*}}/g, ""); 
	blockText = blockText.replaceAll(/{{roam\/render[^}]*}}/g, ""); 
	blockText = blockText.replaceAll(/\_\_(.+?)\_\_/g, "*$1*"); // __ __ itallic
	blockText = blockText.replaceAll(/\^\^(.+?)\^\^/g, "==$1=="); // ^^ ^^ highlight
    
    // blockText = blockText.replaceAll("{{[[table]]}}", ""); 
	// blockText = blockText.replaceAll("{{[[kanban]]}}", "");
	// blockText = blockText.replaceAll("{{mermaid}}", "");
	// blockText = blockText.replaceAll("{{[[mermaid]]}}", "");
    // blockText = blockText.replaceAll("{{diagram}}", "");
	// blockText = blockText.replaceAll("{{[[diagram]]}}", "");

	// block refs
	// blockText = blockText.replaceAll(/\(\((.+?)\)\)/g, "$1"); // (())
	// match and replace block refs with obsidian syntax
	// const regex = /\(\((.*?)\)\)/g;
	// const matches = blockText.match(regex)//.map(match => match.slice(2, -2));
	// if (matches) {
	// 	matches.forEach(match => {
	// 		// const modifiedMatch = modifyBlockString(match);
	// 		// inputString = inputString.replace(match, modifiedMatch);
	// 		// [SOURCE_TEXT]([[SOURCE_PAGE#^SOURCE_BLOCK_UID]])
	// 		const sourceBlock = blockMap.get(match.slice(2, -2));
	// 		// console.log("blockRef",match.slice(2, -2),sourceBlock);
	// 		if (sourceBlock) {
	// 			const newString = roamMarkupScrubber(sourceBlock.block.string, blockMap, stripFormatting=true)
	// 			const newBlock = `[${newString}]([[${sourceBlock.parentTitle}#^${sourceBlock.block.uid}]])`
	// 			// console.log(newBlock)
	// 		}
	// 	});
	// }


	//   blockText = blockText.replaceAll(/\!\[(.+?)\]\((.+?)\)/g, "$1 $2"); //images with description
	//   blockText = blockText.replaceAll(/\!\[\]\((.+?)\)/g, "$1"); //imags with no description
	//   blockText = blockText.replaceAll(/\[(.+?)\]\((.+?)\)/g, "$1: $2"); //alias with description
	//   blockText = blockText.replaceAll(/\[\]\((.+?)\)/g, "$1"); //alias with no description
	//   blockText = blockText.replaceAll(/\[(.+?)\](?!\()(.+?)\)/g, "$1"); //alias with embeded block (Odd side effect of parser)

	return blockText;
  };

function jsonToMarkdown(graphFolder:string, json: JsonObject, indent: string = '', isChild: boolean = false ): string {
    let markdown = '';

    if (json.string) {
        let prefix = '';
        if (json.heading) {
            prefix = '#'.repeat(json.heading) + ' ';
        }
        markdown += `${isChild ? indent + '* ' : indent}${prefix}${(roamMarkupScrubber(graphFolder, json.string))}\n`;
    }

    if (json.children) {
        for (const child of json.children) {
            markdown += jsonToMarkdown(graphFolder,child, indent + '  ', true);
        }
    }

    return markdown;
}



export const importRoamJson = async (importer:RoamJSONImporter, files:PickedFile[], folder:TFolder,): Promise<ImportResult> => {
    let results: ImportResult = {
		total: 0,
		failed: [],
		skipped: []
	};
    // loop through jsonSources
    // for each source import
//     ### Pre-process
        // 1. load in the json 
        // 2. if a line has a block ref
            // 	1. Save the file name and line number
            // 	2. look up the referenced block
            // 	3. save the referenced
// ### Save to markdown file
    // 	General markdown processing needs to happen here
    // 	Sanatize file names
// ### Post-Process
    // 	go back into markdown and fix everything so it matches
    // 		1. make sure page names match
    // 		2. for lines that have a block ref

	// convert each roam .json output selected by the user
    for (let file of files) {
        const graphName = sanitizeFileName(file.basename);
        const graphFolder = folder.path+"/"+graphName
        // create the base graph folder
        importer.createFolders(graphFolder)

        // read the graph
        const data = readFileSync(file.filepath, "utf8")
        const allPages = JSON.parse(data) as RoamPage[]
        //set the total pages to be imported
        results.total=allPages.length
        // map the blocks for easy lookup
        const blockLocations = preprocess(allPages)

        // now create the actual pages
        for (let index in allPages) {
            const pageData = allPages[index]
			//TODO fix sanitization for nested pages
            const pageName = convertDateString(sanitizeFileNameKeepPath(pageData.title), userDNPFormat)
            const filename = graphFolder + "/" + pageName + ".md";
            // convert json to nested markdown
            const markdownOutput = jsonToMarkdown(graphFolder, pageData);
            

            try {
                console.log(filename)
				const existingFile = app.vault.getAbstractFileByPath(filename);
				if (existingFile) {
					await app.vault.adapter.write(existingFile.path, markdownOutput);
					console.log("Markdown replaced in existing file:", existingFile.path);
				} else {
					const newFile = await app.vault.create(filename, markdownOutput);
					console.log("Markdown saved to new file:", newFile.path);
				}
			} catch (error) {
				console.error("Error saving Markdown to file:", filename, error);
                results.failed.push(pageName)
			}
               
            
            
        }
    }
    console.log(results)
    throw "DevBreak"


    return results;
}