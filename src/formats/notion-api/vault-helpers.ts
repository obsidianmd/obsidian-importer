/**
 * Vault helper functions for Notion API importer
 * Functions for interacting with Obsidian vault
 */

import { Vault, App } from 'obsidian';
import { getUniqueFilePath } from '../../util';

/**
 * Get a free path to create a folder at, appending 1, 2, etc. if needed
 *
 * Shares getUniqueFilePath's route through Vault.getAvailablePath; a folder is
 * just a path with no extension.
 */
export function getUniqueFolderPath(vault: Vault, parentPath: string, folderName: string): string {
	return getUniqueFilePath(vault, parentPath, folderName);
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

