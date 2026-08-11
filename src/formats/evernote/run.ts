import type { MarkdownOutput } from '../../markdown-output';
import { EvernoteNote } from './models/EvernoteNote';
import { defaultEvernoteOptions, EvernoteOptions, ExistingNote, ExistingNoteDecision } from './options';
import { RuntimeProperties } from './runtime-properties';

export interface NotebookPaths {
	mdPath: string;
	resourcePath: string;
}

/**
 * A note that has been converted but not yet written.
 *
 * Its path is settled - and taken, so the next note of the same title is
 * numbered past it - while its markdown is still open to the task groups and
 * the links that are only resolvable once the whole import has been read.
 */
export interface NoteDraft {
	path: string;
	markdown: string;
	/** What the note's timestamps are set from when it is written. */
	note: EvernoteNote;
}

/**
 * What one import has to remember, and nothing that outlives it.
 *
 * All of this used to be module state - a singleton, a mutable exported
 * options object, a set of paths - in a plugin that runs an import whenever
 * the user asks for one. The second import saw what the first had left.
 */
export class EvernoteRun {
	readonly options: EvernoteOptions;
	readonly markdownOutput: MarkdownOutput;
	readonly properties = new RuntimeProperties();

	/** Where the notebook being converted right now is going. */
	readonly paths: NotebookPaths = { mdPath: '', resourcePath: '' };

	/** Every note this run will write, in the order they were converted. */
	readonly drafts: NoteDraft[] = [];

	/** When each path was taken, which is what a note arriving at it later asks. */
	private readonly claimedPaths = new Map<string, number>();

	constructor(options: EvernoteOptions) {
		this.options = { ...defaultEvernoteOptions, ...options };
		this.markdownOutput = this.options.markdownOutput ?? { indentUnit: '    ' };
	}

	draftNote(path: string, markdown: string, note: EvernoteNote): void {
		this.claimedPaths.set(path, Date.now());
		this.drafts.push({ path, markdown, note });
	}

	/** When this run took the path, or null if it has not. */
	draftedAt(path: string): number | null {
		return this.claimedPaths.get(path) ?? null;
	}

	/** The names this run has taken directly inside a folder. */
	claimedIn(folder: string): string[] {
		const prefix = `${folder}/`;

		return [...this.claimedPaths.keys()]
			.filter(claimed => claimed.startsWith(prefix) && !claimed.slice(prefix.length).includes('/'))
			.map(claimed => claimed.slice(prefix.length));
	}

	trackMarkdownWrite(absolutePath: string): void {
		this.options.trackMarkdown?.(absolutePath);
	}

	/** Whether a note may take the name an earlier import gave it. */
	reusesNoteNames(): boolean {
		return this.options.decideExistingNote !== undefined;
	}

	decideExistingNote(existing: ExistingNote): ExistingNoteDecision {
		return this.options.decideExistingNote?.(existing) ?? 'write';
	}
}
