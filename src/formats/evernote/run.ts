import type { MarkdownOutput } from '../../markdown-output';
import { EvernoteNote } from './models/EvernoteNote';
import { defaultEvernoteOptions, EvernoteOptions, ExistingNote, ExistingNoteDecision } from './options';
import { EvernoteOutput, FileTimes } from './output';
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

/** An attachment decoded out of a note, waiting for the enex to finish. */
export interface ResourceDraft {
	path: string;
	data: ArrayBuffer;
	times: FileTimes;
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
	readonly output: EvernoteOutput;
	readonly markdownOutput: MarkdownOutput;
	readonly properties = new RuntimeProperties();

	/** Where the notebook being converted right now is going. */
	readonly paths: NotebookPaths = { mdPath: '', resourcePath: '' };

	/** Every note this run will write, in the order they were converted. */
	readonly drafts: NoteDraft[] = [];

	/** Attachments waiting to be written, emptied once each enex has been read. */
	readonly resources: ResourceDraft[] = [];

	/** Resource folders to be taken down before anything is written into them. */
	readonly foldersToEmpty = new Set<string>();

	/** When each path was taken, which is what something arriving at it later asks. */
	private readonly claimedPaths = new Map<string, number>();

	constructor(options: EvernoteOptions, output: EvernoteOutput) {
		this.options = { ...defaultEvernoteOptions, ...options };
		this.output = output;
		this.markdownOutput = this.options.markdownOutput ?? { indentUnit: '    ' };
	}

	/** Hold a path, so nothing else in this run is given it. */
	claim(path: string): void {
		this.claimedPaths.set(path, Date.now());
	}

	draftNote(path: string, markdown: string, note: EvernoteNote): void {
		this.claim(path);
		this.drafts.push({ path, markdown, note });
	}

	draftResource(path: string, data: ArrayBuffer, times: FileTimes): void {
		this.claim(path);
		this.resources.push({ path, data, times });
	}

	/** Empty this folder before the import writes into it. */
	emptyBeforeWriting(folder: string): void {
		this.foldersToEmpty.add(folder);
	}

	/** When this run took the path, or null if it has not. */
	claimedAt(path: string): number | null {
		return this.claimedPaths.get(path) ?? null;
	}

	/** Whether anything - this run or an earlier import - is at this path. */
	taken(path: string): boolean {
		if (this.claimedPaths.has(path)) return true;

		return !this.emptied(parentOf(path)) && this.output.exists(path);
	}

	/**
	 * What is directly inside a folder, counting what this run has taken there.
	 *
	 * A folder this import is about to empty answers with its claims alone: what
	 * was in it is on its way out, and a name in it is free to be used again.
	 */
	namesIn(folder: string): string[] {
		const prefix = `${folder}/`;
		const claimed = [...this.claimedPaths.keys()]
			.filter(claimed => claimed.startsWith(prefix) && !claimed.slice(prefix.length).includes('/'))
			.map(claimed => claimed.slice(prefix.length));

		return this.emptied(folder) ? claimed : [...this.output.list(folder), ...claimed];
	}

	private emptied(folder: string): boolean {
		return this.foldersToEmpty.has(folder);
	}

	/** Whether a note may take the name an earlier import gave it. */
	reusesNoteNames(): boolean {
		return this.options.decideExistingNote !== undefined;
	}

	decideExistingNote(existing: ExistingNote): ExistingNoteDecision {
		return this.options.decideExistingNote?.(existing) ?? 'write';
	}
}

function parentOf(path: string): string {
	return path.slice(0, path.lastIndexOf('/'));
}
