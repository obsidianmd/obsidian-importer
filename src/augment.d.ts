import 'obsidian';

declare module 'obsidian' {
	interface App {
		metadataTypeManager: {
			setType: (key: string, type: string) => void;
		};
	}

	interface Vault {
		getConfig: (key: string) => any;

		getAbstractFileByPathInsensitive(path: string): TAbstractFile | null;
	}
}
