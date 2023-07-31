import { TFolder, normalizePath } from "obsidian";
import fs from 'fs/promises';


function escapeRegex(str: string): string {
	return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

const ILLEGAL_FILENAME_CHARACTERS = '\\/:*?<>\"|';
const ILLEGAL_FILENAME_RE = new RegExp('[' + escapeRegex(ILLEGAL_FILENAME_CHARACTERS) + ']', 'g');

const ILLEGAL_HASHTAG_CHARACTERS = ILLEGAL_FILENAME_CHARACTERS + '!@#$%^&()+=\`\'~;,.';
const ILLEGAL_HASHTAG_RE = new RegExp('[' + escapeRegex(ILLEGAL_HASHTAG_CHARACTERS) + ']', 'g');

export function sanitizeFileName(name: string) {
	return name.replace(ILLEGAL_FILENAME_RE, '');
}

export function sanitizeHashtag(name: string): string {
	let tagName = name.replace(ILLEGAL_HASHTAG_RE, '');
	tagName = tagName.split(' ').join('-');
	return tagName;
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
 * Returns an object with name and ext properties.
 * Doesn't accept a full path.
 */
export function separatePathNameExt(fullPath: string): {path: string, name: string, ext: string} {
	let lastSlashPosition = fullPath.lastIndexOf('/');
	let filename = fullPath.slice(lastSlashPosition + 1);
	const lastDotPosition = filename.lastIndexOf('.');
	
	let path = fullPath.substring(0, lastSlashPosition);
	let name = filename.substring(0, lastDotPosition);
	let ext = filename.substring(lastDotPosition + 1);

	// If there is no period, then the filename has no extension.
	// if (lastDotPosition === -1) {
	// 	ext = '';
	// }
	
	return {
		path,
		name,
		ext,
	};
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


export async function copyFile(absSrcFilepath: string, relOutputFilepath: string) {
    let { vault } = this.app;
	const fileData = await fs.readFile(absSrcFilepath);
	await vault.createBinary(relOutputFilepath, fileData);
}