import { App, PluginSettingTab, Setting, SettingPage } from 'obsidian';
import { ImporterFlow, ImporterShell } from './importer-flow';
import type ImporterPlugin from './main';

/** One screen of an import, with the back button that leads out of it. */
class ImportPage extends SettingPage {
	constructor(private tab: ImporterSettingTab, title: string) {
		super();

		// The page is a sibling of the tab, not a child, so it needs the class
		// the flow's own styles hang off in its own right.
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

/**
 * The import flow as a settings tab: the format list is the tab itself, and
 * every screen from there is a page opened over it, the way Settings shows
 * anything with more behind it. Its back button walks them one at a time.
 */
export class ImporterSettingTab extends PluginSettingTab implements ImporterShell {
	plugin: ImporterPlugin;
	flow: ImporterFlow;

	/** Every page Settings opens comes with the way back out of it. */
	readonly ownsBackButton: boolean = true;

	readonly showsHelp: boolean = false;

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

	/** The pages open over the tab, one for each screen in front of it. */
	private pages: ImportPage[] = [];

	/** How deep the flow says it is, which is how many pages there should be. */
	private depth: number = 0;

	/** Whether the tab is the one Settings is showing. */
	private visible: boolean = false;

	/** Set between a page closing and the flow being told to step back. */
	private pendingBack: boolean = false;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.flow = new ImporterFlow(app, plugin, this);
	}

	/** Whichever is showing: the topmost page, or the tab under them all. */
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

		// A page just closed draws itself once the flow has stepped back to
		// what is behind it; drawing here would put the screen that closed
		// straight back on top.
		if (!this.pendingBack) this.flow.attach();
	}

	hide(): void {
		this.visible = false;
		this.flow.detach();
	}

	/**
	 * Settings drew a page. Only the page the flow is on has anything to put
	 * in it: the ones beneath are covered, and a screen that opened more than
	 * one page at once left those it passed empty on the way.
	 */
	drawInPage(page: ImportPage): void {
		if (page !== this.topPage() || this.pages.length !== this.depth) return;

		this.flow.redraw();
	}

	/** A page was closed. By its back button, unless the flow closed it. */
	pageClosed(page: ImportPage): void {
		if (page !== this.topPage()) return;

		this.pages.pop();
		const behind = this.pages.length;
		this.pendingBack = true;

		// Answered once Settings has finished with the page, both because
		// stepping back closes pages of its own and because what else went
		// with this one is how a step back is told from a teardown.
		queueMicrotask(() => {
			this.pendingBack = false;

			// The rest of the stack went too, or the tab did: Settings is
			// putting the whole thing away rather than going back through it,
			// and the flow keeps the screen it was on to be returned to.
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

	/** Open and close pages until there is one for every screen so far. */
	private showPages(title: string): void {
		while (this.pages.length > this.depth) {
			// Popped first: closing calls back into pageClosed, which is for
			// the back button, and this is the flow having moved by itself.
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

	/** A page outlives the screen in it: choosing a method retitles it. */
	private retitle(page: ImportPage, title: string): void {
		page.title = title;
		page.titlebarEl.querySelector('.setting-page-title')?.setText(title);
	}

	private topPage(): ImportPage | null {
		return this.pages[this.pages.length - 1] ?? null;
	}
}
