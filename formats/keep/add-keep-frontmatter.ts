import { TFile } from "obsidian";
import { addAliasToFrontmatter, addTagToFrontmatter, sanitizeHashtag } from '../../util';
import { KeepJson } from "./models/KeepJson";



export function addKeepFrontMatter(fileRef: TFile, keepJson: KeepJson) {

	if (keepJson.title) addAliasToFrontmatter(keepJson.title, fileRef);

	// Add in tags to represent Keep properties
	if(keepJson.color !== 'DEFAULT') {
		let colorName = keepJson.color.toLowerCase();
		colorName = capitalizeFirstLetter(colorName);
		addTagToFrontmatter(`Keep/Color/${colorName}`, fileRef);
	}
	if(keepJson.isPinned)    	addTagToFrontmatter(`Keep/Pinned`, fileRef);
	if(keepJson.attachments)	addTagToFrontmatter(`Keep/Attachment`, fileRef);
	if(keepJson.isArchived)		addTagToFrontmatter(`Keep/Archived`, fileRef);
	if(keepJson.isTrashed) 		addTagToFrontmatter(`Keep/Deleted`, fileRef);

	if (keepJson.labels) {
		let labels = '';
		for (let i = 0; i < keepJson.labels.length; i++) {
			addTagToFrontmatter(`Keep/Label/${keepJson.labels[i].name}`, fileRef);
		}
	};
}


/**
 * Takes a string and returns in lowercase with the first letter capitalised.
 */
function capitalizeFirstLetter(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

