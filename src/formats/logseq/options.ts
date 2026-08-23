export type TaskFormat =
	| 'plain' // native checkboxes only, metadata flattened into text
	| 'tasks-emoji' // Tasks plugin, emoji-style metadata (default)
	| 'tasks-dataview'; // Tasks plugin, Dataview inline-field metadata

export type KeepOrDrop = 'keep' | 'drop';

export type BlockPropertyMode = 'keep' | 'wrap' | 'drop';

export interface LogseqImportOptions {
	taskFormat: TaskFormat;

	/** Use the Daily Notes folder and date format. */
	useDailyNotes: boolean;
	journalDateFormat: string;
	journalFolder: string;
	deOutlineJournals: boolean;

	pagesFolder: string;
	deOutlinePages: boolean;

	logbook: KeepOrDrop;
	queries: KeepOrDrop;
	flashcards: KeepOrDrop;

	dropPageProperties: string[];
	/** Extra block-property keys to strip; Logseq-internal keys are always stripped. */
	dropBlockProperties: string[];
	/** Keep, wrap as a Dataview field, or drop unknown block properties. */
	blockProperties: BlockPropertyMode;
	/** Convert kebab-case page-property keys to snake_case. */
	snakeCasePageProperties: boolean;
	/** Convert kebab-case block-property keys to snake_case. */
	snakeCaseBlockProperties: boolean;

	convertTagsToLinks: boolean;
	/** Leave tags without a matching page as tags. */
	convertTagsOnlyExistingPages: boolean;
	dropTags: string[];

	shortenBlockIds: boolean;
	removeOrphanBlockRefs: boolean;
	/** Embed bare block references; explicit block embeds are always embedded. */
	alwaysEmbedBlockRefs: boolean;

	keepAssetAltText: boolean;

	/** Normalize whitespace and remove empty bullets. */
	normalizeWhitespace: boolean;
}

export const DEFAULT_DROP_PAGE_PROPERTIES = ['public', 'exclude-from-graph-view', 'icon'];

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
	blockProperties: 'wrap',
	snakeCasePageProperties: false,
	snakeCaseBlockProperties: false,

	convertTagsToLinks: false,
	convertTagsOnlyExistingPages: true,
	dropTags: ['card'],

	shortenBlockIds: true,
	removeOrphanBlockRefs: false,
	alwaysEmbedBlockRefs: false,

	keepAssetAltText: false,

	normalizeWhitespace: true,
};
