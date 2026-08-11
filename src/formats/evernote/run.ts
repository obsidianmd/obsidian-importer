import { defaultEvernoteOptions, EvernoteOptions } from './options';
import { EvernoteOutput, FileTimes } from './output';
import { RuntimeProperties } from './runtime-properties';

export interface NoteDraft {
	path: string;
	markdown: string;
	times: FileTimes;
	resources: ResourceDraft[];
}

export interface ResourceDraft {
	token: string;
	fileName: string;
	data: ArrayBuffer;
	times: FileTimes;
}

/** Mutable state scoped to one import. */
export class EvernoteRun {
	readonly options: EvernoteOptions;
	readonly output: EvernoteOutput;
	readonly properties = new RuntimeProperties();

	mdPath = '';

	readonly drafts: NoteDraft[] = [];

	/** Includes skipped notes; null marks an ambiguous title. */
	private readonly plannedByTitle = new Map<string, string | null>();

	private pending: ResourceDraft[] = [];


	constructor(options: EvernoteOptions, output: EvernoteOutput) {
		this.options = { ...defaultEvernoteOptions, ...options };
		this.output = output;
	}


	notePlanned(title: string, path: string): void {
		this.plannedByTitle.set(title, this.plannedByTitle.has(title) ? null : path);
	}

	plannedNote(title: string): string | null {
		return this.plannedByTitle.get(title) ?? null;
	}

	draftNote(draft: Omit<NoteDraft, 'resources'>): void {
		this.drafts.push({ ...draft, resources: this.pending });
		this.pending = [];
	}

	draftResource(fileName: string, data: ArrayBuffer, times: FileTimes): string {
		const token = `ENEX-ATTACHMENT-${this.pending.length}-`;
		this.pending.push({ token, fileName, data, times });

		return token;
	}

	forgetPendingResources(): void {
		this.pending = [];
	}


}
