import { ImportResult } from '../../main';
import { RoamImportOptions } from './models/roam-json';
import { FormatImporter } from 'format-importer';
import { readFileSync } from "fs"
import { RoamPage, RoamBlock, JsonObject, BlockParentTitle, BlockInfo } from './models/roam-json';

function preprocess(pages: RoamPage[]): Map<string, BlockInfo> {
    // preprocess/map the graph so each block can be quickly found 
    // as well as it's line in the markdown file
	let blockLocations: Map<string, BlockInfo> = new Map();

	for (let page of pages) {
		let lineNumber = 0;

		function processBlock(block: RoamBlock, level: number) {
			lineNumber++;

			if (block.uid) {
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
export const importRoamJson = async (options:[RoamImportOptions]): Promise<ImportResult> => {
    let results: ImportResult = {
		total: 0,
		failed: [],
		skipped: []
	};
    // loop through jsonSources
    // for each source import
    // What should happen if there are duplicate page names?
        // 1. append the new page to the end of the existing page
        // 2. name the new page pageName (graphName)
        // 3. each graph gets a sub folder within the parent Roam folder
    for (let importFile of options) {
        console.log(importFile)
        const data = readFileSync(importFile.jsonSources||importFile.jsonSources[0].filepath, "utf8")
		const allPages = JSON.parse(data) as RoamPage[]
        // TODO create the graph directory here
        const blockLocations = preprocess(allPages)
        console.log(blockLocations)
		// createFolders("Roam/subfolder/another.md")
    }

    return results;
}