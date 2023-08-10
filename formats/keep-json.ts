import { DataWriteOptions, Notice, Setting, TFile, TFolder } from 'obsidian';
import { PickedFile } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';
import { readZip } from '../zip/util';
import { convertStringToKeepJson, KeepJson } from './keep/models';
import { addAliasToFrontmatter, addTagToFrontmatter, convertJsonToMd, toSentenceCase } from './keep/util';


const BUNDLE_EXTS = ['zip'];
const NOTE_EXTS = ['json'];
// Google Keep supports attachment formats that might change and exports in the original format uploaded, so limiting to binary formats Obsidian supports
const ATTACHMENT_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mpg', 'm4a', 'webm', 'wav', 'ogv', '3gp', 'mov', 'mp4', 'mkv', 'pdf'];


export class KeepImporter extends FormatImporter {
	importArchivedSetting: Setting;
	importTrashedSetting: Setting;
	importArchived: boolean = false;
	importTrashed: boolean = false;

	init() {
		this.modal.contentEl.createEl('h3', { text: 'Supported features' });
		const listEl = this.modal.contentEl.createEl('ul');
		listEl.createEl('li', {
			text: 'All checklists will import as first level items as Google Keep doesn\'t export indentation information.',
		});
		listEl.createEl('li', {
			text: 'Reminders and user assignments on notes won\'t import as they are not supported by Obsidian.',
		});
		listEl.createEl('li', {
			text: 'All other information should import as a combination of content and tags.',
		});

		this.modal.contentEl.createEl('h3', { text: 'Exporting from Google Keep' });
		const firstParaEl = this.modal.contentEl.createEl('p', {
			text: 'To export your files from Google Keep, open ',
		});
		firstParaEl.createEl('a', {
			text: 'Google Takeout',
			href: 'https://takeout.google.com/',
		});
		firstParaEl.appendText(' and select only Google Keep files. Once you have the exported zip, you can import it directly below or unzip it and select individual files.');

		this.modal.contentEl.createEl('h2', { text: 'Prepare your import' });

		this.addFileChooserSetting('Notes & attachments', [...BUNDLE_EXTS, ...NOTE_EXTS, ...ATTACHMENT_EXTS], true);

		this.importArchivedSetting = new Setting(this.modal.contentEl)
			.setName('Import archived notes')
			.setDesc('If imported, files archived in Google Keep will be tagged as archived.')
			.addToggle(toggle => {
				toggle.setValue(this.importArchived);
				toggle.onChange(async (value) => {
					this.importArchived = value;
				});
			});

		this.importTrashedSetting = new Setting(this.modal.contentEl)
			.setName('Import deleted notes')
			.setDesc('If imported, files deleted in Google Keep will be tagged as deleted. Deleted notes will only exist in your Google export if deleted recently.')
			.addToggle(toggle => {
				toggle.setValue(this.importTrashed);
				toggle.onChange(async (value) => {
					this.importTrashed = value;
				});
			});

		this.addOutputLocationSetting('Google Keep');

	}

	async import(progress: ProgressReporter): Promise<void> {
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
			let { fullpath, extension } = file;
			try {
				if (extension === 'zip') {
					await this.readZipEntries(file, folder, assetFolderPath, progress);
				}
				else if (extension === 'json') {
					await this.importKeepNote(file, folder, progress);
				}
				else if (ATTACHMENT_EXTS.contains(extension)) {
					await this.copyFile(file, assetFolderPath, progress);
				}
				else {
					progress.reportSkipped(fullpath);
				}
			}
			catch (e) {
				progress.reportFailed(fullpath, e);
			}
		}

	}

	async readZipEntries(file: PickedFile, folder: TFolder, assetFolderPath: string, progress: ProgressReporter) {
		await readZip(file, async (zip, entries) => {
			for (let entry of entries) {
				let { fullpath, extension } = file;
				try {
					if (extension === 'json') {
						await this.importKeepNote(entry, folder, progress);
					}
					else if (ATTACHMENT_EXTS.contains(extension)) {
						await this.copyFile(entry, assetFolderPath, progress);
					}
					else {
						progress.reportSkipped(fullpath);
					}
				}
				catch (e) {
					progress.reportFailed(fullpath, e);
				}
			}
		});
	}

	async importKeepNote(file: PickedFile, folder: TFolder, progress: ProgressReporter) {
		let { fullpath } = file;
		let content = await file.readText();
		let keepJson = convertStringToKeepJson(content);
		if (!keepJson) {
			progress.reportFailed(fullpath, 'Invalid Google Keep JSON');
			return;
		}
		if (keepJson.isArchived && !this.importArchived) {
			progress.reportSkipped(fullpath, 'Archived note');
			return;
		}
		if (keepJson.isTrashed && !this.importTrashed) {
			progress.reportSkipped(fullpath, 'Deleted note');
			return;
		}

		await this.convertKeepJson(keepJson, folder, file.basename);
		progress.reportNoteSuccess(fullpath);
	}

	// Keep assets have filenames that appear unique, so no duplicate handling isn't implemented
	async copyFile(file: PickedFile, folderPath: string, progress: ProgressReporter) {
		let assetFolder = await this.createFolders(folderPath);
		let data = await file.read();
		await this.vault.createBinary(`${assetFolder.path}/${file.name}`, data);
		progress.reportAttachmentSuccess(file.fullpath);
	}

	async convertKeepJson(keepJson: KeepJson, folder: TFolder, filename: string) {
		let mdContent = convertJsonToMd(keepJson);
		const fileRef = await this.saveAsMarkdownFile(folder, filename, mdContent);
		await this.addKeepFrontMatter(fileRef, keepJson);

		await this.modifyWriteOptions(fileRef, {
			ctime: keepJson.createdTimestampUsec / 1000,
			mtime: keepJson.userEditedTimestampUsec / 1000,
		});
	}

	async addKeepFrontMatter(fileRef: TFile, keepJson: KeepJson) {
		await this.app.fileManager.processFrontMatter(fileRef, (frontmatter: any) => {

			if (keepJson.title) addAliasToFrontmatter(frontmatter, keepJson.title);

			// Add in tags to represent Keep properties
			if (keepJson.color && keepJson.color !== 'DEFAULT') {
				let colorName = keepJson.color.toLowerCase();
				colorName = toSentenceCase(colorName);
				addTagToFrontmatter(frontmatter, `Keep/Color/${colorName}`);
			}
			if (keepJson.isPinned) addTagToFrontmatter(frontmatter, 'Keep/Pinned');
			if (keepJson.attachments) addTagToFrontmatter(frontmatter, 'Keep/Attachment');
			if (keepJson.isArchived) addTagToFrontmatter(frontmatter, 'Keep/Archived');
			if (keepJson.isTrashed) addTagToFrontmatter(frontmatter, 'Keep/Deleted');

			if (keepJson.labels) {
				for (let i = 0; i < keepJson.labels.length; i++) {
					addTagToFrontmatter(frontmatter, `Keep/Label/${keepJson.labels[i].name}`);
				}
			}
		});
	}

	/**
	 * Allows modifying the write options (such as creation and last edited date) without adding or removing anything to the file.
	 */
	async modifyWriteOptions(fileRef: TFile, writeOptions: DataWriteOptions) {
		await this.vault.append(fileRef, '', writeOptions);
	}
}
