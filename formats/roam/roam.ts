import { ImportResult } from '../../main';
import { RoamImportOptions } from './models/RoamJson';


export const importRoamJson = async (options:RoamImportOptions): Promise<ImportResult> => {
    let results: ImportResult = {
		total: 0,
		failed: [],
		skipped: []
	};
    console.log(options.jsonSources, options.outputDir)
    // loop through jsonSources
    // for each source import
    // What should happen if there are duplicate page names?
        // 1. append the new page to the end of the existing page
        // 2. name the new page pageName (graphName)
        // 3. each graph gets a sub folder within the parent Roam folder
    return results;
}