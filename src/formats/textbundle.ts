import { normalizePath, Notice, TFolder, Platform } from 'obsidian';
import { parseFilePath, NodePickedFolder, NodePickedFile, PickedFile, PickedFolder } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';
import { readZip, ZipEntryFile } from 'zip';

const assetMatcher = /!\[\]\(assets\/([^)]*)\)/g;

export class TextbundleImporter extends FormatImporter {
	private outputFolder: TFolder;
	private attachmentsFolderPath: TFolder;

	init() {
		if (!Platform.isMacOS) {
			this.modal.contentEl.createEl('p', {
				text:
					'Due to platform limitations, only textpack files can be imported from this device.' +
					' Open your vault on a Mac to import textbundle files.'
			});
		}

		this.addFileChooserSetting('Textbundle',
			Platform.isMacOS
				? ['textbundle', 'textpack']
				: ['textpack']);
		this.addOutputLocationSetting('Textbundle');
	}

	async import(progress: ProgressReporter): Promise<void> {
		let { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		this.outputFolder = folder;
		this.attachmentsFolderPath = await this.createFolders(`${folder.path}/assets`);

		for (let file of files) {
			if (file.extension === 'textpack') {
				await readZip(file, async (zip, entries) => {
					await this.process(progress, file, entries);
				});
			}
			else {
				let textbundleFolder = new NodePickedFolder(`${file.toString()}/`);
				let entries = await textbundleFolder.list();
				await this.process(progress, file, entries);
			}
		}
	}

	async process(progress: ProgressReporter, file: PickedFile, entries: (PickedFile | PickedFolder | ZipEntryFile)[]) {
		// First look for the info.json and check that the file type is Markdown
		const infojson = entries.find((entry) => entry.name === 'info.json');
		if (infojson) {
			const text = await (infojson as NodePickedFile).readText();
			const parsed = JSON.parse(text);
			if (parsed.hasOwnProperty('type') && parsed.type !== 'net.daringfireball.markdown') {
				progress.reportSkipped(file.name, 'The textbundle does not contain markdown');
				return;
			}
		}

		for (let entry of entries) {
			if (entry.name.startsWith('._')) {
				// We don't need to notify users that we're skipping these hidden files.
				// progress.reportSkipped(entry.name, 'skipping system file.');
				continue;
			}

			try {
				if (entry.type === 'file' && (entry.extension === 'md' || entry.extension === 'markdown')) {
					let mdFilename = 'parent' in entry
						? entry.parent
						: file.name;
					mdFilename = mdFilename.replace(/.textbundle$/, '');

					let mdContent = await (entry as NodePickedFile).readText();
					if (mdContent.match(assetMatcher)) {
						// Replace asset paths with new asset folder path.
						mdContent = mdContent.replace(assetMatcher, `![[${this.attachmentsFolderPath.path}/$1]]`);
					}
					let filePath = normalizePath(mdFilename);
					await this.saveAsMarkdownFile(this.outputFolder, filePath, mdContent);
					progress.reportNoteSuccess(mdFilename);
				}
				else if (entry.type === 'file' && entry.fullpath.contains('assets/')) {
					await this.importAsset(progress, entry);
				}
				else if (entry.type === 'folder') {
					let { basename } = parseFilePath(entry.toString());
					if (basename !== 'assets') {
						continue;
					}

					let assetFolder = new NodePickedFolder(`${entry.toString()}/`);
					let entries = await assetFolder.list();
					for (let entry of entries) {
						await this.importAsset(progress, entry);
					}
				}
				else if (entry.name !== 'info.json') {
					progress.reportSkipped(entry.name, 'the file is not a media or markdown file.');
				}
			}
			catch (e) {
				progress.reportFailed(entry.name, e);
			}
		}
	}

	async importAsset(progress: ProgressReporter, entry: PickedFile | PickedFolder | ZipEntryFile): Promise<void> {
		if (entry.type === 'folder') {
			progress.reportSkipped(entry.name);
			return;
		}

		let assetFileVaultPath = `${this.attachmentsFolderPath.path}/${entry.name}`;
		let existingFile = this.vault.getAbstractFileByPath(assetFileVaultPath);
		if (existingFile) {
			progress.reportSkipped(entry.name, 'the file already exists.');
		}

		let assetData = await entry.read();
		await this.vault.createBinary(assetFileVaultPath, assetData);
		progress.reportAttachmentSuccess(entry.name);
	}
}
