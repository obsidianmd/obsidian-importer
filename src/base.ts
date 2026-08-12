import { TFolder, TFile, BasesConfigFile, stringifyYaml, normalizePath, Vault } from 'obsidian';

/**
 * How an importer treats a source database's computed fields (formulas, rollups,
 * lookups, counts).
 *
 * 'static' writes the value the source last computed into each note. 'hybrid'
 * translates the expression into a Base formula where it can, so the values stay
 * live, and falls back to the static value where it cannot.
 */
export type FormulaImportStrategy = 'static' | 'hybrid';

/** Creates or replaces a Base configuration file. */
export async function createBaseFile(
	folder: TFolder,
	fileName: string,
	contents: BasesConfigFile,
	vault: Vault
): Promise<TFile> {
	const yamlContent = stringifyYaml(contents);
	// Node's path module is unavailable on mobile.
	const filePath = normalizePath(`${folder.path}/${fileName}.base`);

	const existingFile = vault.getAbstractFileByPath(filePath);
	if (existingFile instanceof TFile) {
		await vault.modify(existingFile, yamlContent);
		return existingFile;
	}

	return await vault.create(filePath, yamlContent);
}
