import { App, Notice, prepareFuzzySearch, renderMatches, SearchComponent, SearchResult, Setting, SettingGroup, setIcon, TFile } from 'obsidian';
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

/** The list of formats: the screen every other one is reached from. */
const FORMAT_LIST = 0;

/**
 * What the flow needs from whatever is showing it: a modal has a title bar and
 * closes, a setting tab has a heading and a window of its own to close.
 */
export interface ImporterShell {
	/** Where a screen is drawn. The flow empties it between screens. */
	readonly contentEl: HTMLElement;
	/** What the drop overlay covers, and the window a file is dropped into. */
	readonly containerEl: HTMLElement;
	/**
	 * The shell draws the way back itself, as Settings does in the titlebar of
	 * every page it opens, and calls `back()` when it is used. The flow draws
	 * no Back button of its own then: a second one would say less.
	 */
	readonly ownsBackButton: boolean;
	/**
	 * Whether the screens offer a link to the format's documentation. The
	 * modal does; a setting tab leaves it out.
	 */
	readonly showsHelp: boolean;
	/**
	 * Whether the flow is what moves the focus here. A modal opens for this
	 * and nothing else, so its search is ready to type into and its rows
	 * answer the arrow keys. Settings does both for itself, around a search
	 * of its own, and a screen that grabbed the focus would take it from
	 * there — or raise a phone's keyboard as the pane opened.
	 */
	readonly ownsFocus: boolean;
	/**
	 * The flow moved: `depth` counts screens in from the format list, which is
	 * what a shell showing pages needs in order to open and close them.
	 */
	setScreen(depth: number, title: string): void;
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
	private drawCurrent: () => unknown = () => this.showFormatPicker();

	/** Where the screen showing now goes back to, if anywhere. */
	private goBack: (() => unknown) | null = null;

	/** How deep the screen showing now is, for the ones that replace it. */
	private depth: number = FORMAT_LIST;

	/** Set while drawing, so a shell redrawing in response cannot recurse. */
	private drawing: boolean = false;

	/**
	 * The screen a running import is on, when the user has navigated away from
	 * it: what the notice takes them back to.
	 */
	private awayFrom: (() => unknown) | null = null;

	/** The import running now, until the last of its writing is done. */
	private importRun: Promise<void> | null = null;

