import { sanitizeHashtag, sanitizeHashtags } from '../../util';
import { KeepJson } from "./models/KeepJson";

/**
 * Reads a Google Keep JSON file and returns a markdown string.
 */
export function convertJsonToMd(jsonContent: KeepJson): string {
    let mdContent = '';

    // Add in tags to represent Keep properties
    if(jsonContent.color !== 'DEFAULT') {
        let colorName = jsonContent.color.toLowerCase();
        colorName = capitalizeFirstLetter(colorName);
        mdContent += `#Keep/Color/${colorName} `;
    }
    if(jsonContent.isPinned)    mdContent += `#Keep/Pinned `;
    if(jsonContent.attachments)	mdContent += `#Keep/Attachment `;
    if(jsonContent.isArchived)	mdContent += `#Keep/Archived `;
    if(jsonContent.isTrashed) 	mdContent += `#Keep/Deleted `;
    
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
        const normalizedTextContent = sanitizeHashtags(jsonContent.textContent);
        mdContent += `\n\n`;
        mdContent += `${normalizedTextContent}\n`;
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

    return mdContent;	
}


/**
 * Takes a string and returns in lowercase with the first letter capitalised.
 */
function capitalizeFirstLetter(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

