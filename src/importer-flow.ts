import { App, Notice, prepareFuzzySearch, renderMatches, SearchComponent, SearchResult, Setting, setIcon, TFile } from 'obsidian';
import { FormatImporter, ImporterHost } from './format-importer';
import { dataTransferHasFiles, droppedItems, expandDropped, PickedFile, PickedFolder } from './filesystem';
import { ImporterFileTypes, importersForFiles, readableFiles } from './importer-match';
import { helpUrl } from './constants';
import { ImportContext } from './import-context';
import {
	FALLBACK_ICONS,
	groupHelpPermalink,
	groupName,
	groupOf,
	IMPORTER_GROUPS,
	importerName,
	importerOptionText,
} from './importers';
import { ImportProgressUI, outcomeText, pausedText, statusText } from './progress-ui';
import { i18n } from './i18n';
import type ImporterPlugin from './main';

const COPY_FILES = 'files';

interface Drop {
	items: (PickedFile | PickedFolder)[];
	files: PickedFile[];
	exports: PickedFile[];
}

/**
 * What the flow needs from whatever is showing it: a modal has a title bar and
 * closes, a setting tab has a heading and a window of its own to close.
 */
export interface ImporterShell {
	/** Where a screen is drawn. The flow empties it between screens. */
	readonly contentEl: HTMLElement;
	/** What the drop overlay covers, and the window a file is dropped into. */
	readonly containerEl: HTMLElement;
	setTitle(title: string): void;
	/** The format list fills the shell; every other screen ends in a button bar. */
	setPickingFormat(picking: boolean): void;
	/** Done: the modal closes, the setting tab closes the settings window. */
	finish(): void;
	/** Show a shell the user has left, to return to the import in it. */
	foreground(): void;
}

/**
 * The import flow: pick a format, choose a source, choose where it lands, watch
 * it run. Everything a shell has no opinion about lives here, so the modal and
 * the setting tab are the same screens shown in two places.
 */
export class ImporterFlow implements ImporterHost {
	app: App;
	plugin: ImporterPlugin;
	shell: ImporterShell;

	importer: FormatImporter;
	selectedId: string;
	abortController: AbortController;

	sourceEl: HTMLElement | null = null;
	outputEl: HTMLElement | null = null;
	optionsEl: HTMLElement | null = null;

	current: ImportContext | null = null;

	private nextButtonEl: HTMLButtonElement | null = null;

	private pickingFormat: boolean = false;

	private dropOverlayEl: HTMLElement | null = null;
	private dropWin: Window | null = null;

	private hidden: boolean = false;
	private hiddenNotice: Notice | null = null;
	private hiddenInterval: number | null = null;

	private reportFile: TFile | null = null;

	/** The screen showing now, so a shell that was taken away can draw it again. */
	private drawCurrent: () => void = () => this.showFormatPicker();

	get importerId(): string {
		return this.selectedId;
	}

	get importing(): boolean {
		return this.current !== null;
	}

	get isHidden(): boolean {
		return this.hidden;
	}

	constructor(app: App, plugin: ImporterPlugin, shell: ImporterShell) {
		this.app = app;
		this.plugin = plugin;
		this.shell = shell;
		this.abortController = new AbortController();
	}

	/** The shell is on screen: draw where the flow got to, and catch drops. */
	attach(): void {
		this.hidden = false;
		this.clearHiddenNotice();
		this.catchFileDrop(this.shell.containerEl.win);
		this.drawCurrent();
	}

	/**
	 * The shell has gone away. An import already running carries on with only
	 * the notice to report it, and clicking that notice brings the shell back.
	 */
	detach(): void {
		this.hideDropOverlay();
		this.forgetFileDrop();

		if (!this.current) return;

		this.hidden = true;
		this.showHiddenNotice();
	}

