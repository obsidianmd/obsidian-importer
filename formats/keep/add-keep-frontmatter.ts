import { TFile } from "obsidian";
import { addAliasToFrontmatter, addTagToFrontmatter, sanitizeHashtag } from '../../util';
import { KeepJson } from "./models/KeepJson";

export function addKeepFrontMatter(fileRef: TFile, keepJson: KeepJson) {
	if (keepJson.title) addAliasToFrontmatter(keepJson.title, fileRef);
	if (keepJson.labels) {
		let labels = '';
		for (let i = 0; i < keepJson.labels.length; i++) {
			const labelName = sanitizeHashtag(keepJson.labels[i].name);
			addTagToFrontmatter(`#Keep/Label/${labelName}`, fileRef);
		}
	};
}
