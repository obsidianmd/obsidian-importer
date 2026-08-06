import { AuthCallback } from './constants';

export interface ImporterData {
	importers: {
		onenote?: {
			previouslyImportedIDs: string[];
		};
	};
	/**
	 * Importer id -> the SecretStorage id holding that importer's credential.
	 */
	secrets: Record<string, string>;
	/**
	 * Importer id -> the folder that importer last wrote to.
	 */
	outputLocations: Record<string, string>;
}

export const DEFAULT_DATA: ImporterData = {
	importers: {
		onenote: {
			previouslyImportedIDs: [],
		},
	},
	secrets: {},
	outputLocations: {},
};

export interface HostPlugin {
	loadData(): Promise<ImporterData>;
	saveData(data: ImporterData): Promise<void>;
	registerAuthCallback(callback: AuthCallback): void;
}
