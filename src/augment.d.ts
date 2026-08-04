import 'obsidian';

declare module 'obsidian' {
	interface App {
		metadataTypeManager: {
			getAssignedWidget: (key: string) => string | null;
			setType: (key: string, type: string) => void;
		};
	}

	interface Vault {
		getConfig: (key: string) => any;

		/**
		 * Look up a file or folder, ignoring case.
		 *
		 * getAbstractFileByPath is an exact key match on the vault's file map, but
		 * macOS and Windows filesystems are case-insensitive: "Tron.md" and "TRON.md"
		 * are one file on disk while the public lookup reports only the exact
		 * spelling as existing, so a caller relying on it never sees the conflict.
		 *
		 * Only for questions of the form "does this already exist?". To pick a path
		 * to create at, use getUniqueFilePath, which asks the vault for a free one.
		 */
		getAbstractFileByPathInsensitive(path: string): TAbstractFile | null;

		/**
		 * Get a free path to create a file at, appending 1, 2, etc. if needed.
		 *
		 * What Obsidian itself uses when creating a note: it applies the "space +
		 * number" convention and compares case-insensitively, so it will not hand
		 * back a path that collides with an existing file on a case-insensitive
		 * filesystem.
		 */
		getAvailablePath(base: string, extension?: string): string;
	}

	interface TFolder {
		/**
		 * This folder's path as a prefix to join child names onto: "Notes/" for
		 * a subfolder, and "" for the vault root, so callers do not have to
		 * special-case the root's "/" path.
		 */
		getParentPrefix(): string;
	}

	interface SecretStorage {
		/**
		 * Remove a secret.
		 *
		 * setSecret, getSecret and listSecrets are public; this is not, but a
		 * credential an importer stores on the user's behalf needs a way to be
		 * withdrawn when they sign out. Writing an empty string in its place
		 * would leave a dead entry in their keychain settings.
		 */
		deleteSecret(id: string): void;
	}
}
