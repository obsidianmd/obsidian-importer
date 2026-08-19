import { App, Notice, Platform, prepareFuzzySearch, renderMatches, SearchComponent, SearchResult, Setting, SettingGroup, setIcon, TFile } from 'obsidian';
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

interface ImportRun {
	importer: FormatImporter;
	importerId: string;
	ctx: ImportProgressUI;
	depth: number;
	reportFile: TFile | null;
}

type ConfigurationResult =
	| { kind: 'configured', result: boolean | null }
	| { kind: 'cancelled', redraw: boolean };

const FORMAT_LIST = 0;

/** Host-specific chrome for the shared import flow. */
export interface ImporterShell {
	readonly contentEl: HTMLElement;
	readonly containerEl: HTMLElement;
	/** True when the host supplies navigation chrome. */
	readonly ownsBackButton: boolean;
	/** False when the host manages focus, as Settings does. */
	readonly ownsFocus: boolean;
	/** Depth is the number of screens beyond the format list. */
	setScreen(depth: number, title: string): void;
	setPickingFormat(picking: boolean): void;
	/** Lets the host place actions outside a scrolling screen. */
	adoptButtonBar(barEl: HTMLElement | null): void;
	finish(): void;
	foreground(): void;
}

/** Import screens shared by the modal and Settings tab. */
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

	private configurationCancel: ((redraw: boolean) => void) | null = null;

	private drawCurrent: () => unknown = () => this.showFormatPicker();

	private goBack: (() => unknown) | null = null;

	private depth: number = FORMAT_LIST;

	/** Prevents host callbacks from recursively redrawing. */
	private drawing: boolean = false;

	/** Restores a background import when its notice is clicked. */
	private awayFrom: (() => unknown) | null = null;

	private importRun: Promise<void> | null = null;

	/** Closes the gap before importRun is assigned. */
	private starting: boolean = false;

	get importerId(): string {
		return this.selectedId;
	}

	get helpPermalink(): string | undefined {
		return this.plugin.importers[this.selectedId]?.helpPermalink;
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

	attach(): void {
		this.hidden = this.awayFrom !== null;
		if (!this.hidden) this.clearHiddenNotice();
		this.catchFileDrop(this.shell.containerEl.win);
		this.redraw();
	}

	/** Redraws unless a host callback is already doing so. */
	redraw(): void {
		this.draw(this.drawCurrent);
	}

	back(): void {
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
					.finally(() => this.drawn());
			}
			else {
				this.drawn();
			}
		}
	}

	private drawn(): void {
		this.drawing = false;
	}

	/** Detaches the UI while allowing a running import to continue. */
	detach(): void {
		this.hideDropOverlay();
		this.forgetFileDrop();

		// Configuration controls cannot survive their shell.
		if (this.configurationCancel) {
			this.configurationCancel(false);
			this.hidden = false;
			this.clearHiddenNotice();
			return;
		}

		if (!this.current) return;

		this.hidden = true;
		this.showHiddenNotice();
	}

	/** Leaves the import screen while preserving any background run. */
	leave(): void {
		if (this.current) {
			this.hidden = true;
			this.awayFrom ??= this.drawCurrent;
			this.showHiddenNotice();
		}

		this.showFormatPicker();
	}

	/** Permanently tears down the flow and cancels its work. */
	dispose(): void {
		this.hideDropOverlay();
		this.forgetFileDrop();
		this.configurationCancel?.(false);
		this.abortController.abort('import was canceled by user');
		this.clearHiddenNotice();
		this.hidden = false;
		this.awayFrom = null;
		this.current?.cancel();
	}

	private showScreen(depth: number, title: string, back: (() => unknown) | null): void {
		this.depth = depth;
		this.goBack = back;
		this.shell.setScreen(depth, title);
	}

	showFormatPicker() {
		this.drawCurrent = () => this.showFormatPicker();
		this.pickingFormat = true;
		this.shell.setPickingFormat(true);

		this.shell.adoptButtonBar(null);
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

	private buttonBar(cls: string): HTMLElement {
		const barEl = createDiv(cls);
		this.shell.adoptButtonBar(barEl);

		return barEl;
	}

	private addHelpButton(buttonsEl: HTMLElement, permalink: string | undefined): void {
		if (!permalink) return;

		const open = () => window.open(helpUrl(permalink));

		if (Platform.isPhone) {
			buttonsEl.createEl('button', {
				cls: 'clickable-icon mod-raised importer-help-button',
				attr: { 'aria-label': i18n.modal.buttonHelp() },
			}, el => {
				setIcon(el, 'help');
				el.addEventListener('click', open);
			});
			return;
		}

		buttonsEl.createEl('button', { text: i18n.modal.buttonHelp() }, el => {
			el.addEventListener('click', open);
		});
	}

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
		const setting = new Setting(itemsEl).setNavigable(choose);
		const { settingEl } = setting;
		const index = rows.length;

		settingEl.tabIndex = 0;

		// Settings activates focused rows itself.
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

		const itemsEl = new SettingGroup(contentEl).listEl;
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

		this.shell.adoptButtonBar(buttonsEl.childElementCount > 0 ? buttonsEl : null);

		if (this.shell.ownsFocus) rows[0]?.focus();
	}

	selectFormat(id: string) {
		if (!Object.prototype.hasOwnProperty.call(this.plugin.importers, id)) return;

		// Never expose an importer still owned by a background run.
		if (id === this.selectedId && this.importer
			&& !this.current && !this.importRun && !this.awayFrom) {
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
			this.showUnavailable();
			return;
		}

		this.showSourceStep();
	}

	private showUnavailable() {
		this.drawCurrent = () => this.showUnavailable();
		this.drawStep(this.sourceDepth(), this.sourceEl, () => this.showPreviousScreen(), () => {});
	}

	private sourceDepth(): number {
		return groupOf(this.selectedId) ? FORMAT_LIST + 2 : FORMAT_LIST + 1;
	}

	private importTitle(importerId: string = this.selectedId): string {
		const group = groupOf(importerId);
		return i18n.modal.titleImportFrom({
			format: group ? groupName(group) : importerName(importerId),
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
		const text = importer.configures ? i18n.modal.buttonContinue() : i18n.modal.buttonImport();

		return buttonsEl.createEl('button', { cls: 'mod-cta', text }, el => {
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

		const itemsEl = new SettingGroup(contentEl).listEl;
		const rows: HTMLElement[] = [];

		for (const id of ids) {
			const takes = this.wouldTake(id, drop);

			this.addFormatRow(itemsEl, rows, id, () => void this.handOver(id, drop))
				.setName(importerOptionText(id))
				.setDesc(takes > 0
					? i18n.nouns.fileWithCount({ count: takes })
					: i18n.nouns.itemWithCount({ count: drop.items.length }));
		}

		const buttonsEl = this.buttonBar('modal-button-container importer-step-buttons');
		this.addBackButton(buttonsEl);

		buttonsEl.createEl('button', { text: i18n.modal.buttonShowAllFormats() }, el => {
			el.addEventListener('click', () => this.startOver());
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
				helpPermalink: this.plugin.importers[id].helpPermalink,
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

		evt.preventDefault();
		evt.stopPropagation();
		evt.dataTransfer.dropEffect = 'copy';

		this.showDropOverlay();
	};

	private onDragLeave = (evt: DragEvent) => {
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

		const buttonsEl = this.buttonBar('modal-button-container importer-step-buttons');
		this.addBackButton(buttonsEl);
		this.addHelpButton(buttonsEl, definition.helpPermalink);
		buildButtons(buttonsEl);
	}

	private async startImport(importer: FormatImporter) {
		// Guard the async gap before importRun is assigned.
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
		// Capture state before waiting for a previous run to stop.
		const importerId = this.selectedId;
		const setupScreen = this.drawCurrent;

		// A screen of the importer's own is a page over the step it was started
		// from, so it arrives the way every other screen does — slid in, and
		// swiped back out. The run that follows stays on that page rather than
		// closing it to draw itself one behind.
		const depth = importer.configures ? this.depth + 1 : this.depth;
		const sourceEl = this.sourceEl;
		const outputEl = this.outputEl;
		const optionsEl = this.optionsEl;
		const restoreSetup = () => {
			this.selectedId = importerId;
			this.importer = importer;
			this.sourceEl = sourceEl;
			this.outputEl = outputEl;
			this.optionsEl = optionsEl;
		};

		await this.stopRunningImport();
		restoreSetup();

		this.awayFrom = null;
		this.hidden = false;
		this.clearHiddenNotice();

		let configurationContext: ImportProgressUI | null = null;
		let cancelConfiguration!: (redraw: boolean) => void;
		const cancelled = new Promise<ConfigurationResult>(resolve => {
			let settled = false;
			cancelConfiguration = redraw => {
				if (settled) return;
				settled = true;
				configurationContext?.cancel();
				resolve({ kind: 'cancelled', redraw });
			};
		});

		this.configurationCancel = cancelConfiguration;
		this.showConfigurationScreen(depth, importerId, cancelConfiguration);

		// Settings may replace contentEl while setScreen opens a page.
		const { contentEl } = this.shell;
		contentEl.empty();
		const configEl = contentEl.createDiv();

		// Drawn loose: the progress UI draws itself where it is made, and the run
		// draws it again when it starts, so made here it is the progress screen
		// flashing up under the configuration — for as long as the importer takes
		// to have something to show.
		const ctx = configurationContext = this.current = new ImportProgressUI(createDiv());

		const buttonsEl = this.buttonBar('modal-button-container importer-step-buttons');
		this.addBackButton(buttonsEl);
		this.addHelpButton(buttonsEl, this.plugin.importers[importerId]?.helpPermalink);

		let configuration: ConfigurationResult;
		try {
			configuration = await Promise.race([
				importer.showTemplateConfiguration(ctx, configEl, buttonsEl)
					.then(result => ({ kind: 'configured', result }) as const),
				cancelled,
			]);
		}
		catch (error) {
			if (this.configurationCancel === cancelConfiguration) this.configurationCancel = null;
			if (this.current === ctx) this.current = null;
			restoreSetup();
			this.drawCurrent = setupScreen;
			if (!this.hidden) this.draw(setupScreen);
			throw error;
		}

		if (this.configurationCancel === cancelConfiguration) this.configurationCancel = null;

		if (configuration.kind === 'cancelled' || configuration.result === false) {
			if (this.current === ctx) this.current = null;
			restoreSetup();
			this.drawCurrent = setupScreen;

			const redraw = configuration.kind === 'configured' || configuration.redraw;
			if (redraw) this.draw(setupScreen);
			return;
		}

		const state: ImportRun = {
			importer,
			importerId,
			ctx,
			depth,
			reportFile: null,
		};

		const run = this.runImport(state);
		this.importRun = run;
		this.starting = false;

		try {
			await run;
		}
		finally {
			if (this.importRun === run) this.importRun = null;
		}
	}

	/** Back resolves the pending configuration as cancelled. */
	private showConfigurationScreen(
		depth: number,
		importerId: string,
		cancel: (redraw: boolean) => void,
	): void {
		this.drawCurrent = () => this.showConfigurationScreen(depth, importerId, cancel);
		this.pickingFormat = false;
		this.shell.setPickingFormat(false);
		this.showScreen(depth, this.importTitle(importerId), () => cancel(true));
	}

	/** Waits for cooperative cancellation to reach a checkpoint. */
	private async stopRunningImport(): Promise<void> {
		const running = this.importRun;
		if (!running) return;

		this.current?.cancel();
		this.current?.status(i18n.progress.statusStopping());

		await running;
	}

	private async runImport(state: ImportRun) {
		const { importer, importerId, ctx } = state;
		this.showProgress(state);
		const name = importerName(importerId);
		let threw = false;
		try {
			importer.indexImportedNotes();
			await importer.import(ctx);
		}
		catch (e) {
			// Surface importer-level failures in the report, not only the console.
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

			// Keep a detached import's notice pointed at its final state.
			if (this.awayFrom) this.awayFrom = () => this.showFinished(state);
			else this.showFinished(state);
		}
	}

	private showProgress(state: ImportRun) {
		const { ctx, depth, importerId } = state;
		const { interruption } = state.importer;
		this.drawCurrent = () => this.showProgress(state);
		this.showScreen(depth, this.importTitle(importerId), null);

		const { contentEl } = this.shell;
		contentEl.empty();
		ctx.createProgressUI(contentEl.createDiv());

		if (ctx.isCancelled()) return;

		if (interruption === 'none') return;

		let buttonsEl = this.buttonBar('modal-button-container importer-progress-buttons');

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

		let cancelButtonEl = buttonsEl.createEl('button', { cls: 'mod-destructive', text: i18n.modal.buttonStop() }, el => {
			el.addEventListener('click', () => {
				ctx.cancel();
				ctx.status(i18n.progress.statusStopping());
				pauseButtonEl?.detach();
				cancelButtonEl.detach();

				this.drawFinishButtons(buttonsEl, state, false);
			});
		});
	}

	private drawFinishButtons(buttonsEl: HTMLElement, state: ImportRun, enabled: boolean): void {
		const { ctx } = state;
		if (ctx.log.length > 0) {
			buttonsEl.createEl('button', { cls: 'importer-report-button', text: i18n.modal.buttonSaveReport() }, el => {
				el.disabled = !enabled;
				el.addEventListener('click', () => void this.saveReport(state, el));
			});
		}

		buttonsEl.createEl('button', { text: i18n.modal.buttonImportMore() }, el => {
			el.disabled = !enabled;
			el.addEventListener('click', () => {
				this.selectedId = state.importerId;
				this.setUpImporter();
			});
		});
		buttonsEl.createEl('button', { cls: 'mod-cta', text: i18n.modal.buttonDone() }, el => {
			el.disabled = !enabled;
			el.addEventListener('click', () => this.finish());
		});
	}

	private async saveReport(state: ImportRun, buttonEl: HTMLButtonElement): Promise<void> {
		buttonEl.disabled = true;

		try {
			state.reportFile ??= await state.importer.writeImportReport(
				state.ctx,
				importerName(state.importerId),
			);

			if (!state.reportFile) {
				new Notice(i18n.modal.msgReportFailed());
				buttonEl.disabled = false;
				return;
			}

			const report = state.reportFile;
			this.finish();
			await this.app.workspace.getLeaf(true).openFile(report);
		}
		catch (error) {
			console.error('Could not save the import report', error);
			new Notice(i18n.modal.msgReportFailed());
			buttonEl.disabled = false;
		}
	}

	private showFinished(state: ImportRun) {
		const { ctx, depth, importerId } = state;
		this.drawCurrent = () => this.showFinished(state);
		this.showScreen(depth, this.importTitle(importerId), null);

		const { contentEl } = this.shell;
		contentEl.empty();
		ctx.createProgressUI(contentEl.createDiv());

		this.drawFinishButtons(this.buttonBar('modal-button-container'), state, true);
	}

	/** Completes this flow so the next opening starts fresh. */
	private finish(): void {
		this.startOver();
		this.shell.finish();
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
