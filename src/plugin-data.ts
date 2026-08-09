import { AuthCallback } from './constants';
// Types only: format-importer imports HostPlugin back from here.
import type { AttachmentLocation, DuplicateHandling } from './format-importer';

/** What the output step remembers, per importer. */
export interface OutputSettings {
	folder: string;
	attachments: AttachmentLocation;
	duplicates: DuplicateHandling;
	saveSourceId: boolean;
}

export interface ImporterData {
	/**
	 * OneNote kept the ids it had imported here. It records them in each note
	 * instead now, which survives a note being moved or renamed. Still declared
	 * so an older data file is not read as malformed.
	 */
	importers: {
		onenote?: {
			previouslyImportedIDs: string[];
		};
	};
	secrets: Record<string, string>;
	/** Superseded by outputSettings; still read so a remembered folder survives. */
	outputLocations: Record<string, string>;
	outputSettings: Record<string, OutputSettings>;
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
};

export interface HostPlugin {
	loadData(): Promise<ImporterData>;
	saveData(data: ImporterData): Promise<void>;
	registerAuthCallback(callback: AuthCallback): void;
}
