import { sanitizeHashtag } from '../../util';
import { KeepJson } from "./models/KeepJson";

/**
 * Reads a Google Keep JSON file and creates a markdown note from it in the Obsidian vault.
 */
export function convertJsonToMd(jsonContent: KeepJson): string {
    let mdContent = '';

    // Add in tags to represent Keep properties
    if(jsonContent.color !== 'DEFAULT') {
        mdContent += `#Keep/Color/${jsonContent.color} `;
    }
    if(jsonContent.isPinned)    mdContent += `#Keep/Pinned `;
    if(jsonContent.attachments)	mdContent += `#Keep/Attachment `;
    if(jsonContent.isArchived)	mdContent += `#Keep/Archived `;
    if(jsonContent.isTrashed) 	mdContent += `#Keep/Trashed `;
    
    // Add Keep labels in as tags
	if(jsonContent.labels) {
        let labels = '';
        for(let i=0; i<jsonContent.labels.length; i++) {
            const labelName = sanitizeHashtag(jsonContent.labels[i].name);
            if(i > 0) labels += ' ';
            labels += `#Keep/Label/${labelName}`;
        }
        mdContent += labels; 
    };

    if(jsonContent.title) {
        mdContent += `\n\n`;
        mdContent += `## ${jsonContent.title}\n`;
    }

    if(jsonContent.textContent) {
        mdContent += `\n\n`;
        mdContent += `${jsonContent.textContent}\n`;
    }

    if(jsonContent.listContent) {
        mdContent += `\n\n`;
        for(let i=0; i<jsonContent.listContent.length; i++) {
            const listItem = jsonContent.listContent[i];
            
            // Don't put in blank checkbox items
            if(!listItem.text) continue;
            
            let listItemContent = `- [${listItem.isChecked ? 'X' : ' '}] ${listItem.text}\n`;
            mdContent += listItemContent;
        }
    }

    if(jsonContent.attachments) {
        for(let i=0; i<jsonContent.attachments.length; i++) {
            const attachment = jsonContent.attachments[i];
            mdContent += `\n\n![[${attachment.filePath}]]`
        }
    }

    // Update created and modified date to match Keep data if desired
    // if(settings.createdDate === CreatedDateTypes.googleKeep) {
        // const options: DataWriteOptions = {
        //     ctime: content.createdTimestampUsec/1000,
        //     mtime: content.userEditedTimestampUsec/1000
        // }
        // await vault.append(fileRef, '', options);
    // }

    return mdContent;





	// 		// Bail if the file has been read correctly but is malformed
	// 		let content: KeepJson | undefined;
	// 		try {
	// 			content = JSON.parse(readerEvent.target.result as string) as KeepJson;
	// 		} catch(e) {
	// 			console.log(e);
	// 			result.logStatus = LogStatus.Error;
	// 			result.details = `<p>JSON file appears to be malformed and can't be imported. You can open this file and either attempt to correct and reimport it, or to copy it's contents manually.</p>
	// 			<p><a href="https://www.toptal.com/developers/json-formatter">Toptal JSON Formatter</a> can help to find errors and format JSON data for easier manual copying. Open the file in a text editor (or drag it into a browser tab), to copy the contents into the formatter.</p>`;
	// 			return resolve(result);
	// 		}
		
	// 		// Bail if the file has been read correctly but doesn't match the expected Keep format
	// 		if(!objectIsKeepJson(content)) {
	// 			result.logStatus = LogStatus.Error;
	// 			result.details = `JSON file doesn't match the expected Google Keep format and therefore can't be imported.`;
	// 			return resolve(result);
	// 		}




	// 		// TODO: Refactor this as IsFileTypeUserAccepted function
	// 		// Abort if user doesn't want this type of file
	// 		if(content.isArchived && !settings.importArchived) {
	// 			result.logStatus = LogStatus.Note;
	// 			result.ignoredReason = IgnoreImportReason.Archived;
	// 			return resolve(result);
	// 		}
	// 		if(content.isTrashed && !settings.importTrashed) {
	// 			result.logStatus = LogStatus.Note;
	// 			result.ignoredReason = IgnoreImportReason.Trashed;
	// 			return resolve(result);
	// 		}



			
	// 		let path = `${folder.path}/${filenameSanitize(content.title || getNameAndExt(file.name).name, settings)}`;


	// 		// TODO: Refactor this as createNewMarkdownFile function
	// 		// Create new file
	// 		result.obsidianFilepath = path;
	// 		let fileRef: TFile;
	// 		try {
	// 			fileRef = await createNewEmptyMdFile(vault, path, {});
	// 		} catch (error) {
	// 			result.logStatus = LogStatus.Error;
	// 			result.error = error;
	// 			result.details = `<p>Please check the intended name doesn't include any characters not allowed by your operating system. This can happen if you've modified the character mapping options in this plugin's settings so that they don't match your operating system.</p>`;
	// 			return resolve(result);
	// 		}
		

	


	


			
	// 		return resolve(result);	
	// 	}
		
	// })
	
}


