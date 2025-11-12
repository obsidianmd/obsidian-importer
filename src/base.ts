import { path } from './filesystem';
import { TFolder, TFile, BasesConfigFile, stringifyYaml, normalizePath } from 'obsidian';

/**
 * Creates a Base file in the specified folder.
 * 
 * @param folder - The folder to create the Base file in
 * @param fileName - Name of the Base file (without .base extension)
 * @param options - Configuration for the Base file content
 * @param vault - Obsidian vault instance
 * @returns The created TFile
 * 
 * @example
 * ```ts
 * await createBaseFile(folder, 'CSV import', {
 *   filters: 'file.folder == "CSV import"',
 *   views: [{
 *     type: 'table',
 *     name: 'Table',
 *     order: ['file.name', 'title', 'date', 'category']
 *   }]
 * }, this.app.vault);
 * ```
 */
export async function createBaseFile(
	folder: TFolder,
	fileName: string,
	contents: BasesConfigFile,
	vault: any
): Promise<TFile> {
	const yamlContent = stringifyYaml(contents);
	const filePath = normalizePath(path.join(folder.path, fileName + '.base'));

	// Check if file already exists
	const existingFile = vault.getAbstractFileByPath(filePath);
	if (existingFile instanceof TFile) {
		// Update existing file
		await vault.modify(existingFile, yamlContent);
		return existingFile;
	}

	// Create new file
	return await vault.create(filePath, yamlContent);
}

