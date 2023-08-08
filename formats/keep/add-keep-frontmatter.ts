import { FileManager, TFile } from "obsidian";
import { addAliasToFrontmatter, addTagToFrontmatter } from '../../util';
import { KeepJson } from "./models/KeepJson";



export async function addKeepFrontMatter(fileRef: TFile, keepJson: KeepJson, fileManager: FileManager) {

	if (keepJson.title) addAliasToFrontmatter(keepJson.title, fileRef, fileManager);

	// Add in tags to represent Keep properties
	if(keepJson.color !== 'DEFAULT') {
		let colorName = keepJson.color.toLowerCase();
		colorName = capitalizeFirstLetter(colorName);
		await addTagToFrontmatter(`Keep/Color/${colorName}`, fileRef, fileManager);
	}
	if(keepJson.isPinned)    	await addTagToFrontmatter(`Keep/Pinned`, fileRef, fileManager);
	if(keepJson.attachments)	await addTagToFrontmatter(`Keep/Attachment`, fileRef, fileManager);
	if(keepJson.isArchived)		await addTagToFrontmatter(`Keep/Archived`, fileRef, fileManager);
	if(keepJson.isTrashed) 		await addTagToFrontmatter(`Keep/Deleted`, fileRef, fileManager);

	if (keepJson.labels) {
		let labels = '';
		for (let i = 0; i < keepJson.labels.length; i++) {
			await addTagToFrontmatter(`Keep/Label/${keepJson.labels[i].name}`, fileRef, fileManager);
		}
	};
}


/**
 * Takes a string and returns in lowercase with the first letter capitalised.
 */
function capitalizeFirstLetter(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

