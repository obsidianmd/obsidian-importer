import { App, PluginSettingTab, Setting } from 'obsidian';
import { ImporterFlow, ImporterShell } from './importer-flow';
import type ImporterPlugin from './main';

/**
 * The import flow as a settings tab: the same screens the modal shows, for a
 * user who reaches the plugin through Settings rather than the ribbon.
 */
export class ImporterSettingTab extends PluginSettingTab implements ImporterShell {
	plugin: ImporterPlugin;
	flow: ImporterFlow;

	/** Built by display(), under the heading the flow retitles per screen. */
	contentEl: HTMLElement;

	/** Set in display(), not in a field initializer. */
	private heading: Setting | null;

	/**
	 * The heading is rebuilt every time the tab is opened, and a screen only
	 * titles itself when it is drawn: the progress it comes back to would
	 * otherwise sit under a blank heading.
	 */
	private title: string = '';

	constructor(app: App, plugin: ImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.flow = new ImporterFlow(app, plugin, this);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.addClass('importer-flow');

		this.heading = new Setting(containerEl).setHeading().setName(this.title);
		this.contentEl = containerEl.createDiv();

		this.flow.attach();
	}

	hide(): void {
		this.flow.detach();
	}

	setTitle(title: string): void {
		this.title = title;
		this.heading?.setName(title);
	}

	setPickingFormat(picking: boolean): void {
		this.containerEl.toggleClass('is-picking-format', picking);
	}

	finish(): void {
		this.app.setting.close();
	}

	foreground(): void {
		this.app.setting.open();
		this.app.setting.openTabById(this.plugin.manifest.id);
	}
}
