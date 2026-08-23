export type KeepOrDrop = 'keep' | 'drop';
export type BlockPropertyMode = KeepOrDrop;

export interface LogseqImportOptions {
	useDailyNotes: boolean;
	flattenOutlines: boolean;
	queries: boolean;
	flashcards: boolean;
	timeTracking: boolean;
}

export const DEFAULT_DROP_PAGE_PROPERTIES = ['public', 'exclude-from-graph-view', 'icon'];

export const DEFAULT_LOGSEQ_OPTIONS: LogseqImportOptions = {
	useDailyNotes: true,
	flattenOutlines: false,
	queries: true,
	flashcards: true,
	timeTracking: false,
};