	/** The shell is gone for good, and takes the import with it. */
	dispose(): void {
		this.hideDropOverlay();
		this.forgetFileDrop();
		this.abortController.abort('import was canceled by user');
		this.clearHiddenNotice();
		this.hidden = false;
		this.current?.cancel();
	}

	showFormatPicker() {
		const { contentEl } = this.shell;
		this.drawCurrent = () => this.showFormatPicker();
		contentEl.empty();
		this.pickingFormat = true;
		this.shell.setPickingFormat(true);
		this.shell.setTitle(i18n.modal.titlePickFormat());

		const groupEl = contentEl.createDiv('setting-group mod-list');
		const searchEl = groupEl.createDiv('setting-group-search');
		const itemsEl = groupEl.createDiv('setting-items');

		let rows: HTMLElement[] = [];

		const focusRow = (index: number) => {
			if (index < 0 || rows.length === 0) search.inputEl.focus();
			else rows[Math.min(index, rows.length - 1)].focus();
		};

		const draw = (query: string) => {
			itemsEl.empty();
			rows = [];

			for (const [id, match] of this.searchFormats(query)) {
				const optionText = this.rowText(id);

				this.addFormatRow(itemsEl, rows, id, () => this.chooseRow(id), focusRow)
					.setName(createFragment(frag => {
						if (match) renderMatches(frag, optionText, match.matches);
						else frag.appendText(optionText);
					}));
			}

			if (rows.length === 0) {
				new Setting(itemsEl).setClass('mod-empty-state').setName(i18n.modal.msgNoFormats());
			}
		};

		const search = new SearchComponent(searchEl)
			.setPlaceholder(i18n.modal.searchPlaceholder())
			.onChange(value => draw(value));

		search.inputEl.addEventListener('keydown', evt => {
			if (evt.key !== 'ArrowDown' && evt.key !== 'Enter') return;
			evt.preventDefault();

			if (evt.key === 'Enter') rows[0]?.click();
			else focusRow(0);
		});

		draw('');
		search.inputEl.focus();
	}

	private addNavigableRow(
		itemsEl: HTMLElement,
		rows: HTMLElement[],
		choose: () => void,
		focus: (index: number) => void = index => rows[Math.min(Math.max(index, 0), rows.length - 1)]?.focus(),
	): Setting {
		const setting = new Setting(itemsEl).setClass('mod-navigable');
		const { settingEl } = setting;
		const index = rows.length;

		settingEl.tabIndex = 0;
		settingEl.addEventListener('click', choose);
		settingEl.addEventListener('keydown', evt => {
			switch (evt.key) {
				case 'Enter':
				case ' ':
					choose();
					break;
				case 'ArrowDown':
					focus(index + 1);
					break;
				case 'ArrowUp':
					focus(index - 1);
					break;
				default:
					return;
			}

			evt.preventDefault();
		});

		rows.push(settingEl);
		return setting;
	}

	private addFormatRow(
		itemsEl: HTMLElement,
		rows: HTMLElement[],
		id: string,
		choose: () => void,
		focus?: (index: number) => void,
	): Setting {
		const setting = this.addNavigableRow(itemsEl, rows, choose, focus);

		const iconEl = createDiv(`setting-item-icon importer-app-icon mod-${id}`);
		if (FALLBACK_ICONS[id]) setIcon(iconEl, FALLBACK_ICONS[id]);
		setting.settingEl.prepend(iconEl);

		setIcon(setting.controlEl.createSpan('importer-format-chevron'), 'lucide-chevron-right');

		return setting;
	}

	private pickableIds(): string[] {
		const offered: string[] = [];

		for (const [id, definition] of Object.entries(this.plugin.importers)) {
			if (definition.hidden) continue;

			const group = groupOf(id);
			const entry = group ?? id;
			if (!offered.includes(entry)) offered.push(entry);
		}

		return offered;
	}

	private rowText(id: string): string {
		return id in IMPORTER_GROUPS ? groupName(id) : importerOptionText(id);
	}

