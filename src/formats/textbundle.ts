import { normalizePath, Notice, TFolder, Platform } from 'obsidian';
import { parseFilePath, NodePickedFolder, NodePickedFile, PickedFile, PickedFolder } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { readZip, ZipEntryFile } from '../zip';
import { bundleNoteName, convertTextbundleNote, groupFilesByTextbundle, isMarkdownBundle } from './textbundle/convert';

export class TextbundleImporter extends FormatImporter {
	private attachmentsFolderPath: TFolder;

	init() {
		if (!Platform.isMacOS) {
			this.draw(contentEl => contentEl.createEl('p', {
				text:
					'Due to platform limitations, only textpack and zip files can be imported from this device.' +
					' Open your vault on a Mac to import textbundle files.'
			}));
		}

		const formats = Platform.isMacOS
			? ['textbundle', 'textpack', 'zip']
			: ['textpack', 'zip'];

		this.addFileChooserSetting('Textbundle', formats, true);
		this.addOutputLocationSetting('Textbundle');
	}

	async import(progress: ImportContext): Promise<void> {
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

		this.attachmentsFolderPath = await this.createFolders(`${folder.path}/assets`);

		for (let file of files) {
			if (await progress.shouldStop()) return;

			if (file.extension === 'textpack') {
				await readZip(file, async (zip, entries) => {
					await this.process(progress, file.name, entries);
				});
			}
			else if (file.extension === 'zip') {
				await readZip(file, async (zip, entries) => {
					const textbundles = groupFilesByTextbundle(file.name, entries);
					for (const textbundle of textbundles) {
						if (await progress.shouldStop()) return;
						await this.process(progress, file.name, textbundle);
					}
				});
			}
			else {
				let textbundleFolder = new NodePickedFolder(`${file.toString()}/`);
				let entries = await textbundleFolder.list();
				await this.process(progress, file.name, entries);
			}
		}
	}

	async process(progress: ImportContext, bundleName: string, entries: (PickedFile | PickedFolder | ZipEntryFile)[]) {
		// First look for the info.json and check that the file type is Markdown
		const infojson = entries.find((entry) => entry.name === 'info.json');
		if (infojson && !isMarkdownBundle(await (infojson as NodePickedFile).readText())) {
			progress.reportSkipped(bundleName, 'The textbundle does not contain markdown');
			return;
		}

		for (let entry of entries) {
			if (await progress.shouldStop()) return;

			if (entry.name.startsWith('._')) {
				// We don't need to notify users that we're skipping these hidden files.
				// progress.reportSkipped(entry.name, 'skipping system file.');
				continue;
			}

			try {
				if (entry.type === 'file' && (entry.extension === 'md' || entry.extension === 'markdown')) {
					const mdFilename = bundleNoteName('parent' in entry ? entry.parent : bundleName);

					const mdContent = convertTextbundleNote(
						await (entry as NodePickedFile).readText(),
						this.attachmentsFolderPath.path);
					let filePath = normalizePath(mdFilename);
					const outputFolder = await this.getOutputFolder();
					// We already asserted previously that the result from getOutputFolder is not null.
					await this.saveAsMarkdownFile(outputFolder!, filePath, mdContent);
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

	async importAsset(progress: ImportContext, entry: PickedFile | PickedFolder | ZipEntryFile): Promise<void> {
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
