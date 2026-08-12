import { ImportContext, ImportLogEntry } from './import-context';
import { i18n } from './i18n';
import { describeReason } from './util';

export function outcomeText(ctx: ImportContext): string {
	return ctx.failed.length > 0 ? i18n.progress.msgErrors() : i18n.progress.msgComplete();
}

export function statusText(message: string): string {
	const trimmed = message.trim();
	if (!trimmed) return '';

	return trimmed.endsWith('.') ? trimmed : `${trimmed}...`;
}

export function pausedText(message: string): string {
	const trimmed = message.trim();
	if (!trimmed) return i18n.progress.labelPaused();

	return i18n.progress.labelPausedWith({ status: trimmed.replace(/\.+$/, '') });
}

export class ImportProgressUI extends ImportContext {
	el: HTMLElement;
	progressBarEl: HTMLElement;
	progressBarInnerEl: HTMLElement;
	importedCountEl: HTMLElement;
	attachmentCountEl: HTMLElement;
	remainingCountEl: HTMLElement;
	skippedCountEl: HTMLElement;
	failedCountEl: HTMLElement;
	statusEl: HTMLElement;
	importLogEl: HTMLElement;

	private finished: boolean = false;
	private scrollQueued: boolean = false;

	constructor(el: HTMLElement) {
		super();
		this.el = el;
		this.createProgressUI(el);
	}

	createProgressUI(container: HTMLElement) {
		container.empty();

		this.el = container;
		this.statusEl = container.createDiv('importer-status');

		this.progressBarEl = container.createDiv('importer-progress-bar', el => {
			this.progressBarInnerEl = el.createDiv('importer-progress-bar-inner');
		});

		container.createDiv('importer-stats-container', el => {
			el.createDiv('importer-stat mod-imported', el => {
				this.importedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.notes.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: i18n.progress.statImported() });
			});
			el.createDiv('importer-stat mod-attachments', el => {
				this.attachmentCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.attachments.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: i18n.progress.statAttachments() });
			});
			el.createDiv('importer-stat mod-remaining', el => {
				this.remainingCountEl = el.createDiv({ cls: 'importer-stat-count', text: '0' });
				el.createDiv({ cls: 'importer-stat-name', text: i18n.progress.statRemaining() });
			});
			el.createDiv('importer-stat mod-skipped', el => {
				this.skippedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.skipped.length.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: i18n.progress.statSkipped() });
			});
			el.createDiv('importer-stat mod-failed', el => {
				this.failedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.failed.length.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: i18n.progress.statFailed() });
			});
		});

		this.importLogEl = container.createDiv('importer-log');
		this.importLogEl.hide();

		if (this.isPaused()) this.onPaused(true);
		else this.onStatus(this.statusMessage);
		if (this.progressTotal > 0) this.onProgress(this.progressCurrent, this.progressTotal);
		if (this.log.length > 0) {
			const drawn = createFragment();
			for (const entry of this.log) this.drawLogEntry(entry, drawn);
			this.importLogEl.append(drawn);
			this.importLogEl.show();
			this.scrollLogToEnd();
		}
		if (this.finished) this.onFinish();
	}

	protected onStatus(message: string): void {
		const text = this.isPaused() ? pausedText(message) : statusText(message);
		this.statusEl.setText(text);
		this.statusEl.toggle(text.length > 0);
	}

	protected onPaused(paused: boolean): void {
		this.el.toggleClass('is-paused', paused);
		this.onStatus(this.statusMessage);
	}

	protected onNoteSuccess(): void {
		this.importedCountEl.setText(this.notes.toString());
	}

	protected onAttachmentSuccess(): void {
		this.attachmentCountEl.setText(this.attachments.toString());
	}

	protected onLogged(entry: ImportLogEntry): void {
		if (entry.outcome !== 'message') {
			const countEl = entry.outcome === 'failed' ? this.failedCountEl : this.skippedCountEl;
			countEl.setText((entry.outcome === 'failed' ? this.failed : this.skipped).length.toString());
		}

		this.drawLogEntry(entry);
		this.importLogEl.show();
		this.scrollLogToEnd();
	}

	// Progress includes skipped and failed items; onNoteSuccess updates imported count.
	protected onProgress(current: number, total: number): void {
		this.remainingCountEl.setText((total - current).toString());
		this.progressBarInnerEl.style.width = (100 * current / total).toFixed(1) + '%';
	}

	// Preserve final progress, but hide a bar that never had a total.
	protected onFinish(): void {
		this.finished = true;
		if (this.progressTotal <= 0) this.progressBarEl.hide();
	}

	// Batch scroll measurements to avoid a forced layout per log entry.
	private scrollLogToEnd(): void {
		if (this.scrollQueued) return;

		this.scrollQueued = true;
		window.requestAnimationFrame(() => {
			this.scrollQueued = false;
			this.importLogEl.scrollTop = this.importLogEl.scrollHeight;
		});
	}

	private drawLogEntry({ outcome, name, reason }: ImportLogEntry, into: Node = this.importLogEl): void {
		if (outcome === 'message') {
			into.createDiv('list-item', el => el.createSpan({ text: name }));
			return;
		}

		into.createDiv('list-item', el => {
			el.createSpan({
				cls: 'importer-error',
				text: outcome === 'failed' ? i18n.progress.labelFailed() : i18n.progress.labelSkipped(),
			});
			el.createSpan({
				text: reason
					? i18n.progress.labelEntryWithReason({ name, reason: describeReason(reason) })
					: i18n.progress.labelEntry({ name }),
			});
		});
	}
}
