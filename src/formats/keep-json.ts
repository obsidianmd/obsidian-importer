import { Notice, TFolder } from 'obsidian';
import { PickedFile } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ATTACHMENT_EXTS, ImportContext } from '../main';
import { readZip, ZipEntryFile } from '../zip';
import { KeepJson } from './keep/models';
import { convertKeepNote } from './keep/convert';


const BUNDLE_EXTS = ['zip'];
const NOTE_EXTS = ['json'];
// Ignore the following files:
// - Html duplicates
// - Another html summary
// - A text file with labels summary
const ZIP_IGNORED_EXTS = ['html', 'txt'];

export class KeepImporter extends FormatImporter {
	importArchived: boolean = false;
	importTrashed: boolean = false;

	init() {
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
			if (ctx.isCancelled()) return;
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
				if (ctx.isCancelled()) return;
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

	// Keep assets have filenames that appear unique, so no duplicate handling isn't implemented
	async copyFile(file: PickedFile, folderPath: string) {
		let assetFolder = await this.createFolders(folderPath);
		let data = await file.read();
		await this.vault.createBinary(`${assetFolder.path}/${file.name}`, data);
	}

	async convertKeepJson(keepJson: KeepJson, folder: TFolder, filename: string) {
		const { content, ctime, mtime } = convertKeepNote(keepJson, filename);
		const file = await this.saveAsMarkdownFile(folder, filename, content);

		// Modifying the creation and modified timestamps without changing file contents.
		await this.vault.append(file, '', { ctime, mtime });
	}
}
