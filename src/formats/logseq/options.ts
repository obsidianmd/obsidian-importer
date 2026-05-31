// User-configurable options for the Logseq importer. See
// docs/logseq-importer-assessment.md for the rationale behind each one.

/** How rich Logseq tasks are rendered in the Obsidian vault. */
export type TaskFormat =
	| 'plain' // native checkboxes only, metadata flattened into text
	| 'tasks-emoji' // Tasks plugin, emoji-style metadata (default)
	| 'tasks-dataview'; // Tasks plugin, Dataview inline-field metadata
// 'tasknotes' (one note per task) is a later phase and intentionally omitted for now.

/** How Logseq's outline (everything-is-a-bullet) structure is serialized. */
export type OutlineMode =
	| 'preserve' // keep blocks as bullets (lossless, default)
	| 'flatten'; // de-outline into paragraphs and headings (experimental)

/** Which note kinds the flatten transform applies to. */
export type FlattenScope = 'pages' | 'journals' | 'both';

/** Generic keep-or-drop choice for Logseq-only content. */
export type KeepOrDrop = 'keep' | 'drop';

export interface LogseqImportOptions {
	/** Task target format. */
	taskFormat: TaskFormat;

	/** Outline handling. */
	outlineMode: OutlineMode;
	/** When outlineMode is 'flatten', which note kinds to flatten. */
	flattenScope: FlattenScope;

	/** Target Obsidian daily-note filename format (moment.js tokens), e.g. 'YYYY-MM-DD'. */
	journalDateFormat: string;
	/** Vault-relative folder for imported journals (daily notes). */
	journalFolder: string;

	/** Keep or drop LOGBOOK / CLOCK time-tracking blocks. */
	logbook: KeepOrDrop;
	/** Keep (verbatim) or drop Logseq-only content: queries, flashcards, macros, templates. */
	logseqOnlyContent: KeepOrDrop;

	/** Shorten Logseq block UUIDs to Obsidian-style short anchors. */
	shortenBlockIds: boolean;

	/** Convert `#tag` / `#[[tag]]` to `[[tag]]` wikilinks instead of keeping them as tags. */
	convertTagsToLinks: boolean;
	/** Preserve image alt text as the wikilink display text (`![[x|alt]]`). */
	keepAssetAltText: boolean;
}

export const DEFAULT_LOGSEQ_OPTIONS: LogseqImportOptions = {
	taskFormat: 'tasks-emoji',
	outlineMode: 'preserve',
	flattenScope: 'pages',
	journalDateFormat: 'YYYY-MM-DD',
	journalFolder: '',
	logbook: 'drop',
	logseqOnlyContent: 'keep',
	shortenBlockIds: true,
	convertTagsToLinks: false,
	keepAssetAltText: false,
};
