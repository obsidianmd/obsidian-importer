/**
 * Vault helper functions for Notion API importer
 * Functions for interacting with Obsidian vault
 */

import { Vault, normalizePath, App } from 'obsidian';

/**
 * Get a unique folder path by appending 1, 2, etc. if needed
 * Uses the same naming convention as Obsidian's attachment deduplication (space + number)
 */
export function getUniqueFolderPath(vault: Vault, parentPath: string, folderName: string): string {
	let basePath = normalizePath(`${parentPath}/${folderName}`);
	let finalPath = basePath;
	let counter = 1;
	
	// Use getAbstractFileByPath for synchronous check (adapter.exists is async)
	// This is acceptable here as it's used to find a non-existent path
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
	// Use getAbstractFileByPath for synchronous check (adapter.exists is async)
	// This is acceptable here as it's used to find a non-existent path
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

/**
 * Update property types using Obsidian's official metadataTypeManager API
 * Only updates properties that don't already exist (respects user's manual changes)
 */
export function updatePropertyTypes(
	app: App,
	propertyTypes: Record<string, string>
): void {
	for (const [propName, propType] of Object.entries(propertyTypes)) {
		// Check if property already has an assigned type
		const existingType = app.metadataTypeManager.getAssignedWidget(propName);
		
		if (!existingType) {
			// Property doesn't have a type yet, set it
			app.metadataTypeManager.setType(propName, propType);
			console.log(`[Property Types] Setting type for "${propName}": ${propType}`);
		}
		else {
			// Property already has a type, respect it (user's manual change or previous database)
			console.log(`[Property Types] Skipping "${propName}" (already has type: ${existingType})`);
		}
	}
}

