import { App, Platform, PluginSettingTab, Setting, SettingPage } from 'obsidian';
import { ImporterFlow, ImporterShell } from './importer-flow';
import type ImporterPlugin from './main';

class ImportPage extends SettingPage {
	constructor(private tab: ImporterSettingTab, title: string) {
		super();

		// Setting pages are siblings of their tab.
		this.rootEl.addClass('importer-flow');
		this.title = title;
	}

	display(): void {
		this.tab.drawInPage(this);
	}

	hide(): void {
		this.tab.pageClosed(this);
	}
}

/** Settings host for the shared import flow. */
export class ImporterSettingTab extends PluginSettingTab implements ImporterShell {
	plugin: ImporterPlugin;
	flow: ImporterFlow;

	get ownsBackButton(): boolean {
		return Platform.isPhone;
	}

	readonly ownsFocus: boolean = false;

	private rootContentEl: HTMLElement;

	private heading: Setting | null;

	private title: string = '';

	private pages: ImportPage[] = [];

	private depth: number = 0;

	private visible: boolean = false;

	private pendingBack: boolean = false;

	private barEl: HTMLElement | null = null;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.flow = new ImporterFlow(app, plugin, this);
	}

	get contentEl(): HTMLElement {
		return this.topPage()?.containerEl ?? this.rootContentEl;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.addClass('importer-flow');

		this.heading = new Setting(containerEl).setHeading().setName(this.title);
		this.rootContentEl = containerEl.createDiv();
		this.visible = true;

		// pageClosed redraws after the flow steps back.
		if (!this.pendingBack) this.flow.attach();
	}

	hide(): void {
		this.visible = false;

		this.barEl?.detach();
		this.barEl = null;

		this.flow.detach();
	}

	drawInPage(page: ImportPage): void {
		if (page !== this.topPage() || this.pages.length !== this.depth) return;

		this.flow.redraw();
	}

	pageClosed(page: ImportPage): void {
		if (page !== this.topPage()) return;

		this.pages.pop();
		const behind = this.pages.length;
		this.pendingBack = true;

		// Wait for Settings to finish updating the page stack.
		queueMicrotask(() => {
			this.pendingBack = false;

			// Stack changes beyond this page indicate teardown, not Back.
			if (this.pages.length !== behind || !this.visible) return;

			this.flow.back();
		});
	}

	setScreen(depth: number, title: string): void {
		this.title = title;
		this.depth = depth;
		this.showPages(title);
	}

	setPickingFormat(picking: boolean): void {
		this.containerEl.toggleClass('is-picking-format', picking);
	}

	/** Keeps actions outside the scrolling, animated SettingPage. */
	adoptButtonBar(barEl: HTMLElement | null): void {
		(this.topPage()?.rootEl ?? this.containerEl).toggleClass('has-button-bar', !!barEl);

		const hostEl = this.buttonBarHost();
		if (!hostEl) return;

		if (barEl) {
			hostEl.empty();
			hostEl.append(barEl);
		}

		hostEl.toggleClass('is-shown', !!barEl);
	}

	/** Uses the Settings window's document, which may differ from window.document. */
	private buttonBarHost(): HTMLElement | null {
		if (this.barEl?.isConnected) return this.barEl;

		const paneEl = this.containerEl.ownerDocument
			.querySelector<HTMLElement>('.vertical-tab-content-container');

		this.barEl = paneEl?.createDiv('importer-button-bar') ?? null;
		return this.barEl;
	}

	finish(): void {
		this.app.setting.close();
	}

	open(): void {
		const { setting } = this.app;

		setting.open();

		// Reopening the active tab would clear its SettingPage stack.
		if (setting.activeTab === this) this.flow.attach();
		else setting.openTabById(this.plugin.manifest.id);
	}

	foreground(): void {
		this.open();
	}

	private showPages(title: string): void {
		while (this.pages.length > this.depth) {
			// Pop before close() re-enters pageClosed().
			this.pages.pop();
			this.app.setting.closePage();
		}

		while (this.pages.length < this.depth) {
			const page = new ImportPage(this, title);
			this.pages.push(page);
			this.app.setting.openPage(page);
		}

		const top = this.topPage();
		if (top) this.retitle(top, title);
		else this.heading?.setName(title);
	}

	private retitle(page: ImportPage, title: string): void {
		page.title = title;
		page.titlebarEl.querySelector('.setting-page-title')?.setText(title);
	}

	private topPage(): ImportPage | null {
		return this.pages[this.pages.length - 1] ?? null;
	}
}
