export interface ImportLogEntry {
	outcome: 'skipped' | 'failed';
	name: string;
	reason?: unknown;
}

export class ImportContext {
	notes = 0;
	attachments = 0;
	skipped: string[] = [];
	failed: string[] = [];

	log: ImportLogEntry[] = [];

	statusMessage: string = '';

	cancelled: boolean = false;

	private paused: boolean = false;

	private waiting: (() => void)[] = [];

	checkpoints: number = 0;

	progressCurrent: number = 0;
	progressTotal: number = 0;

	status(message: string) {
		this.statusMessage = message;
		this.onStatus(message);
	}

	reportNoteSuccess(name: string) {
		this.notes++;
		this.onNoteSuccess(name);
	}

	reportAttachmentSuccess(name: string) {
		this.attachments++;
		this.onAttachmentSuccess(name);
	}

	reportSkipped(name: string, reason?: unknown) {
		const entry: ImportLogEntry = { outcome: 'skipped', name, reason };
		this.skipped.push(name);
		this.log.push(entry);
		this.onLogged(entry);
	}

	reportFailed(name: string, reason?: unknown) {
		const entry: ImportLogEntry = { outcome: 'failed', name, reason };
		this.failed.push(name);
		this.log.push(entry);
		console.error('Import failed', name, reason);
		this.onLogged(entry);
	}

	reportProgress(current: number, total: number) {
		if (total <= 0) return;
		this.progressCurrent = current;
		this.progressTotal = total;
		this.onProgress(current, total);
	}

	cancel() {
		this.cancelled = true;
		// Wake a paused import so it can observe cancellation.
		this.resume();
	}

	pause() {
		if (this.paused || this.cancelled) return;
		this.paused = true;
		this.onPaused(true);
	}

	resume() {
		if (!this.paused) return;
		this.paused = false;

		const waiting = this.waiting;
		this.waiting = [];
		for (const wake of waiting) wake();

		this.onPaused(false);
	}

	isPaused() {
		return this.paused;
	}

	finish() {
		this.onFinish();
	}

	isCancelled() {
		return this.cancelled;
	}

	async shouldStop(): Promise<boolean> {
		this.checkpoints++;

		// Imports pause only between items, at explicit checkpoints.
		while (this.paused && !this.cancelled) {
			await new Promise<void>(wake => this.waiting.push(wake));
		}

		return this.cancelled;
	}

	protected onStatus(message: string): void {}
	protected onNoteSuccess(name: string): void {}
	protected onAttachmentSuccess(name: string): void {}
	/** One thing that did not come through, as it was recorded. */
	protected onLogged(entry: ImportLogEntry): void {}
	protected onProgress(current: number, total: number): void {}
	protected onFinish(): void {}
	protected onPaused(paused: boolean): void {}
}
