import { TFile } from "obsidian";
import { addAliasToFrontmatter, addTagToFrontmatter, sanitizeHashtag } from '../../util';
import { KeepJson } from "./models/KeepJson";



export async function addKeepFrontMatter(fileRef: TFile, keepJson: KeepJson) {

	if (keepJson.title) addAliasToFrontmatter(keepJson.title, fileRef);

	// Add in tags to represent Keep properties
	if(keepJson.color !== 'DEFAULT') {
		let colorName = keepJson.color.toLowerCase();
		colorName = capitalizeFirstLetter(colorName);
		await addTagToFrontmatter(`Keep/Color/${colorName}`, fileRef);
	}
	if(keepJson.isPinned)    	await addTagToFrontmatter(`Keep/Pinned`, fileRef);
	if(keepJson.attachments)	await addTagToFrontmatter(`Keep/Attachment`, fileRef);
	if(keepJson.isArchived)		await addTagToFrontmatter(`Keep/Archived`, fileRef);
	if(keepJson.isTrashed) 		await addTagToFrontmatter(`Keep/Deleted`, fileRef);

	if (keepJson.labels) {
		let labels = '';
		for (let i = 0; i < keepJson.labels.length; i++) {
			await addTagToFrontmatter(`Keep/Label/${keepJson.labels[i].name}`, fileRef);
		}
	};
}


/**
 * Takes a string and returns in lowercase with the first letter capitalised.
 */
function capitalizeFirstLetter(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

