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

/** A note this conversion is about to write over, if one is already there. */
export interface ExistingNote {
	absolutePath: string;
	/** When the file was last written; an earlier import set this from the source. */
	writtenAt: number;
	/** When the source says the note last changed, where it says. */
	updatedAt: number | null;
}

export type ExistingNoteDecision = 'write' | 'skip';

/**
 * What to do about a note that is already there, which is the importer's
 * business rather than the conversion's: it is the half that knows which
 * duplicate mode the user picked.
 *
 * Left unset, every import is a fresh copy and a name already taken becomes
 * "Title.1", which is what this conversion has always done.
 */
let existingNoteHandler: ((existing: ExistingNote) => ExistingNoteDecision) | null = null;

export function setExistingNoteHandler(handler: ((existing: ExistingNote) => ExistingNoteDecision) | null): void {
	existingNoteHandler = handler;
}

/**
 * Whether a note should reuse the name an earlier import gave it rather than
 * taking the next free one. Without this there is never anything to decide
 * about: the second import writes "Title.1" and no note is ever recognised.
 */
export function reusesNoteNames(): boolean {
	return existingNoteHandler !== null;
}

export function decideExistingNote(existing: ExistingNote): ExistingNoteDecision {
	return existingNoteHandler?.(existing) ?? 'write';
}

/**
 * Notes this conversion wrote, so the passes that settle links and tasks
 * afterwards can tell them from the ones it recognised and left alone. Those
 * passes read every Markdown file in the output folder, which is every note a
 * previous import wrote as well.
 */
const notesWritten = new Set<string>();

export function noteWasWritten(absolutePath: string): void {
	notesWritten.add(absolutePath);
}

export function noteWasWrittenBy(absolutePath: string): boolean {
	return notesWritten.has(absolutePath);
}

export function forgetNotesWritten(): void {
	notesWritten.clear();
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