	/**
	 * Set from the moment Import is pressed until there is a run to point at.
	 * A press during the run is a different matter: it stops that one first.
	 */
	private starting: boolean = false;

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
		// An import the user navigated away from stays away, and stays on the
		// notice, even though the shell showing the format list is on screen.
		this.hidden = this.awayFrom !== null;
		if (!this.hidden) this.clearHiddenNotice();
		this.catchFileDrop(this.shell.containerEl.win);
		this.redraw();
	}

	/**
	 * Draw the screen the flow is on, once. A shell redraws in answer to the
	 * flow — a page fills itself when it opens — so a draw already under way,
	 * including one waiting on an importer, is left to finish on its own.
	 */
	redraw(): void {
		this.draw(this.drawCurrent);
	}

	/**
	 * The way back from the screen showing now, for a shell that draws it: a
	 * step at a time, and out of a running import altogether, which is the one
	 * screen there is no going back from.
	 */
	back(): void {
		// The list is as far back as it goes: a shell unwinding several pages
		// at once asks each of them, and only the first has anywhere to go.
		if (!this.goBack && this.depth === FORMAT_LIST) return;

		this.draw(this.goBack ?? (() => this.leave()));
	}

	private draw(screen: () => unknown): void {
		if (this.drawing) return;

		this.drawing = true;
		let drawn: unknown;
		try {
			drawn = screen();
		}
		finally {
			if (drawn instanceof Promise) {
				void drawn
					.catch(e => console.error('Could not draw the import', e))
					.finally(() => this.drawing = false);
			}
			else {
				this.drawing = false;
			}
		}
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

	/**
	 * The user went back past the import itself — the way out of a settings
	 * page. The list is what they asked for; an import already running keeps
	 * going, and the notice is what leads back to it.
	 */
	leave(): void {
		if (this.current) {
			this.hidden = true;
			// Keep the screen the import is on, not whatever was left behind
			// on the way out of it.
			this.awayFrom ??= this.drawCurrent;
			this.showHiddenNotice();
		}

		this.showFormatPicker();
	}

	/** The shell is gone for good, and takes the import with it. */
	dispose(): void {
		this.hideDropOverlay();
		this.forgetFileDrop();
		this.abortController.abort('import was canceled by user');
		this.clearHiddenNotice();
		this.hidden = false;
		this.awayFrom = null;
		this.current?.cancel();
	}

	/**
	 * Tell the shell where the flow is before drawing: it may answer with a
	 * screen of its own to draw into — Settings opens a page — and the flow
	 * fills whichever element it is left with.
	 */
	private showScreen(depth: number, title: string, back: (() => unknown) | null): void {
		this.depth = depth;
		this.goBack = back;
		this.shell.setScreen(depth, title);
	}

	showFormatPicker() {
		this.drawCurrent = () => this.showFormatPicker();
		this.pickingFormat = true;
		this.shell.setPickingFormat(true);
		this.showScreen(FORMAT_LIST, i18n.modal.titlePickFormat(), null);

		const { contentEl } = this.shell;
		contentEl.empty();

		const group = new SettingGroup(contentEl).addClass('mod-list');
		const itemsEl = group.listEl;

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

		let search!: SearchComponent;
		group.addSearch(component => {
			search = component
				.setPlaceholder(i18n.modal.searchPlaceholder())
				.onChange(value => draw(value));
		});

		search.inputEl.addEventListener('keydown', evt => {
			if (evt.key !== 'ArrowDown' && evt.key !== 'Enter') return;
			evt.preventDefault();

			if (evt.key === 'Enter') rows[0]?.click();
			else focusRow(0);
		});

		draw('');
		if (this.shell.ownsFocus) search.inputEl.focus();
	}

	/** What this format's documentation is, where the shell shows such a thing. */
	private addHelpButton(buttonsEl: HTMLElement, permalink: string | undefined): void {
		if (!permalink || !this.shell.showsHelp) return;

		buttonsEl.createEl('button', { text: i18n.modal.buttonHelp() }, el => {
			el.addEventListener('click', () => window.open(helpUrl(permalink)));
		});
	}

	/** The way back out of the screen showing now, unless the shell has one. */
	private addBackButton(buttonsEl: HTMLElement): void {
		if (this.shell.ownsBackButton || !this.goBack) return;

		buttonsEl.createEl('button', { text: i18n.modal.buttonBack() }, el => {
			el.addEventListener('click', () => this.back());
		});
	}

	private addNavigableRow(
		itemsEl: HTMLElement,
		rows: HTMLElement[],
		choose: () => void,
		focus: (index: number) => void = index => rows[Math.min(Math.max(index, 0), rows.length - 1)]?.focus(),
	): Setting {
		// setNavigable draws the chevron, takes the click, and marks the row
		// tappable, which is what keeps a phone from waiting on a second tap.
		const setting = new Setting(itemsEl).setNavigable(choose);
		const { settingEl } = setting;
		const index = rows.length;

		settingEl.tabIndex = 0;

		// Settings walks these rows itself and activates the focused one, so a
		// second listener would choose the same format twice.
		if (this.shell.ownsFocus) {
			settingEl.addEventListener('keydown', (evt: KeyboardEvent) => {
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
		}

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
		this.drawCurrent = () => this.showMethodPicker(group);
		this.nextButtonEl = null;
		this.pickingFormat = true;
		this.shell.setPickingFormat(false);
		this.showScreen(FORMAT_LIST + 1, i18n.modal.titleChooseMethod(), () => this.showFormatPicker());

		const { contentEl } = this.shell;
		contentEl.empty();

		const itemsEl = new SettingGroup(contentEl).addClass('mod-list').listEl;
		const rows: HTMLElement[] = [];

		for (const member of IMPORTER_GROUPS[group]) {
			if (!Object.prototype.hasOwnProperty.call(this.plugin.importers, member)) continue;

			this.addNavigableRow(itemsEl, rows, () => this.selectFormat(member))
				.setName(i18n.importer(`${member}.method-name`))
				.setDesc(i18n.importer(`${member}.method-desc`));
		}

		const buttonsEl = createDiv('modal-button-container importer-step-buttons');
		this.addBackButton(buttonsEl);
		this.addHelpButton(buttonsEl, groupHelpPermalink(this.plugin.importers, group));

		// Both belong to the shell in Settings, where the row would be empty,
		// and the space it still takes reads as a gap under the list.
		if (buttonsEl.childElementCount > 0) contentEl.append(buttonsEl);

		if (this.shell.ownsFocus) rows[0]?.focus();
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
			this.drawStep(this.sourceDepth(), this.optionsEl, () => this.showPreviousScreen(), () => {});
			return;
		}

		this.showSourceStep();
	}

	/** The source comes after the method picker, for a format that has one. */
	private sourceDepth(): number {
		return groupOf(this.selectedId) ? FORMAT_LIST + 2 : FORMAT_LIST + 1;
	}

	/** Keep grouped importers under the app name. */
	private importTitle(): string {
		const group = groupOf(this.selectedId);
		return i18n.modal.titleImportFrom({
			format: group ? groupName(group) : importerName(this.selectedId),
		});
	}

	private hasOptionsStep(): boolean {
		return (this.optionsEl?.childElementCount ?? 0) > 0;
	}

	showSourceStep() {
		this.drawCurrent = () => this.showSourceStep();
		this.drawStep(this.sourceDepth(), this.sourceEl, () => this.showPreviousScreen(), el => {
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

		this.drawCurrent = () => this.showOutputStep();

		await importer.ready;
		importer.drawOutputStep();

		this.drawStep(this.sourceDepth() + 1, this.outputEl, () => this.showSourceStep(), el => {
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
		this.drawStep(this.sourceDepth() + 2, this.optionsEl, () => this.showOutputStep(), el => {
			this.addImportButton(el, importer);
		});
	}

	private addImportButton(buttonsEl: HTMLElement, importer: FormatImporter): HTMLButtonElement {
		return buttonsEl.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonImport() }, el => {
			el.addEventListener('click', () => void this.startImport(importer)
				.catch(e => console.error('Import failed', e)));
		});
	}

	private showFormatOffer(ids: string[], drop: Drop) {
		const back = this.pickingFormat || !this.importer
			? () => this.startOver()
			: () => this.showFirstStep();

		this.drawCurrent = () => this.showFormatOffer(ids, drop);
		this.nextButtonEl = null;
		this.pickingFormat = true;
		this.shell.setPickingFormat(false);
		this.showScreen(FORMAT_LIST + 1, i18n.modal.titleChooseMethod(), back);

		const { contentEl } = this.shell;
		contentEl.empty();

		const itemsEl = new SettingGroup(contentEl).addClass('mod-list').listEl;
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
			this.addBackButton(el);

			el.createEl('button', { text: i18n.modal.buttonShowAllFormats() }, el => {
				el.addEventListener('click', () => this.startOver());
			});
		});

		if (this.shell.ownsFocus) rows[0]?.focus();
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

	private drawStep(depth: number, stepEl: HTMLElement | null, onBack: (() => unknown) | null, buildButtons: (buttonsEl: HTMLElement) => void) {
		const definition = this.plugin.importers[this.selectedId];

		this.nextButtonEl = null;
		this.pickingFormat = false;
		this.shell.setPickingFormat(false);
		this.showScreen(depth, this.importTitle(), onBack);

		const { contentEl } = this.shell;
		contentEl.empty();

		if (stepEl) contentEl.append(stepEl);

		contentEl.createDiv('modal-button-container importer-step-buttons', el => {
			this.addBackButton(el);

			this.addHelpButton(el, definition.helpPermalink);

			buildButtons(el);
		});
	}

	private async startImport(importer: FormatImporter) {
		// Two presses before either has a run to its name would both get past
		// the stop below, and import at once.
		if (this.starting) return;
		this.starting = true;

		try {
			await this.startImportRun(importer);
		}
		finally {
			this.starting = false;
		}
	}

	private async startImportRun(importer: FormatImporter) {
		await this.stopRunningImport();

		this.awayFrom = null;
		this.hidden = false;
		this.clearHiddenNotice();
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

		// The screen it was started from is where it is watched and finished:
		// held on to, because the flow can be sent back to the list meanwhile.
		const depth = this.depth;

		const run = this.runImport(importer, ctx, depth);
		this.importRun = run;
		// The run is what a later press waits on from here.
		this.starting = false;

		try {
			await run;
		}
		finally {
			if (this.importRun === run) this.importRun = null;
		}
	}

	/**
	 * Stop the import running now, and wait for it to have stopped. Stopping
	 * is cooperative: until the run reaches its next checkpoint it is still
	 * writing to the vault, and still has a screen of its own to finish on.
	 */
	private async stopRunningImport(): Promise<void> {
		const running = this.importRun;
		if (!running) return;

		this.current?.cancel();
		this.current?.status(i18n.progress.statusStopping());

		await running;
	}

	private async runImport(importer: FormatImporter, ctx: ImportProgressUI, depth: number) {
		this.showProgress(ctx, importer.interruption, depth);
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

			// An import the user walked out of finishes where they left it, not
			// over the list they went back to: the notice is the way in, and
			// what it leads to is how the import ended.
			if (this.awayFrom) this.awayFrom = () => this.showFinished(ctx, depth);
			else this.showFinished(ctx, depth);
		}
	}

	private showProgress(ctx: ImportProgressUI, interruption: FormatImporter['interruption'], depth: number) {
		this.drawCurrent = () => this.showProgress(ctx, interruption, depth);
		// An import cannot be stepped back into; leaving it is the way out.
		this.showScreen(depth, this.importTitle(), null);

		const { contentEl } = this.shell;
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

	private showFinished(ctx: ImportProgressUI, depth: number) {
		this.drawCurrent = () => this.showFinished(ctx, depth);
		this.showScreen(depth, this.importTitle(), null);

		const { contentEl } = this.shell;
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

		notice.containerEl.addEventListener('click', () => {
			// Back to the import itself, not to the list the user left it for.
			if (this.awayFrom) {
				this.drawCurrent = this.awayFrom;
				this.awayFrom = null;
			}

			this.shell.foreground();
		});

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