	private searchFormats(query: string): [string, SearchResult | null][] {
		const ids = this.pickableIds();

		if (!query) return ids.map(id => [id, null]);

		const search = prepareFuzzySearch(query);
		const results: { id: string, match: SearchResult | null, score: number }[] = [];

		for (const id of ids) {
			const match = search(this.rowText(id));

			// Match group rows against each import method too.
			const searchable = id in IMPORTER_GROUPS
				? IMPORTER_GROUPS[id].flatMap(member => [importerName(member), importerOptionText(member)])
				: [importerName(id)];

			const best = Math.max(match?.score ?? -Infinity, ...searchable.map(text => search(text)?.score ?? -Infinity));
			if (best === -Infinity) continue;

			results.push({ id, match, score: best });
		}

		results.sort((a, b) => b.score - a.score);
		return results.map(({ id, match }) => [id, match]);
	}

	private chooseRow(id: string): void {
		if (id in IMPORTER_GROUPS) this.showMethodPicker(id);
		else this.selectFormat(id);
	}

	private showMethodPicker(group: string): void {
		const { contentEl } = this.shell;

		this.drawCurrent = () => this.showMethodPicker(group);
		contentEl.empty();
		this.nextButtonEl = null;
		this.pickingFormat = true;
		this.shell.setPickingFormat(false);
		this.shell.setTitle(i18n.modal.titleChooseMethod());

		const itemsEl = contentEl.createDiv('setting-group mod-list').createDiv('setting-items');
		const rows: HTMLElement[] = [];

		for (const member of IMPORTER_GROUPS[group]) {
			if (!Object.prototype.hasOwnProperty.call(this.plugin.importers, member)) continue;

			const setting = this.addNavigableRow(itemsEl, rows, () => this.selectFormat(member))
				.setName(i18n.importer(`${member}.method-name`))
				.setDesc(i18n.importer(`${member}.method-desc`));

			setIcon(setting.controlEl.createSpan('importer-format-chevron'), 'lucide-chevron-right');
		}

		contentEl.createDiv('modal-button-container importer-step-buttons', el => {
			el.createEl('button', { text: i18n.modal.buttonBack() }, el => {
				el.addEventListener('click', () => this.showFormatPicker());
			});

			const permalink = groupHelpPermalink(this.plugin.importers, group);
			if (permalink) {
				el.createEl('button', { text: i18n.modal.buttonHelp() }, el => {
					el.addEventListener('click', () => window.open(helpUrl(permalink)));
				});
			}
		});

		rows[0]?.focus();
	}

	selectFormat(id: string) {
		if (!Object.prototype.hasOwnProperty.call(this.plugin.importers, id)) return;

		if (id === this.selectedId && this.importer) {
			this.showFirstStep();
			return;
		}

		this.selectedId = id;
		this.setUpImporter();
	}

	private showPreviousScreen(): void {
		const group = groupOf(this.selectedId);
		if (group) this.showMethodPicker(group);
		else this.showFormatPicker();
	}

	private setUpImporter() {
		const definition = this.plugin.importers[this.selectedId];

		this.sourceEl = createDiv();
		this.outputEl = createDiv();
		this.optionsEl = createDiv();

		this.importer = new definition.importer(this.app, this);

		this.showFirstStep();
	}

	private showFirstStep() {
		if (this.importer.notAvailable) {
			this.drawStep(this.optionsEl, () => this.showPreviousScreen(), () => {});
			return;
		}

		this.showSourceStep();
	}

	private hasOptionsStep(): boolean {
		return (this.optionsEl?.childElementCount ?? 0) > 0;
	}

