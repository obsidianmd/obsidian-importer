import { AuthCallback } from './constants';
import type { AttachmentLocation, DuplicateHandling } from './format-importer';

export interface OutputSettings {
	folder: string;
	attachments: AttachmentLocation;
	duplicates: DuplicateHandling;
	saveSourceId: boolean;
}

export interface ImporterData {
	/** Legacy OneNote import data. */
	importers: {
		onenote?: {
			previouslyImportedIDs: string[];
		};
	};
	secrets: Record<string, string>;
	/** Legacy output folders. */
	outputLocations: Record<string, string>;
	outputSettings: Record<string, OutputSettings>;
	sourceFolders: Record<string, string>;
	lastSourceFolder: string;
}

export const DEFAULT_DATA: ImporterData = {
	importers: {
		onenote: {
			previouslyImportedIDs: [],
		},
	},
	secrets: {},
	outputLocations: {},
	outputSettings: {},
	sourceFolders: {},
	lastSourceFolder: '',
};

export interface HostPlugin {
	loadData(): Promise<ImporterData>;
	saveData(data: ImporterData): Promise<void>;
	registerAuthCallback(callback: AuthCallback): void;
}
