import { parseFrontMatterAliases, parseFrontMatterTags } from "obsidian";
import { KeepJson } from "./models";

let potentialTagsRe = /(#[^ ^#]*)/g; // Finds any non-whitespace sections starting with #
let illegalTagCharsRe = /[\\:*?<>\"|!@#$%^&()+=\`\'~;,.]/g;

/**
 * Searches a string for characters unsupported by Obsidian in the tag body and returns a sanitized string.
 * If the # symbol is included at the start or anywhere else it will be removed.
 */

export function sanitizeTag(name: string): string {
	// Remove problem characters
	let tagName = name
		.replace(illegalTagCharsRe, '');
	// Convert spaces to hyphens	
	tagName = tagName.split(' ').join('-');
	// Prevent tags starting with a number
	if (!isNaN(tagName[0] as any)) {
		tagName = '_' + tagName;
	}

	return tagName;
}
/**
 * Searches a string for tags that include characters unsupported in tags by Obsidian.
 * Returns a string with those hastags normalised.
 */

export function sanitizeTags(str: string): string {
	const newStr = str.replace(potentialTagsRe, (str: string): string => {
		return '#' + sanitizeTag(str);
	});
	return newStr;
}

export function genUid(length: number): string {
	let array: string[] = [];
	for (let i = 0; i < length; i++) {
		array.push((Math.random() * 16 | 0).toString(16));
	}
	return array.join('');
}
/**
 * Takes a string and returns in lowercase with the first letter capitalised.
 */

export function toSentenceCase(str: string) {
	return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
/**
 * Adds a single tag to the tag property in frontmatter and santises it.
 */

export function addTagToFrontmatter(frontmatter: any, tag: string) {
	const sanitizedTag = sanitizeTag(tag);
	if (!frontmatter['tags']) {
		frontmatter['tags'] = [sanitizedTag];
	} else {
		if (!Array.isArray(frontmatter['tags'])) {
			frontmatter['tags'] = parseFrontMatterTags(frontmatter['tags']);
		}
		frontmatter['tags'].push(sanitizedTag);
	}
}
/**
 * Adds an alias to the note's frontmatter.
 * Only linebreak sanitization is performed in this function.
 * Must pass in app.fileManager.
*/

export function addAliasToFrontmatter(frontmatter: any, alias: string) {
	const sanitizedAlias = alias.split('\n').join(', ');
	if (!frontmatter['aliases']) {
		frontmatter['aliases'] = [sanitizedAlias];
	} else {
		if (!Array.isArray(frontmatter['aliases'])) {
			frontmatter['aliases'] = parseFrontMatterAliases(frontmatter['aliases']);
		}
		frontmatter['aliases'].push(sanitizedAlias);
	}
}

/**
 * Reads a Google Keep JSON file and returns a markdown string.
 */
export function convertJsonToMd(jsonContent: KeepJson): string {
    let mdContent = [];

    if(jsonContent.textContent) {
        const normalizedTextContent = sanitizeTags(jsonContent.textContent);
        mdContent.push(`${normalizedTextContent}\n`);
    }

    if(jsonContent.listContent) {
        if(mdContent) mdContent.push(`\n\n`);
        for (const listItem of jsonContent.listContent) {
            // Don't put in blank checkbox items
            if(!listItem.text) continue;
            
            let listItemContent = `- [${listItem.isChecked ? 'X' : ' '}] ${listItem.text}\n`;
            mdContent.push(sanitizeTags(listItemContent));
        }
    }

    if(jsonContent.attachments) {
        for (const attachment of jsonContent.attachments) {
            mdContent.push(`\n\n![[${attachment.filePath}]]`);
        }
    }

    return mdContent.join('');	
}
