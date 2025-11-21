/**
 * Vault helper functions for Notion API importer
 * Functions for interacting with Obsidian vault
 */

import { Vault, normalizePath } from 'obsidian';

/**
 * Get a unique folder path by appending 1, 2, etc. if needed
 * Uses the same naming convention as Obsidian's attachment deduplication (space + number)
 */
export function getUniqueFolderPath(vault: Vault, parentPath: string, folderName: string): string {
	let basePath = normalizePath(`${parentPath}/${folderName}`);
	let finalPath = basePath;
	let counter = 1;
	
	while (vault.getAbstractFileByPath(finalPath)) {
		finalPath = normalizePath(`${parentPath}/${folderName} ${counter}`);
		counter++;
	}
	
	return finalPath;
}

/**
 * Get a unique file path by appending 1, 2, etc. if needed
 * Uses the same naming convention as Obsidian's attachment deduplication (space + number)
 */
export function getUniqueFilePath(vault: Vault, parentPath: string, fileName: string): string {
	let basePath = normalizePath(`${parentPath}/${fileName}`);
	let finalPath = basePath;
	let counter = 1;
	
	console.log(`[GET UNIQUE FILE] Checking: ${basePath}`);
	while (vault.getAbstractFileByPath(finalPath)) {
		// Insert counter before file extension
		const lastDotIndex = fileName.lastIndexOf('.');
		if (lastDotIndex > 0) {
			const nameWithoutExt = fileName.substring(0, lastDotIndex);
			const ext = fileName.substring(lastDotIndex);
			finalPath = normalizePath(`${parentPath}/${nameWithoutExt} ${counter}${ext}`);
		}
		else {
			finalPath = normalizePath(`${parentPath}/${fileName} ${counter}`);
		}
		console.log(`[GET UNIQUE FILE] Path exists, trying: ${finalPath}`);
		counter++;
	}
	
	console.log(`[GET UNIQUE FILE] Final path: ${finalPath}`);
	return finalPath;
}

