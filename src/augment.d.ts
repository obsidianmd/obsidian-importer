import 'obsidian';

declare module 'obsidian' {
	/**
	 * A page opened over a setting tab, with a back button of its own. Added in
	 * Obsidian 1.13, which is what this plugin asks for, and declared here
	 * because the published types are still 1.12.
	 */
	class SettingPage {
		rootEl: HTMLElement;
		titlebarEl: HTMLElement;
		containerEl: HTMLElement;
		title: string;
		display(): void;
		hide(): void;
	}

	/**
	 * The elements of a setting group: the card its settings are drawn in, and
	 * the group around it. Both are there in 1.11 and later; the published
	 * types describe the group only by the methods that add to it.
	 */
	interface SettingGroup {
		groupEl: HTMLElement;
		listEl: HTMLElement;
	}

	/**
	 * A row that leads somewhere: the chevron, the click, and the classes that
	 * go with it, including `tappable` for the tap it should answer at once.
	 * In the app since 1.13 and not in the published types.
	 */
	interface Setting {
		setNavigable(onNavigate: () => void): this;
		/** The row is an action: accent text, and the whole of it clickable. */
		setAction(onAction: () => void): this;
		/** The icon a list row is drawn with, at the start of the row. */
		setIcon(icon: IconName | null): this;
	}

	interface App {
		// The settings window, which a setting tab has to open and close itself.
		setting: {
			open(): void;
			close(): void;
			openTabById(id: string): void;
			openPage(page: SettingPage): void;
			closePage(): void;
			activeTab: SettingTab | null;
		};

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
		getParentPrefix(): string;
	}

	interface SecretStorage {
		// Available at runtime but missing from Obsidian's public types.
		deleteSecret(id: string): void;
	}
}
