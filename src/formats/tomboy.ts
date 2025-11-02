import { Notice, Setting, ToggleComponent, DropdownComponent, Platform } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { TomboyCoreConverter, KeepTitleMode } from './tomboy/core';
import { os, path, fsPromises } from '../filesystem';

export class TomboyImporter extends FormatImporter {
	private coreConverter: TomboyCoreConverter;
	private todoEnabled: boolean;
	private keepTitleMode: KeepTitleMode;

	/**
	 * Get the default Tomboy/Gnote directory path based on the current OS
	 */
	private getDefaultTomboyPath(): string {
		if (!Platform.isDesktopApp || !os || !path) {
			return '';
		}

		try {
			if (Platform.isMacOS) {
				const macPath = path.join(os.homedir(), 'Library', 'Application Support', 'Tomboy');
				return macPath;
			}
			else if (Platform.isWin) {
				const windowsPath = path.join(process.env.APPDATA || '', 'Roaming', 'Tomboy');
				return windowsPath;
			}
			else if (Platform.isLinux) {
				// Check for both Tomboy and Gnote on Linux
				const homeDir = os.homedir();
				const tomboyPath = path.join(homeDir, '.local', 'share', 'tomboy');
				const gnotePath = path.join(homeDir, '.local', 'share', 'gnote');
				
				// Return whichever exists, preferring Gnote since it is the newer SW
				try {
					if (fsPromises && fsPromises.access) {
						// Check if gnote directory exists
						fsPromises.access(gnotePath).then(() => {}).catch(() => {});
						return gnotePath;
					}
				}
				catch (e) {
					// If we can't check, default to tomboy path
				}
				return tomboyPath;
			}
		}
		catch (e) {
			console.warn('Error detecting default Tomboy path:', e);
		}
		
		return '';
	}

	/**
	 * Get descriptive text for OS-specific Tomboy/Gnote locations
	 */
	private getOSSpecificDescription(): string {
		if (Platform.isMacOS) {
			return 'Tomboy notes are typically found in: ~/Library/Application Support/Tomboy';
		}
		else if (Platform.isWin) {
			return 'Tomboy notes are typically found in: %APPDATA%\\Tomboy';
		}
		else if (Platform.isLinux) {
			return 'Tomboy notes are typically found in: ~/.local/share/tomboy or ~/.local/share/gnote';
		}
		return 'Pick the files that you want to import.';
	}

	init() {
		this.todoEnabled = true;
		this.coreConverter = new TomboyCoreConverter();
		this.keepTitleMode = 'automatic';

		this.addFileChooserSetting('Tomboy/Gnote', ['note'], true, this.getOSSpecificDescription(), this.getDefaultTomboyPath());
		this.addOutputLocationSetting('Tomboy import');

		new Setting(this.modal.contentEl)
			.setName('Convert TODO lists to checkboxes')
			.setDesc('When enabled, lists in notes with "TODO" in the title will be converted to task lists with checkboxes. Strikethrough items will be marked as completed.')
			.addToggle((toggle: ToggleComponent) => {
				toggle.setValue(this.todoEnabled)
					  .onChange((value: boolean) => this.todoEnabled = value);
			});

		new Setting(this.modal.contentEl)
			.setName('Keep title in markdown')
			.setDesc('Choose whether to keep the note title in the markdown content. "Automatic" keeps titles only when special characters are lost in filename conversion.')
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption('automatic', 'Automatic')
					.addOption('yes', 'Yes')
					.addOption('no', 'No')
					.setValue(this.keepTitleMode)
					.onChange((value: string) => this.keepTitleMode = value as KeepTitleMode);
			});
	}

	async import(ctx: ImportContext): Promise<void> {
		const { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		ctx.reportProgress(0, files.length);
		for (let i = 0; i < files.length; i++) {
			if (ctx.isCancelled()) return;

			const file = files[i];
			ctx.status('Processing ' + file.name);
			try {
				await this.processFile(ctx, folder, file);
				ctx.reportNoteSuccess(file.fullpath);
			}
			catch (e) {
				ctx.reportFailed(file.fullpath, e);
			}

			ctx.reportProgress(i + 1, files.length);
		}
	}

	private async processFile(ctx: ImportContext, folder: any, file: any): Promise<void> {
		const xmlContent = await file.readText();
		this.coreConverter.setTodoEnabled(this.todoEnabled);
		this.coreConverter.setKeepTitleMode(this.keepTitleMode);

		const tomboyNote = this.coreConverter.parseTomboyXML(xmlContent);
		const markdownContent = this.coreConverter.convertToMarkdown(tomboyNote);

		await this.saveAsMarkdownFile(folder, tomboyNote.title, markdownContent);
	}
}
