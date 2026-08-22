import { AuthCallback } from './constants';
import type { AttachmentLocation, DuplicateHandling } from './format-importer';

export interface OutputSettings {
	folder: string;
	attachments: AttachmentLocation;
	duplicates: DuplicateHandling;
	saveSourceId: boolean;
	/** Frontmatter key used for the importer's managed source identity. */
	idProperty?: string;
	template?: string;
}

export interface ImporterData {
	secrets: Record<string, string>;
	/** Legacy output folders. */
	outputLocations: Record<string, string>;
	outputSettings: Record<string, OutputSettings>;
	onenoteAttachments: Record<string, string>;
	sourceFolders: Record<string, string>;
	lastSourceFolder: string;
}

export const DEFAULT_DATA: ImporterData = {
	secrets: {},
	outputLocations: {},
	outputSettings: {},
	onenoteAttachments: {},
	sourceFolders: {},
	lastSourceFolder: '',
};

export interface HostPlugin {
	loadData(): Promise<ImporterData>;
	saveData(data: ImporterData): Promise<void>;
	registerAuthCallback(callback: AuthCallback): void;
}
