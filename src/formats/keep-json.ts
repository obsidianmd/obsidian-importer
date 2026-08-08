import { Notice, TFolder } from 'obsidian';
import { PickedFile } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ATTACHMENT_EXTS, helpUrl } from '../constants';
import { ImportContext } from '../import-context';
import { readZip, ZipEntryFile } from '../zip';
import { KeepJson } from './keep/models';
import { convertKeepNote } from './keep/convert';


const HELP_PERMALINK = 'import/google-keep';

const BUNDLE_EXTS = ['zip'];
const NOTE_EXTS = ['json'];
// Ignore the following files:
// - Html duplicates
// - Another html summary
// - A text file with labels summary
const ZIP_IGNORED_EXTS = ['html', 'txt'];

export class KeepImporter extends FormatImporter {
	interruption = 'pause' as const;

	importArchived: boolean = false;
	importTrashed: boolean = false;

	init() {
		this.addSetting('source')
			?.setName('Export your data')
			.setDesc(createFragment(frag => {
				frag.appendText('Get your Google Keep data from Google Takeout. ');
				frag.createEl('a', { text: 'Learn more.', href: helpUrl(HELP_PERMALINK) });
			}))
			.addButton(button => button
				.setButtonText('Open')
				.onClick(() => window.open('https://takeout.google.com/settings/takeout')));

		this.addFileChooserSetting('Notes & attachments', [...BUNDLE_EXTS, ...NOTE_EXTS, ...ATTACHMENT_EXTS], true);

		this.addSetting()
			?.setName('Import archived notes')
			.setDesc('If imported, files archived in Google Keep will be tagged as archived.')
			.addToggle(toggle => {
				toggle.setValue(this.importArchived);
				toggle.onChange(async (value) => {
					this.importArchived = value;
				});
			});

		this.addSetting()
			?.setName('Import deleted notes')
			.setDesc('If imported, files deleted in Google Keep will be tagged as deleted. Deleted notes will only exist in your Google export if deleted recently.')
			.addToggle(toggle => {
				toggle.setValue(this.importTrashed);
				toggle.onChange(async (value) => {
					this.importTrashed = value;
				});
			});

		this.addOutputLocationSetting('Google Keep');

	}

	async import(ctx: ImportContext): Promise<void> {
		let { files } = this;

		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to import your files to.');
			return;
		}
		let assetFolderPath = `${folder.path}/Assets`;

		for (let file of files) {
			if (await ctx.shouldStop()) return;
			await this.handleFile(file, folder, assetFolderPath, ctx);
		}
	}

	async handleFile(file: PickedFile, folder: TFolder, assetFolderPath: string, ctx: ImportContext) {
		let { fullpath, name, extension } = file;
		ctx.status('Processing ' + name);
		try {
			if (extension === 'zip') {
				await this.readZipEntries(file, folder, assetFolderPath, ctx);
			}
			else if (extension === 'json') {
				await this.importKeepNote(file, folder, ctx);
			}
			else if (ATTACHMENT_EXTS.contains(extension)) {
				ctx.status('Importing attachment ' + name);
				await this.copyFile(file, assetFolderPath);
				ctx.reportAttachmentSuccess(fullpath);
			}
			// Don't mention skipped files when parsing zips, because
			else if (!(file instanceof ZipEntryFile) && !ZIP_IGNORED_EXTS.contains(extension)) {
				ctx.reportSkipped(fullpath);
			}
		}
		catch (e) {
			ctx.reportFailed(fullpath, e);
		}
	}

	async readZipEntries(file: PickedFile, folder: TFolder, assetFolderPath: string, ctx: ImportContext) {
		await readZip(file, async (zip, entries) => {
			for (let entry of entries) {
				if (await ctx.shouldStop()) return;
				await this.handleFile(entry, folder, assetFolderPath, ctx);
			}
		});
	}

	async importKeepNote(file: PickedFile, folder: TFolder, ctx: ImportContext) {
		let { fullpath, basename } = file;
		ctx.status('Importing note ' + basename);

		let content = await file.readText();

		const keepJson = JSON.parse(content) as KeepJson;
		if (!keepJson || !keepJson.userEditedTimestampUsec || !keepJson.createdTimestampUsec) {
			ctx.reportFailed(fullpath, 'Invalid Google Keep JSON');
			return;
		}
		if (keepJson.isArchived && !this.importArchived) {
			ctx.reportSkipped(fullpath, 'Archived note');
			return;
		}
		if (keepJson.isTrashed && !this.importTrashed) {
			ctx.reportSkipped(fullpath, 'Deleted note');
			return;
		}

		await this.convertKeepJson(keepJson, folder, basename);
		ctx.reportNoteSuccess(fullpath);
	}

	async copyFile(file: PickedFile, folderPath: string) {
		let assetFolder = await this.createFolders(folderPath);
		let data = await file.read();
		await this.createBinaryFile(assetFolder, file.name, data);
	}

	async convertKeepJson(keepJson: KeepJson, folder: TFolder, filename: string) {
		const { content, ctime, mtime } = convertKeepNote(keepJson, filename);
		await this.saveAsMarkdownFile(folder, filename, content, { ctime, mtime });
	}
}
