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
 * Types.json structure for Obsidian property types
 */
interface TypesJson {
	types: Record<string, string>;
}

/**
 * Queue for serializing types.json writes to prevent race conditions
 * Key: vault configDir path, Value: Promise chain
 */
const typesJsonWriteQueue = new Map<string, Promise<void>>();

/**
 * Read types.json from vault config folder
 * Returns existing types or an empty object if file doesn't exist
 * Uses adapter.read to bypass Obsidian's cache and get the latest content
 */
export async function readTypesJson(vault: Vault): Promise<TypesJson> {
	const typesPath = normalizePath(`${vault.configDir}/types.json`);
	
	try {
		// Use adapter.read to bypass cache and read directly from filesystem
		// This ensures we always get the latest content, even if vault cache is stale
		const fileExists = await vault.adapter.exists(typesPath);
		if (fileExists) {
			const content = await vault.adapter.read(typesPath);
			return JSON.parse(content);
		}
	}
	catch (error) {
		console.log('[types.json] File not found or invalid, will create new one');
	}
	
	// Return empty structure if file doesn't exist or is invalid
	return { types: {} };
}

/**
 * Write types.json to vault config folder
 * Only updates properties that don't already exist (respects user's manual changes)
 * Uses a queue to serialize writes and prevent race conditions
 */
export async function updateTypesJson(
	vault: Vault,
	propertyTypes: Record<string, string>
): Promise<void> {
	const typesPath = normalizePath(`${vault.configDir}/types.json`);
	
	// Get or create the write queue for this vault
	const existingQueue = typesJsonWriteQueue.get(typesPath) || Promise.resolve();
	
	// Chain this write operation to the queue
	const writeOperation = existingQueue.then(async () => {
		console.log('[types.json] Starting write operation...');
		
		// Read existing types (inside the queue to ensure we get the latest)
		const existingTypes = await readTypesJson(vault);
		console.log(`[types.json] Current properties count: ${Object.keys(existingTypes.types).length}`);
		
		// Merge new types, but don't override existing ones (user's manual changes take priority)
		const mergedTypes: Record<string, string> = { ...existingTypes.types };
		let hasNewTypes = false;
		
		for (const [propName, propType] of Object.entries(propertyTypes)) {
			if (!(propName in mergedTypes)) {
				// Property doesn't exist in types.json, add it
				mergedTypes[propName] = propType;
				hasNewTypes = true;
				console.log(`[types.json] Adding property: ${propName} -> ${propType}`);
			}
			else {
				console.log(`[types.json] Skipping property: ${propName} (already exists as ${mergedTypes[propName]})`);
			}
		}
		
		// Only write if there are new types to add
		if (!hasNewTypes) {
			console.log('[types.json] No new property types to add');
			return;
		}
		
		console.log(`[types.json] Total properties after merge: ${Object.keys(mergedTypes).length}`);
		
		// Write to file
		const updatedContent: TypesJson = {
			types: mergedTypes
		};
		
		const contentString = JSON.stringify(updatedContent, null, 2);
		
		try {
			// Always use adapter.write for consistency and to bypass cache
			await vault.adapter.write(typesPath, contentString);
			console.log('[types.json] Successfully updated');
		}
		catch (error) {
			console.error('[types.json] Failed to write:', error);
			// Don't throw - allow import to continue even if types.json update fails
		}
	}).catch(error => {
		console.error('[types.json] Error in write operation:', error);
	});
	
	// Update the queue IMMEDIATELY before any await
	typesJsonWriteQueue.set(typesPath, writeOperation);
	
	// Wait for this write operation to complete
	try {
		await writeOperation;
	}
	finally {
		// Clean up the queue if this was the last operation
		if (typesJsonWriteQueue.get(typesPath) === writeOperation) {
			typesJsonWriteQueue.delete(typesPath);
		}
	}
}

