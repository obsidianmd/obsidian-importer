import { AuthCallback } from './constants';

/**
 * What the plugin keeps between sessions, and the slice of the plugin an
 * importer is allowed to reach.
 *
 * Both live here rather than in main.ts for the same reason ImportContext does:
 * an importer needing them must not have to load the plugin, the dialog and
 * every other importer to get at them.
 */

export interface ImporterData {
	importers: {
		onenote?: {
			previouslyImportedIDs: string[];
		};
	};
	/**
	 * Importer id -> the SecretStorage id holding that importer's credential.
	 *
	 * Only the id is kept here. The credential itself lives in Obsidian's
	 * keychain, so it is never written to the plugin's data file.
	 */
	secrets: Record<string, string>;
}

export const DEFAULT_DATA: ImporterData = {
	importers: {
		onenote: {
			previouslyImportedIDs: [],
		},
	},
	secrets: {},
};

/**
 * The plugin as an importer sees it: somewhere to keep data between runs, and
 * somewhere to register an OAuth callback.
 *
 * Declared structurally, so ImporterPlugin satisfies it without an importer
 * ever naming the class. That is what keeps the dependency one-way - main.ts
 * reaches the importers, and nothing reaches back.
 */
export interface HostPlugin {
	loadData(): Promise<ImporterData>;
	saveData(data: ImporterData): Promise<void>;
	registerAuthCallback(callback: AuthCallback): void;
}
