import { Notice, TFolder, ToggleComponent, DropdownComponent, Platform } from 'obsidian';
import { FormatImporter, NoteWritten } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { PickedFile } from '../filesystem';
import { TomboyCoreConverter, KeepTitleMode } from './tomboy/core';
import { os, path } from '../filesystem';

export class TomboyImporter extends FormatImporter {
	interruption = 'pause' as const;

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
				const homeDir = os.homedir();
				return path.join(homeDir, '.local', 'share', 'tomboy');
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
			return i18n.importer.tomboy.descFilesMac();
		}
		else if (Platform.isWin) {
			return i18n.importer.tomboy.descFilesWindows();
		}
		else if (Platform.isLinux) {
			return i18n.importer.tomboy.descFilesLinux();
		}
		return i18n.source.desc();
	}

	init() {
		this.todoEnabled = true;
		this.coreConverter = new TomboyCoreConverter();
		this.keepTitleMode = 'automatic';

		this.addFileChooserSetting(i18n.importer.tomboy.fileType(), ['note'], true, this.getOSSpecificDescription(), this.getDefaultTomboyPath());
		this.defaultOutputFolder = 'Tomboy';
		this.idProperty = 'tomboy-id';
		this.idLabel = i18n.importer.tomboy.labelId();

		this.addSetting()
			?.setName(i18n.importer.tomboy.nameTodo())
			.setDesc(i18n.importer.tomboy.descTodo())
			.addToggle((toggle: ToggleComponent) => {
				toggle.setValue(this.todoEnabled)
					.onChange((value: boolean) => this.todoEnabled = value);
			});

		this.addSetting()
			?.setName(i18n.importer.tomboy.nameKeepTitle())
			.setDesc(i18n.importer.tomboy.descKeepTitle())
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption('automatic', i18n.importer.tomboy.optionAutomatic())
					.addOption('yes', i18n.importer.tomboy.optionKeepTitles())
					.addOption('no', i18n.importer.tomboy.optionFilenameOnly())
					.setValue(this.keepTitleMode)
					.onChange((value: string) => this.keepTitleMode = value as KeepTitleMode);
			});
	}

	async import(ctx: ImportContext): Promise<void> {
		const { files } = this;
		if (files.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		this.coreConverter.setTodoEnabled(this.todoEnabled);
		this.coreConverter.setKeepTitleMode(this.keepTitleMode);

		ctx.reportProgress(0, files.length);
		for (let i = 0; i < files.length; i++) {
			if (await ctx.shouldStop()) return;

			const file = files[i];
			ctx.status(i18n.common.statusProcessing({ name: file.name }));
			try {
				const { written } = await this.processFile(ctx, folder, file);
				if (written) ctx.reportNoteSuccess(file.fullpath);
			}
			catch (e) {
				ctx.reportFailed(file.fullpath, e);
			}

			ctx.reportProgress(i + 1, files.length);
		}
	}

	private async processFile(ctx: ImportContext, folder: TFolder, file: PickedFile): Promise<NoteWritten> {
		const xmlContent = await file.readText();

		const tomboyNote = this.coreConverter.parseTomboyXML(xmlContent);
		const markdownContent = this.coreConverter.convertToMarkdown(tomboyNote);

		return await this.writeNote(ctx, folder, tomboyNote.title, markdownContent, { sourceId: file.basename });
	}
}
