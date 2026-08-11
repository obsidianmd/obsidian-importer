import type { MarkdownOutput } from '../../markdown-output';
import { defaultEvernoteOptions, EvernoteOptions, ExistingNote, ExistingNoteDecision } from './options';
import { RuntimeProperties } from './runtime-properties';

export interface NotebookPaths {
	mdPath: string;
	resourcePath: string;
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

	/** Notes eligible for post-processing in this run. */
	private readonly notesWritten = new Set<string>();

	constructor(options: EvernoteOptions) {
		this.options = { ...defaultEvernoteOptions, ...options };
		this.markdownOutput = this.options.markdownOutput ?? { indentUnit: '    ' };
	}

	noteWasWritten(absolutePath: string): void {
		this.notesWritten.add(absolutePath);
	}

	noteWasWrittenBy(absolutePath: string): boolean {
		return this.notesWritten.has(absolutePath);
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
