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
	times: FileTimes;
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
	readonly properties = new RuntimeProperties();

	/** The folder the notebook being converted right now is going into. */
	mdPath = '';

	/** Every note this run will write, in the order they were converted. */
	readonly drafts: NoteDraft[] = [];

	/**
	 * Where each note of a given title landed, whether or not it is being
	 * written. A link resolves against this rather than against the drafts: a
	 * note the import is leaving alone is still a note a link can point at, and
	 * still one that makes a title ambiguous when two notes share it.
	 */
	private readonly plannedByTitle = new Map<string, string | null>();

	/** The attachments of the note being converted, until it has one to go on. */
	private pending: ResourceDraft[] = [];


	constructor(options: EvernoteOptions, output: EvernoteOutput) {
		this.options = { ...defaultEvernoteOptions, ...options };
		this.output = output;
	}


	/** Remember where a note of this title goes, written or not. */
	notePlanned(title: string, path: string): void {
		this.plannedByTitle.set(title, this.plannedByTitle.has(title) ? null : path);
	}

	/** Where the one note of this title is, or nothing if it is not the one. */
	plannedNote(title: string): string | null {
		return this.plannedByTitle.get(title) ?? null;
	}

	draftNote(draft: Omit<NoteDraft, 'resources'>): void {
		this.drafts.push({ ...draft, resources: this.pending });
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


}
