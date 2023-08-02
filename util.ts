import { DataWriteOptions, FileManager, TFile, TFolder, Vault, normalizePath } from "obsidian";
import { PickedFile } from "filesystem";


function escapeRegex(str: string): string {
	return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

const ILLEGAL_FILENAME_CHARACTERS = '\\/:*?<>\"|';
const ILLEGAL_FILENAME_RE = new RegExp('[' + escapeRegex(ILLEGAL_FILENAME_CHARACTERS) + ']', 'g');

const ILLEGAL_TAG_CHARACTERS = '\\:*?<>\"|!@#$%^&()+=\`\'~;,.';
const ILLEGAL_TAG_RE = new RegExp('[' + escapeRegex(ILLEGAL_TAG_CHARACTERS) + ']', 'g');

// Finds any non-whitespace sections starting with #
const POTENTIAL_TAGS_RE = new RegExp(/(#[^ ^#]*)/, 'g');

export function sanitizeFileName(name: string) {
	return name.replace(ILLEGAL_FILENAME_RE, '');
}

/**
 * Searches a string for characters unsupported by Obsidian in the hashtag body and returns a snaitized string.
 * If the # symbol is included at the start or anywhere else it will be removed.
 */
export function sanitizeHashtag(name: string): string {
	let tagName = name.replace(ILLEGAL_TAG_RE, '');
	tagName = tagName.split(' ').join('-');
	if(!isNaN(tagName[0] as any)) {
		tagName = '_' + tagName;
	}
	return tagName;
}

/**
 * Searches a string for hashtags that include characters unsupported in hashtags by Obsidian.
 * Returns a string with those hastags normalised.
 */
export function sanitizeHashtags(str: string): string {
	const newStr = str.replace(POTENTIAL_TAGS_RE, (str: string) : string => {
		return '#' + sanitizeHashtag(str);
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
 * Retrieves a reference to a specific folder in a vault. Creates it first if it doesn't exist.
 * Must pass in the relevant vault.
 */
export async function getOrCreateFolder(folderPath: string, vault: Vault): Promise<TFolder> {
	let normalizedPath = normalizePath(folderPath)
	if(normalizedPath === '') {
		normalizedPath = '/';
	}

	const folder = vault.getAbstractFileByPath(normalizedPath);
	if(folder instanceof TFolder) {
		return folder;
	}
	
	await vault.createFolder(normalizedPath);
	const newFolder = vault.getAbstractFileByPath(normalizedPath) as TFolder;
	return newFolder;
}

/**
 * Copies a file into the vault without parsing it or checking for duplicates.
 * Designed primarily for Binary files.
 * Must pass in the relevant vault.
 */
export async function copyFile(file: PickedFile, relOutputFilepath: string, vault: Vault) {
	await vault.createBinary(relOutputFilepath, await file.read());
}

/**
 * Adds a single tag to the tag property in frontmatter and santises it.
 * Must pass in app.fileManager.
 */
export async function addTagToFrontmatter(tag: string, fileRef: TFile, fileManager: FileManager) {
	const sanitizedTag = sanitizeHashtag(tag);
	await fileManager.processFrontMatter(fileRef, (frontmatter: any) => {
		if(!frontmatter['tags']) {
			frontmatter['tags'] = [sanitizedTag];
		} else {
			if (!Array.isArray(frontmatter['tags'])) {
				frontmatter['tags'] = frontmatter['tags'].split(' ');
			}
			frontmatter['tags'].push(sanitizedTag);
		}
	});
}

/**
 * Adds an alias to the note's frontmatter.
 * Only linebreak sanitization is performed in this function.
 * Must pass in app.fileManager.
*/
export async function addAliasToFrontmatter(alias: string, fileRef: TFile, fileManager: FileManager) {
	const sanitizedAlias = alias.split('\n').join(', ');
	await fileManager.processFrontMatter(fileRef, (frontmatter: any) => {      
		if(!frontmatter['aliases']) {
			frontmatter['aliases'] = [sanitizedAlias];
		} else {
			if (!Array.isArray(frontmatter['aliases'])) {
				frontmatter['aliases'] = frontmatter['aliases'].split(' ');
			}
			frontmatter['aliases'].push(sanitizedAlias);
		}
	});
}

/**
 * Allows modiying the write options (such as creation and last edited date) without adding or removing anything to the file.
 * Must pass in the relevant vault.
 */
export async function modifyWriteOptions(fileRef:TFile, writeOptions: DataWriteOptions, vault: Vault) {
	await vault.append(fileRef, '', writeOptions);
}