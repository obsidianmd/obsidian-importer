import { PickedFile } from '../../filesystem';
import { TagSeparatorReplaceOptions } from './models';
import type { MarkdownOutput } from '../../markdown-output';

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

export interface ExistingNote {
	absolutePath: string;
	writtenAt: number;
	updatedAt: number | null;
}

export type ExistingNoteDecision = 'write' | 'skip';

let existingNoteHandler: ((existing: ExistingNote) => ExistingNoteDecision) | null = null;

export function setExistingNoteHandler(handler: ((existing: ExistingNote) => ExistingNoteDecision) | null): void {
	existingNoteHandler = handler;
}

export function reusesNoteNames(): boolean {
	return existingNoteHandler !== null;
}

export function decideExistingNote(existing: ExistingNote): ExistingNoteDecision {
	return existingNoteHandler?.(existing) ?? 'write';
}

/** Notes eligible for post-processing in this run. */
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
	outputDir: string;
	skipWebClips?: boolean;
	useHashTags?: boolean;
	dateFormat?: string;
	nestedTags?: TagSeparatorReplaceOptions;
	resourcesDir: string;
	turndownOptions?: Record<string, string | boolean>;
	obsidianTaskTag?: string;
}