	showSourceStep() {
		this.drawCurrent = () => this.showSourceStep();
		this.drawStep(this.sourceEl, () => this.showPreviousScreen(), el => {
			this.nextButtonEl = el.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonContinue() }, el => {
				el.addEventListener('click', () => void this.showOutputStep());
			});

			this.sourceChanged();
		});
	}

	sourceChanged(): void {
		if (this.nextButtonEl) this.nextButtonEl.disabled = !this.importer.sourceReady;
	}

	async showOutputStep() {
		const { importer } = this;

		this.drawCurrent = () => void this.showOutputStep();

		await importer.ready;
		importer.drawOutputStep();

		this.drawStep(this.outputEl, () => this.showSourceStep(), el => {
			if (this.hasOptionsStep()) {
				el.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonContinue() }, el => {
					el.addEventListener('click', () => this.showOptionsStep());
				});
				return;
			}

			this.addImportButton(el, importer);
		});
	}

	showOptionsStep() {
		const { importer } = this;

		this.drawCurrent = () => this.showOptionsStep();
		this.drawStep(this.optionsEl, () => void this.showOutputStep(), el => {
			this.addImportButton(el, importer);
		});
	}

	private addImportButton(buttonsEl: HTMLElement, importer: FormatImporter) {
		buttonsEl.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonImport() }, el => {
			el.addEventListener('click', () => void this.startImport(importer)
				.catch(e => console.error('Import failed', e)));
		});
	}

	private showFormatOffer(ids: string[], drop: Drop) {
		const { contentEl } = this.shell;

		const back = this.pickingFormat || !this.importer
			? () => this.startOver()
			: () => this.showFirstStep();

		this.drawCurrent = () => this.showFormatOffer(ids, drop);
		contentEl.empty();
		this.nextButtonEl = null;
		this.pickingFormat = true;
		this.shell.setPickingFormat(false);
		this.shell.setTitle(i18n.modal.titleChooseMethod());

		const itemsEl = contentEl.createDiv('setting-group mod-list').createDiv('setting-items');
		const rows: HTMLElement[] = [];

		for (const id of ids) {
			const takes = this.wouldTake(id, drop);

			this.addFormatRow(itemsEl, rows, id, () => void this.handOver(id, drop))
				.setName(importerOptionText(id))
				.setDesc(takes > 0
					? i18n.nouns.fileWithCount({ count: takes })
					: i18n.nouns.itemWithCount({ count: drop.items.length }));
		}

		contentEl.createDiv('modal-button-container importer-step-buttons', el => {
			el.createEl('button', { text: i18n.modal.buttonBack() }, el => {
				el.addEventListener('click', back);
			});

			el.createEl('button', { text: i18n.modal.buttonShowAllFormats() }, el => {
				el.addEventListener('click', () => this.startOver());
			});
		});

		rows[0]?.focus();
	}

	private startOver(): void {
		this.selectedId = '';
		this.showFormatPicker();
	}

	private wouldTake(id: string, drop: Drop): number {
		try {
			const importer = new this.plugin.importers[id].importer(this.app, {
				sourceEl: null,
				outputEl: null,
				optionsEl: null,
				plugin: this.plugin,
				importerId: id,
				abortController: new AbortController(),
			});

			return importer.wouldTake(drop.items, drop.files);
		}
		catch (e) {
			console.error(`Could not ask the ${id} importer what it would take`, e);
			return 0;
		}
	}

	private fileTypes(): ImporterFileTypes[] {
		return Object.entries(this.plugin.importers)
			.map(([id, definition]) => ({ id, extensions: definition.importer.extensions }));
	}

	private async takeDropped(items: (PickedFile | PickedFolder)[]): Promise<void> {
		const files = await expandDropped(items);

		// Probe before mutating so partial matches can remain choices.
		if (!this.pickingFormat && this.importer) {
			const taken = this.importer.wouldTake(items, files);
			if (taken > 0 && taken === files.length) {
				this.importer.takeDropped(items, files);
				this.showSourceStep();
				return;
			}
		}

		const exports = readableFiles(this.fileTypes(), files);
		const drop: Drop = { items, files, exports };
		const ids = importersForFiles(this.fileTypes(), exports.map(file => file.extension));

		if (ids.length === 1 && exports.length === files.length) {
			await this.handOver(ids[0], drop);
			return;
		}

		this.showFormatOffer([...ids, COPY_FILES], drop);
	}

	private async handOver(id: string, drop: Drop): Promise<void> {
		this.selectFormat(id);

		const { importer } = this;
		await importer.ready;

		if (importer.notAvailable) return;

		importer.takeDropped(drop.items, drop.files);

		// Redraw controls created during async init().
		this.showSourceStep();
	}

	private catchFileDrop(win: Window): void {
		if (this.dropWin === win) return;
		this.forgetFileDrop();

		this.dropWin = win;
		win.addEventListener('dragover', this.onDragOver, { capture: true });
		win.addEventListener('dragleave', this.onDragLeave, { capture: true });
		win.addEventListener('dragend', this.onDragLeave, { capture: true });
		win.addEventListener('drop', this.onDrop, { capture: true });
	}

	private forgetFileDrop(): void {
		const win = this.dropWin;
		if (!win) return;

		this.dropWin = null;
		win.removeEventListener('dragover', this.onDragOver, { capture: true });
		win.removeEventListener('dragleave', this.onDragLeave, { capture: true });
		win.removeEventListener('dragend', this.onDragLeave, { capture: true });
		win.removeEventListener('drop', this.onDrop, { capture: true });
	}

	private acceptsDrop(): boolean {
		return !this.hidden && !this.current;
	}

	private onDragOver = (evt: DragEvent) => {
		if (!this.acceptsDrop() || !evt.dataTransfer || !dataTransferHasFiles(evt.dataTransfer)) return;

		// preventDefault enables the drop.
		evt.preventDefault();
		evt.stopPropagation();
		evt.dataTransfer.dropEffect = 'copy';

		this.showDropOverlay();
	};

	private onDragLeave = (evt: DragEvent) => {
		// Ignore moves within the window.
		if (evt.type === 'dragleave' && evt.relatedTarget) return;

		this.hideDropOverlay();
	};

	private onDrop = (evt: DragEvent) => {
		if (!this.acceptsDrop() || !evt.dataTransfer || !dataTransferHasFiles(evt.dataTransfer)) return;

		evt.preventDefault();
		evt.stopPropagation();
		this.hideDropOverlay();

		const dropped = droppedItems(evt.dataTransfer);
		if (dropped.length === 0) return;

		void this.takeDropped(dropped).catch(e => console.error('Could not read what was dropped', e));
	};

	private showDropOverlay(): void {
		if (this.dropOverlayEl) return;

		this.dropOverlayEl = this.shell.containerEl.createDiv('importer-drop-overlay', el => {
			el.createDiv({ cls: 'importer-drop-message', text: i18n.modal.msgDropToImport() });
		});
	}

	private hideDropOverlay(): void {
		this.dropOverlayEl?.detach();
		this.dropOverlayEl = null;
	}

	private drawStep(stepEl: HTMLElement | null, onBack: () => void, buildButtons: (buttonsEl: HTMLElement) => void) {
		const { contentEl } = this.shell;
		const definition = this.plugin.importers[this.selectedId];

		contentEl.empty();
		this.nextButtonEl = null;
		this.pickingFormat = false;
		this.shell.setPickingFormat(false);
		// Keep grouped importers under the app name.
		const group = groupOf(this.selectedId);
		this.shell.setTitle(i18n.modal.titleImportFrom({
			format: group ? groupName(group) : importerName(this.selectedId),
		}));

		if (stepEl) contentEl.append(stepEl);

		contentEl.createDiv('modal-button-container importer-step-buttons', el => {
			el.createEl('button', { text: i18n.modal.buttonBack() }, el => {
				el.addEventListener('click', onBack);
			});

			if (definition.helpPermalink) {
				const permalink = definition.helpPermalink;
				el.createEl('button', { text: i18n.modal.buttonHelp() }, el => {
					el.addEventListener('click', () => window.open(helpUrl(permalink)));
				});
			}

			buildButtons(el);
		});
	}

	private async startImport(importer: FormatImporter) {
		if (this.current) {
			this.current.cancel();
		}

		this.reportFile = null;

		const { contentEl } = this.shell;

		contentEl.empty();
		let configEl = contentEl.createDiv();
		let ctx = this.current = new ImportProgressUI(configEl);

		const templateResult = await importer.showTemplateConfiguration(ctx, configEl);

		if (templateResult === false) {
			this.current = null;
			if (this.hasOptionsStep()) this.showOptionsStep();
			else void this.showOutputStep();
			return;
		}

		this.showProgress(ctx, importer.interruption);
		const name = importerName(this.selectedId);
		let threw = false;
		try {
			importer.indexImportedNotes();
			await importer.import(ctx);
		}
		catch (e) {
			// An importer is meant to report a bad note and carry on, but one that
			// throws instead would otherwise finish on a summary of all zeros, with
			// the reason only in the console.
			threw = true;
			ctx.reportFailed(name, e);
		}
		finally {
			await importer.finalizeMarkdownOutput(ctx);
			if (this.current === ctx) {
				this.current = null;
			}

			ctx.status(ctx.isCancelled() ? '' : outcomeText(ctx));
			ctx.finish();

			// An import that threw never got as far as its checkpoints, which is
			// no evidence that the importer neglects them.
			const reported = ctx.notes + ctx.attachments + ctx.skipped.length + ctx.failed.length;
			if (!threw && importer.interruption !== 'none' && ctx.checkpoints === 0 && reported > 0) {
				console.warn(
					`The ${name} importer offers ${importer.interruption} but never awaited ` +
					`ctx.shouldStop(), so neither button could have done anything`
				);
			}

			if (this.hidden) {
				this.finishHiddenNotice(ctx);
			}

			this.showFinished(ctx);
		}
	}

	private showProgress(ctx: ImportProgressUI, interruption: FormatImporter['interruption']) {
		const { contentEl } = this.shell;
		this.drawCurrent = () => this.showProgress(ctx, interruption);
		contentEl.empty();
		ctx.createProgressUI(contentEl.createDiv());

		if (ctx.isCancelled()) return;

		if (interruption === 'none') return;

		let buttonsEl = contentEl.createDiv('modal-button-container');

		let pauseButtonEl: HTMLElement | null = null;
		if (interruption === 'pause') {
			const pauseText = () => ctx.isPaused() ? i18n.modal.buttonResume() : i18n.modal.buttonPause();
			let button = buttonsEl.createEl('button', { text: pauseText() }, el => {
				el.addEventListener('click', () => {
					if (ctx.isPaused()) ctx.resume();
					else ctx.pause();

					button.setText(pauseText());
				});
			});
			pauseButtonEl = button;
		}

		let cancelButtonEl = buttonsEl.createEl('button', { cls: 'mod-danger', text: i18n.modal.buttonStop() }, el => {
			el.addEventListener('click', () => {
				ctx.cancel();
				ctx.status(i18n.progress.statusStopping());
				pauseButtonEl?.detach();
				cancelButtonEl.detach();

				// Show disabled finish actions while cancellation completes.
				this.drawFinishButtons(buttonsEl, ctx, false);
			});
		});
	}

	private drawFinishButtons(buttonsEl: HTMLElement, ctx: ImportProgressUI, enabled: boolean): void {
		if (ctx.log.length > 0) {
			buttonsEl.createEl('button', { cls: 'importer-report-button', text: i18n.modal.buttonSaveReport() }, el => {
				el.disabled = !enabled;
				el.addEventListener('click', () => void this.saveReport(ctx, el));
			});
		}

		buttonsEl.createEl('button', { text: i18n.modal.buttonImportMore() }, el => {
			el.disabled = !enabled;
			el.addEventListener('click', () => this.setUpImporter());
		});
		buttonsEl.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonDone() }, el => {
			el.disabled = !enabled;
			el.addEventListener('click', () => this.shell.finish());
		});
	}

	private async saveReport(ctx: ImportProgressUI, buttonEl: HTMLButtonElement): Promise<void> {
		buttonEl.disabled = true;

		try {
			// Reuse a report already saved from this run.
			this.reportFile ??= await this.importer.writeImportReport(ctx, importerName(this.selectedId));

			if (!this.reportFile) {
				new Notice(i18n.modal.msgReportFailed());
				buttonEl.disabled = false;
				return;
			}

			const report = this.reportFile;
			this.shell.finish();
			await this.app.workspace.getLeaf(true).openFile(report);
		}
		catch (error) {
			console.error('Could not save the import report', error);
			new Notice(i18n.modal.msgReportFailed());
			buttonEl.disabled = false;
		}
	}

	private showFinished(ctx: ImportProgressUI) {
		const { contentEl } = this.shell;
		this.drawCurrent = () => this.showFinished(ctx);
		contentEl.empty();
		ctx.createProgressUI(contentEl.createDiv());

		this.drawFinishButtons(contentEl.createDiv('modal-button-container'), ctx, true);
	}

	private showHiddenNotice() {
		this.clearHiddenNotice();

		const remainingEl = createSpan({ cls: 'u-small' });

		const progressEl = createEl('progress');
		progressEl.max = 1;
		progressEl.value = 0;
		const notice = this.hiddenNotice = new Notice(createFragment(frag => {
			frag.createSpan({ text: i18n.progress.labelImporting() });
			frag.createEl('br');
			frag.append(remainingEl);
			frag.append(progressEl);
		}), 0);

		notice.containerEl.addEventListener('click', () => this.shell.foreground());

		const drawProgress = () => {
			const ctx = this.current;
			if (!ctx) return;

			if (ctx.progressTotal <= 0) {
				remainingEl.setText(ctx.isPaused() ? pausedText(ctx.statusMessage) : statusText(ctx.statusMessage));
				return;
			}

			progressEl.max = ctx.progressTotal;
			progressEl.value = ctx.progressCurrent;

			const remaining = { count: ctx.progressTotal - ctx.progressCurrent };
			remainingEl.setText(ctx.isPaused()
				? i18n.progress.labelPausedRemaining(remaining)
				: i18n.progress.labelRemaining(remaining));
		};

		drawProgress();

		this.hiddenInterval = window.setInterval(() => {
			if (!notice.containerEl.offsetParent) {
				this.clearHiddenInterval();
				return;
			}

			drawProgress();
		}, 300);
	}

	private finishHiddenNotice(ctx: ImportContext) {
		const notice = this.hiddenNotice;
		if (!notice) return;

		this.clearHiddenInterval();

		// The notice is all there is to go on while the modal is hidden, so it has
		// to say which of the three ways the import ended it took.
		const headline = ctx.isCancelled() ? i18n.progress.msgStopped() : outcomeText(ctx);

		const counts = i18n.progress.msgImportedCount({ count: ctx.notes })
			+ (ctx.failed.length > 0 ? `, ${i18n.nouns.failureWithCount({ count: ctx.failed.length })}` : '');

		notice.setMessage(createFragment(frag => {
			frag.createSpan({ text: headline });
			frag.createEl('br');
			frag.createSpan({ cls: 'u-small', text: i18n.progress.msgClickToShow({ counts }) });
		}));
	}

	private clearHiddenInterval() {
		if (this.hiddenInterval !== null) {
			window.clearInterval(this.hiddenInterval);
			this.hiddenInterval = null;
		}
	}

	private clearHiddenNotice() {
		this.clearHiddenInterval();
		this.hiddenNotice?.hide();
		this.hiddenNotice = null;
	}
}
