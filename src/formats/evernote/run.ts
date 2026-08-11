import type { MarkdownOutput } from '../../markdown-output';
import { EvernoteNote } from './models/EvernoteNote';
import { defaultEvernoteOptions, EvernoteOptions } from './options';
import { EvernoteOutput, FileTimes } from './output';
import { RuntimeProperties } from './runtime-properties';

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
	/** The attachments it carries, in the order they were decoded. */
	resources: ResourceDraft[];
}

/**
 * An attachment decoded out of a note, waiting for the import to be committed.
 *
 * The markdown carries the token where the link belongs. Where the file
 * actually goes is the output's decision, and is not made until every note is
 * converted - so the conversion says which attachment, not which path.
 */
export interface ResourceDraft {
	token: string;
	fileName: string;
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
	readonly paths = { mdPath: '' };

	/** Every note this run will write, in the order they were converted. */
	readonly drafts: NoteDraft[] = [];

	/** The attachments of the note being converted, until it has one to go on. */
	private pending: ResourceDraft[] = [];

	/** The paths this run has taken, so nothing else in it is given one twice. */
	private readonly claimedPaths = new Set<string>();

	constructor(options: EvernoteOptions, output: EvernoteOutput) {
		this.options = { ...defaultEvernoteOptions, ...options };
		this.output = output;
		this.markdownOutput = this.options.markdownOutput ?? { indentUnit: '    ' };
	}

	/** Hold a path, so nothing else in this run is given it. */
	claim(path: string): void {
		this.claimedPaths.add(path);
	}

	draftNote(path: string, markdown: string, note: EvernoteNote): void {
		this.claim(path);
		this.drafts.push({ path, markdown, note, resources: this.pending });
		this.pending = [];
	}

	/** Hold on to an attachment, and answer with what the markdown should say. */
	draftResource(fileName: string, data: ArrayBuffer, times: FileTimes): string {
		const token = `ENEX-ATTACHMENT-${this.pending.length}-`;
		this.pending.push({ token, fileName, data, times });

		return token;
	}

	/** Let go of the attachments of a note that turned out not to be imported. */
	forgetPendingResources(): void {
		this.pending = [];
	}

	/** Whether anything - this run or an earlier import - is at this path. */
	taken(path: string): boolean {
		return this.claimedPaths.has(path) || this.output.exists(path);
	}

}
