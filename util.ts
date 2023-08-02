import { DataWriteOptions, TFile, TFolder, normalizePath } from "obsidian";
import { PickedFile } from "filesystem";


function escapeRegex(str: string): string {
	return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

const ILLEGAL_FILENAME_CHARACTERS = '\\/:*?<>\"|';
const ILLEGAL_FILENAME_RE = new RegExp('[' + escapeRegex(ILLEGAL_FILENAME_CHARACTERS) + ']', 'g');

const ILLEGAL_HASHTAG_CHARACTERS = '\\:*?<>\"|!@#$%^&()+=\`\'~;,.';
const ILLEGAL_HASHTAG_RE = new RegExp('[' + escapeRegex(ILLEGAL_HASHTAG_CHARACTERS) + ']', 'g');

// Finds any non-whitespace sections starting with #
const POTENTIAL_HASHTAGS_RE = new RegExp(/(#[^ ^#]*)/, 'g');

export function sanitizeFileName(name: string) {
	return name.replace(ILLEGAL_FILENAME_RE, '');
}

/**
 * Searches a string for characters unsupported by Obsidian in the hashtag body and returns a snaitized string.
 * If the # symbol is included at the start or anywhere else it will be removed.
 */
export function sanitizeHashtag(name: string): string {
	let tagName = name.replace(ILLEGAL_HASHTAG_RE, '');
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
	const newStr = str.replace(POTENTIAL_HASHTAGS_RE, (str: string) : string => {
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

export function pathToFilename(path: string) {
	if (!path.contains('/')) return path;

	let lastSlashPosition = path.lastIndexOf('/');
	let filename = path.slice(lastSlashPosition + 1);
	let lastDotPosition = filename.lastIndexOf('.');

	if (lastDotPosition === -1 || lastDotPosition === filename.length - 1 || lastDotPosition === 0) {
		return filename;
	}

	return filename.slice(0, lastDotPosition);
}

/**
 * Retrieves a reference to a specific folder in a vault. Creates it first if it doesn't exist.
 */
export async function getOrCreateFolder(folderPath: string): Promise<TFolder> {
	let normalizedPath = normalizePath(folderPath)
	if(normalizedPath === '') {
		normalizedPath = '/';
	}

	const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
	if(folder instanceof TFolder) {
		return folder;
	}
	
	await this.app.vault.createFolder(normalizedPath);
	const newFolder = this.app.vault.getAbstractFileByPath(normalizedPath) as TFolder;
	return newFolder;
}

/**
 * Copies a file into the vault without parsing it or checking for duplicates.
 * Designed primarily for Binary files.
 */
export async function copyFile(file: PickedFile, relOutputFilepath: string) {
    let { vault } = this.app;
	await vault.createBinary(relOutputFilepath, await file.read());
}

/**
 * Adds a single tag to the tag property in frontmatter.
 * Will be sanitized.
 */
export async function addTagToFrontmatter(tag: string, fileRef: TFile) {
	const sanitizedTag = sanitizeHashtag(tag);
	await this.app.fileManager.processFrontMatter(fileRef, (frontmatter: any) => {
		if(!frontmatter['tag']) {
			frontmatter['tag'] = [sanitizedTag];
		} else {
			if (!Array.isArray(frontmatter['tag'])) {
				frontmatter['tag'] = frontmatter['tag'].split(' ');
			}
			frontmatter['tag'].push(sanitizedTag);
		}
	});
}

/**
 * Adds an alias to the note's frontmatter.
 * Only linebreak sanitzation is performed in this function.
*/
export async function addAliasToFrontmatter(alias: string, fileRef: TFile) {
	const sanitizedAlias = alias.split('\n').join(', ');
	await this.app.fileManager.processFrontMatter(fileRef, (frontmatter: any) => {      
		if(!frontmatter['alias']) {
			frontmatter['alias'] = [sanitizedAlias];
		} else {
			if (!Array.isArray(frontmatter['alias'])) {
				frontmatter['alias'] = frontmatter['alias'].split(' ');
			}
			frontmatter['alias'].push(sanitizedAlias);
		}
	});
}

/**
 * Allows modiying the write options (such as creation and last edited date) without adding or removing anything to the file
 */
export async function modifyWriteOptions(fileRef:TFile, writeOptions: DataWriteOptions) {
	let { vault } = this.app;
	await vault.append(fileRef, '', writeOptions);
}