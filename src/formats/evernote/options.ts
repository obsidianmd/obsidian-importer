import { PickedFile } from '../../filesystem';
import { TagSeparatorReplaceOptions } from './models';
import type { MarkdownOutput } from '../../markdown-output';

/** Set by the importer, because these writes never reach createMarkdown. */
let markdownOutput: MarkdownOutput = { indentUnit: '    ' };
let markdownTracker: ((absolutePath: string) => void) | null = null;

export function setMarkdownOutput(output: MarkdownOutput): void {
	markdownOutput = output;
}

export function getMarkdownOutput(): MarkdownOutput {
	return markdownOutput;
}

export function setMarkdownTracker(tracker: ((absolutePath: string) => void) | null): void {
	markdownTracker = tracker;
}

export function trackMarkdownWrite(absolutePath: string): void {
	markdownTracker?.(absolutePath);
}

export interface EvernoteOptions {
	enexSources: PickedFile[];
	templateFile?: string;
	currentTemplate: string;
	outputDir: string;
	isMetadataNeeded?: boolean;
	isNotebookNameNeeded?: boolean;
	isZettelkastenNeeded?: boolean;
	useZettelIdAsFilename?: boolean;
	plainTextNotesOnly?: boolean;
	skipLocation?: boolean;
	skipCreationTime?: boolean;
	skipUpdateTime?: boolean;
	skipSourceUrl?: boolean;
	skipWebClips?: boolean;
	skipReminderTime?: boolean;
	skipReminderOrder?: boolean;
	skipReminderDoneTime?: boolean;
	skipTags?: boolean;
	useHashTags?: boolean;
	replaceWhitespacesInTagsByUnderscore?: boolean;
	skipEnexFileNameFromOutputPath?: boolean;
	haveEnexLevelResources?: boolean;
	haveGlobalResources?: boolean;
	keepMDCharactersOfENNotes?: boolean;
	urlEncodeFileNamesAndLinks?: boolean;
	sanitizeResourceNameSpaces?: boolean;
	replacementChar: string;
	monospaceIsCodeBlock?: boolean;
	dateFormat?: string;
	nestedTags?: TagSeparatorReplaceOptions;
	keepImageSize?: boolean;
	keepOriginalAmountOfNewlines?: boolean;
	generateNakedUrls?: boolean;
	addExtensionToInternalLinks?: boolean;
	pathSeparator?: string;
	resourcesDir: string;
	turndownOptions?: Record<string, string | boolean>;
	obsidianTaskTag?: string;
	useUniqueUnknownFileNames?: boolean;
}
