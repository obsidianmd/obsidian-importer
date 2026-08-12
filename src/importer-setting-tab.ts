import { App, PluginSettingTab, Setting, SettingPage } from 'obsidian';
import { FORMAT_LIST, ImporterFlow, ImporterShell } from './importer-flow';
import type ImporterPlugin from './main';

/**
 * Whether this Obsidian shows a page over a setting tab, with the back button
 * that leads out of it. Pages arrived in 1.13; on anything earlier the flow
 * falls back to drawing a Back button of its own.
 */
function hasPages(app: App): boolean {
	return typeof SettingPage === 'function' && typeof app.setting?.openPage === 'function';
}

/**
 * A page holding one import. Built by a function rather than declared as a
 * subclass so that nothing reads `SettingPage` on an Obsidian without one.
 */
function stepPage(tab: ImporterSettingTab, title: string): SettingPage {
	const page = new (class extends SettingPage {
		display(): void {
			tab.drawInPage();
		}

		hide(): void {
			tab.pageClosed(this);
		}
	})();

	// The page is a sibling of the tab, not a child, so it needs the class the
	// flow's own styles hang off in its own right.
	page.rootEl.addClass('importer-flow');
	page.title = title;
	return page;
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

	readonly combinesSteps: boolean;

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

	private page: SettingPage | null = null;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.combinesSteps = hasPages(app);
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
	pageClosed(page: SettingPage): void {
		if (this.page !== page) return;

		this.page = null;
		this.flow.leave();
	}

	setScreen(depth: number, title: string): void {
		this.title = title;

		if (!this.combinesSteps) {
			this.heading?.setName(title);
			return;
		}

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
		const page = this.page = stepPage(this, title);
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
