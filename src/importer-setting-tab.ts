import { App, PluginSettingTab, Setting, SettingPage } from 'obsidian';
import { FORMAT_LIST, ImporterFlow, ImporterShell } from './importer-flow';
import type ImporterPlugin from './main';

/** A page holding one import, with the back button that leads out of it. */
class ImportPage extends SettingPage {
	constructor(private tab: ImporterSettingTab, title: string) {
		super();

		// The page is a sibling of the tab, not a child, so it needs the class
		// the flow's own styles hang off in its own right.
		this.rootEl.addClass('importer-flow');
		this.title = title;
	}

	display(): void {
		this.tab.drawInPage();
	}

	hide(): void {
		this.tab.pageClosed(this);
	}
}

/**
 * The import flow as a settings tab: the format list is the tab itself, and
 * the format chosen from it opens a page — one screen holding what to import,
 * where it lands and whatever else the format asks, the way Settings shows
 * anything that needs a screen of its own.
 */
export class ImporterSettingTab extends PluginSettingTab implements ImporterShell {
	plugin: ImporterPlugin;
	flow: ImporterFlow;

	/** The page opened over the tab carries the way back out of it. */
	readonly combinesSteps: boolean = true;

	/** Built by display(), under the heading the flow retitles per screen. */
	private rootContentEl: HTMLElement;

	/** Set in display(), not in a field initializer. */
	private heading: Setting | null;

	/**
	 * The heading is rebuilt every time the tab is opened, and a screen only
	 * titles itself when it is drawn: the import it comes back to would
	 * otherwise sit under a blank heading.
	 */
	private title: string = '';

	private page: ImportPage | null = null;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.flow = new ImporterFlow(app, plugin, this);
	}

	/** Whichever of the two is showing: the tab, or the page opened over it. */
	get contentEl(): HTMLElement {
		return this.page ? this.page.containerEl : this.rootContentEl;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.addClass('importer-flow');

		this.heading = new Setting(containerEl).setHeading().setName(this.title);
		this.rootContentEl = containerEl.createDiv();

		this.flow.attach();
	}

	hide(): void {
		this.flow.detach();
	}

	/** Obsidian drew the page: the flow fills it with the screen it is on. */
	drawInPage(): void {
		this.flow.redraw();
	}

	/** The page was closed — by the back button, unless the flow closed it. */
	pageClosed(page: ImportPage): void {
		if (this.page !== page) return;

		this.page = null;
		this.flow.leave();
	}

	setScreen(depth: number, title: string): void {
		this.title = title;

		if (depth === FORMAT_LIST) {
			this.closePage();
			this.heading?.setName(title);
			return;
		}

		this.openPage(title);
	}

	setPickingFormat(picking: boolean): void {
		this.containerEl.toggleClass('is-picking-format', picking);
	}

	finish(): void {
		this.app.setting.close();
	}

	foreground(): void {
		const { setting } = this.app;

		setting.open();

		// Opening a tab clears the page stack, so a tab already showing is
		// drawn again where it stands: asking for it would close the page the
		// flow is about to draw into.
		if (setting.activeTab === this) this.flow.attach();
		else setting.openTabById(this.plugin.manifest.id);
	}

	private openPage(title: string): void {
		const open = this.page;

		if (open) {
			// The page outlives the screen: choosing a method retitles it.
			open.title = title;
			open.titlebarEl.querySelector('.setting-page-title')?.setText(title);
			return;
		}

		// Set before opening: Obsidian draws the page on the way in, and the
		// flow draws into whichever of the two contentEls is showing.
		const page = this.page = new ImportPage(this, title);
		this.app.setting.openPage(page);
	}

	private closePage(): void {
		if (!this.page) return;

		// Cleared first: closing calls back into pageClosed, which is for the
		// back button, and this is the flow having moved on by itself.
		this.page = null;
		this.app.setting.closePage();
	}
}
