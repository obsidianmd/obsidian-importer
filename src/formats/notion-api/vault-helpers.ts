/**
 * Vault helper functions for Notion API importer
 * Functions for interacting with Obsidian vault
 */

import { App, Vault, normalizePath } from 'obsidian';

/**
 * Check if a page with the given notion-id already exists in the vault
 * FIXME: This could cause performance problems if the vault is too large, so consider only performing duplicate detection on the pages/database currently being imported—since the user might actually want to import twice.
 */
export async function pageExistsInVault(app: App, vault: Vault, notionId: string): Promise<boolean> {
	const files = vault.getMarkdownFiles();
	
	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		if (cache?.frontmatter && cache.frontmatter['notion-id'] === notionId) {
			return true;
		}
	}
	
	return false;
}

/**
 * Get a unique folder path by appending (1), (2), etc. if needed
 */
export function getUniqueFolderPath(vault: Vault, parentPath: string, folderName: string): string {
	let basePath = normalizePath(`${parentPath}/${folderName}`);
	let finalPath = basePath;
	let counter = 1;
	
	while (vault.getAbstractFileByPath(finalPath)) {
		finalPath = normalizePath(`${parentPath}/${folderName} (${counter})`);
		counter++;
	}
	
	return finalPath;
}

/**
 * Get a unique file path by appending (1), (2), etc. if needed
 */
export function getUniqueFilePath(vault: Vault, parentPath: string, fileName: string): string {
	let basePath = normalizePath(`${parentPath}/${fileName}`);
	let finalPath = basePath;
	let counter = 1;
	
	while (vault.getAbstractFileByPath(finalPath)) {
		// Insert counter before file extension
		const lastDotIndex = fileName.lastIndexOf('.');
		if (lastDotIndex > 0) {
			const nameWithoutExt = fileName.substring(0, lastDotIndex);
			const ext = fileName.substring(lastDotIndex);
			finalPath = normalizePath(`${parentPath}/${nameWithoutExt} (${counter})${ext}`);
		}
		else {
			finalPath = normalizePath(`${parentPath}/${fileName} (${counter})`);
		}
		counter++;
	}
	
	return finalPath;
}

