/**
 * What an import reports as it runs: what it wrote, what it skipped, and how
 * far along it is.
 *
 * This holds the counts and nothing else. Showing them is ImportProgressUI's
 * job, which is what the dialog uses - an import driven from a script or a test
 * reports into this and draws nothing.
 *
 * It lives here rather than in main.ts so that reaching it does not mean
 * loading the plugin, the dialog, and all fourteen importers with it. Every
 * importer takes one of these, so anything that wants to drive a conversion -
 * a test, most of all - needs it without needing Obsidian.
 */
export class ImportContext {
	notes = 0;
	attachments = 0;
	skipped: string[] = [];
	failed: string[] = [];
	maxFileNameLength: number = 100;
	statusMessage: string = '';

	cancelled: boolean = false;

	private paused: boolean = false;

	/** Waiting at a checkpoint for the pause to be lifted. */
	private waiting: (() => void)[] = [];

	/**
	 * How many checkpoints the import has reached, which is what the dialog
	 * checks its promise of Pause and Stop against. Only shouldStop() counts:
	 * isCancelled() is read by the dialog itself, so counting it would say yes
	 * about every import whether or not the importer ever asked.
	 */
	checkpoints: number = 0;

	/** Latest reportProgress, for a progress bar drawn outside the dialog. */
	progressCurrent: number = 0;
	progressTotal: number = 0;

	/**
	 * Sets the current user visible in-progress task. The purpose is to tell the user that something is happening,
	 * and makes it easy to tell if something got stuck.
	 *
	 * Try to keep the message short, since longer ones will get truncated based on font and space availability.
	 * @param message
	 */
	status(message: string) {
		this.statusMessage = message;
		this.onStatus(message);
	}

	/**
	 * Report that a note has been successfully imported.
	 * @param name
	 */
	reportNoteSuccess(name: string) {
		this.notes++;
		this.onNoteSuccess(name);
	}

	/**
	 * Report that an attachment has been successfully imported.
	 * @param name
	 */
	reportAttachmentSuccess(name: string) {
		this.attachments++;
		this.onAttachmentSuccess(name);
	}

	/**
	 * Report that something has been skipped and ignored.
	 * If the skipping action is on purpose and expected for the import, then prefer not to report it
	 * (for example, some tools export to a Note.json and a Note.html, and we only use one of them).
	 * @param name
	 * @param reason
	 */
	reportSkipped(name: string, reason?: unknown) {
		this.skipped.push(name);
		this.onSkipped(name, reason);
	}

	/**
	 * Report that something has failed to import.
	 * @param name
	 * @param reason
	 */
	reportFailed(name: string, reason?: unknown) {
		this.failed.push(name);
		console.error('Import failed', name, reason);
		this.onFailed(name, reason);
	}

	/**
	 * Report the current progress. This will update the progress bar as well as changing
	 * the "imported" and "remaining" numbers on the UI.
	 * @param current
	 * @param total
	 */
	reportProgress(current: number, total: number) {
		if (total <= 0) return;
		// Kept, not just handed on: anything drawing this outside the dialog -
		// the notice shown while the dialog is hidden - has no other way to ask
		this.progressCurrent = current;
		this.progressTotal = total;
		this.onProgress(current, total);
	}

	cancel() {
		this.cancelled = true;
		// A paused import has to be able to stop, so whatever is waiting at a
		// checkpoint is let go to find that it should
		this.resume();
		this.hideStatus();
	}

	/**
	 * Hold the import at its next checkpoint.
	 *
	 * Whatever it is in the middle of finishes: a note being written is written,
	 * a request already sent is waited for. What stops is the work after that.
	 */
	pause() {
		if (this.paused || this.cancelled) return;
		this.paused = true;
		this.onPaused(true);
	}

	/** Let a paused import go on from the checkpoint it is waiting at. */
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

	hideStatus() {
		this.onHideStatus();
	}

	/**
	 * Check if the user has cancelled this run.
	 *
	 * Where the caller can wait - which is anywhere it can await - shouldStop()
	 * answers the same question and honours a pause as well.
	 */
	isCancelled() {
		return this.cancelled;
	}

	/**
	 * A point the import can be stopped or held at: waits while it is paused,
	 * then says whether to stop.
	 *
	 * This is what an importer's loop asks between one item and the next. How
	 * often it asks is how responsive Pause and Stop are, and an importer that
	 * never asks can be neither.
	 */
	async shouldStop(): Promise<boolean> {
		this.checkpoints++;

		while (this.paused && !this.cancelled) {
			await new Promise<void>(wake => this.waiting.push(wake));
		}

		return this.cancelled;
	}

	/* Where a subclass draws what the import is doing. Nothing here does. */
	protected onStatus(message: string): void {}
	protected onNoteSuccess(name: string): void {}
	protected onAttachmentSuccess(name: string): void {}
	protected onSkipped(name: string, reason?: unknown): void {}
	protected onFailed(name: string, reason?: unknown): void {}
	protected onProgress(current: number, total: number): void {}
	protected onHideStatus(): void {}
	protected onPaused(paused: boolean): void {}
}
