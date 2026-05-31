// User-configurable options for the Logseq importer. See
// docs/logseq-importer-assessment.md for the rationale behind each one.

/** How rich Logseq tasks are rendered in the Obsidian vault. */
export type TaskFormat =
	| 'plain' // native checkboxes only, metadata flattened into text
	| 'tasks-emoji' // Tasks plugin, emoji-style metadata (default)
	| 'tasks-dataview'; // Tasks plugin, Dataview inline-field metadata
// 'tasknotes' (one note per task) is a later phase and intentionally omitted for now.

/** Generic keep-or-drop choice for Logseq-only content. */
export type KeepOrDrop = 'keep' | 'drop';

export interface LogseqImportOptions {
	/** Task target format. */
	taskFormat: TaskFormat;

	// --- Journals ---

	/**
	 * When true, journal folder and date format are taken from the Daily Notes core plugin
	 * and the custom fields below are ignored.
	 */
	useDailyNotes: boolean;
	/** Target Obsidian daily-note filename format (moment.js tokens), e.g. 'YYYY-MM-DD'. */
	journalDateFormat: string;
	/** Vault-relative folder (relative to output) for imported journals. */
	journalFolder: string;
	/** Flatten the outline for journal notes. */
	deOutlineJournals: boolean;

	// --- Pages ---

	/** Vault-relative folder (relative to output) for imported pages. Empty = output root. */
	pagesFolder: string;
	/** Flatten the outline for page notes. */
	deOutlinePages: boolean;

	// --- Logseq-only content (each independently keep or drop) ---

	/** LOGBOOK / CLOCK time-tracking blocks. */
	logbook: KeepOrDrop;
	/** `{{query}}` / `#+BEGIN_QUERY` blocks. */
	queries: KeepOrDrop;
	/** `#card` flashcard markers and `{{cloze}}` wrappers. */
	flashcards: KeepOrDrop;

	// --- Properties ---

	/**
	 * Page-level property keys (frontmatter) to exclude from output.
	 * Good defaults: Logseq-only keys that don't map to anything in Obsidian.
	 */
	dropPageProperties: string[];
	/**
	 * Inline block-property keys to strip from the note body.
	 * Keys that start with `logseq.` or `query-` are always stripped regardless.
	 */
	dropBlockProperties: string[];

	// --- Tags ---

	/** Convert `#tag` / `#[[tag]]` to `[[tag]]` wikilinks instead of keeping them as tags. */
	convertTagsToLinks: boolean;
	/**
	 * When converting tags to links, only convert tags that have a corresponding page in the
	 * graph. Tags with no matching page are kept as tags.
	 * Only applies when convertTagsToLinks is true.
	 */
	convertTagsOnlyExistingPages: boolean;
	/** Tags to remove entirely (from body text and frontmatter). */
	dropTags: string[];

	// --- Block references ---

	/** Shorten Logseq block UUIDs to Obsidian-style short anchors. */
	shortenBlockIds: boolean;
	/** Remove `((uuid))` block references that could not be resolved to a known block. */
	removeOrphanBlockRefs: boolean;

	// --- Assets ---

	/** Preserve image alt text as the wikilink display text (`![[x|alt]]`). */
	keepAssetAltText: boolean;
}

// Logseq-only page properties that have no Obsidian equivalent and are safe to drop from
// frontmatter. Users may add their own to dropPageProperties.
export const DEFAULT_DROP_PAGE_PROPERTIES = ['public', 'exclude-from-graph-view'];

// Additional block properties to strip beyond the always-dropped Logseq-internal set.
// Users may extend dropBlockProperties with their own graph-specific keys.
export const DEFAULT_DROP_BLOCK_PROPERTIES: string[] = [];

export const DEFAULT_LOGSEQ_OPTIONS: LogseqImportOptions = {
	taskFormat: 'tasks-emoji',

	useDailyNotes: true,
	journalDateFormat: 'YYYY-MM-DD',
	journalFolder: '',
	deOutlineJournals: false,

	pagesFolder: '',
	deOutlinePages: false,

	logbook: 'drop',
	queries: 'keep',
	flashcards: 'keep',

	dropPageProperties: [...DEFAULT_DROP_PAGE_PROPERTIES],
	dropBlockProperties: [...DEFAULT_DROP_BLOCK_PROPERTIES],

	convertTagsToLinks: false,
	convertTagsOnlyExistingPages: true,
	dropTags: ['card'],

	shortenBlockIds: true,
	removeOrphanBlockRefs: false,

	keepAssetAltText: false,
};
