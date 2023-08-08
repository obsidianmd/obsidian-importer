import { sanitizeTags } from '../../util';
import { KeepJson } from "./models/KeepJson";

/**
 * Reads a Google Keep JSON file and returns a markdown string.
 */
export function convertJsonToMd(jsonContent: KeepJson): string {
    let mdContent = '';

    if(jsonContent.textContent) {
        const normalizedTextContent = sanitizeTags(jsonContent.textContent);
        mdContent += `${normalizedTextContent}\n`;
    }

    if(jsonContent.listContent) {
        if(mdContent) mdContent += `\n\n`;
        for(let i=0; i<jsonContent.listContent.length; i++) {
            const listItem = jsonContent.listContent[i];
            
            // Don't put in blank checkbox items
            if(!listItem.text) continue;
            
            let listItemContent = `- [${listItem.isChecked ? 'X' : ' '}] ${listItem.text}\n`;
            mdContent += sanitizeTags(listItemContent);
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
