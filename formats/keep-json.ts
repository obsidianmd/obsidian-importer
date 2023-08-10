import { BlobWriter, TextWriter } from '@zip.js/zip.js';
import { DataWriteOptions, Notice, Setting, TFile, TFolder } from 'obsidian';
import { parseFilePath, PickedFile } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';
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
			try {
				if (file.extension === 'zip') {
					await this.readZipEntries(file, folder, assetFolderPath, progress);

				}
				else if (file.extension === 'json') {
					let rawContent = await file.readText();
					await this.importKeepNote(rawContent, folder, file.basename, progress);

				}
				else {
					const arrayBuffer = await file.read();
					await this.copyFile(arrayBuffer, assetFolderPath, file.name, progress);
				}

			}
			catch (e) {
				progress.reportFailed(file.name, e);
			}
		}

	}

	async readZipEntries(file: PickedFile, folder: TFolder, assetFolderPath: string, progress: ProgressReporter) {
		await file.readZip(async zip => {
			for (let entry of await zip.getEntries()) {
				if (!entry || entry.directory || !entry.getData) return;
				let curInnerFilename = '';
				try {
					let innerFileProps = parseFilePath(entry.filename);
					curInnerFilename = innerFileProps.name;

					if (innerFileProps.extension === 'json') {
						let rawContent = await entry.getData(new TextWriter());
						await this.importKeepNote(rawContent, folder, innerFileProps.basename, progress);

					}
					else if (ATTACHMENT_EXTS.contains(innerFileProps.extension)) {
						const rawContent = await entry.getData(new BlobWriter());
						const arrayBuffer = await rawContent.arrayBuffer();
						await this.copyFile(arrayBuffer, assetFolderPath, innerFileProps.name, progress);
					}
					// else: Silently skip any other unsupported files in the zip

				}
				catch (e) {
					progress.reportFailed(`${file.name}/${curInnerFilename}`, e);
				}
			}
		});
	}

	async importKeepNote(rawContent: string, folder: TFolder, title: string, progress: ProgressReporter) {
		let keepJson = convertStringToKeepJson(rawContent);
		if (!keepJson) {
			progress.reportFailed(`${title}.json`, 'Invalid Google Keep JSON');
			return;
		}
		if (keepJson.isArchived && !this.importArchived) {
			progress.reportSkipped(`${title}.json`, 'Archived note');
			return;
		}
		if (keepJson.isTrashed && !this.importTrashed) {
			progress.reportSkipped(`${title}.json`, 'Deleted note');
			return;
		}

		await this.convertKeepJson(keepJson, folder, title);
		progress.reportNoteSuccess(`${title}.json`);
	}

	// Keep assets have filenames that appear unique, so no duplicate handling isn't implemented
	async copyFile(arrayBuffer: ArrayBuffer, folderPath: string, filename: string, progress: ProgressReporter) {
		let assetFolder = await this.createFolders(folderPath);
		await this.vault.createBinary(`${assetFolder.path}/${filename}`, arrayBuffer);
		progress.reportAttachmentSuccess(filename);
	}

	async convertKeepJson(keepJson: KeepJson, folder: TFolder, filename: string) {
		let mdContent = convertJsonToMd(keepJson);
		const fileRef = await this.saveAsMarkdownFile(folder, filename, mdContent);
		await this.addKeepFrontMatter(fileRef, keepJson);

		const writeOptions: DataWriteOptions = {
			ctime: keepJson.createdTimestampUsec / 1000,
			mtime: keepJson.userEditedTimestampUsec / 1000,
		};
		this.modifyWriteOptions(fileRef, writeOptions);
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
			;

		});
	}
}
