import { normalizePath, Notice, TFolder, Platform } from 'obsidian';
import { parseFilePath, NodePickedFolder, NodePickedFile, PickedFile, PickedFolder } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { readZip, ZipEntryFile } from '../zip';
import { bundleNoteName, convertTextbundleNote, groupFilesByTextbundle, isMarkdownBundle } from './textbundle/convert';

export class TextbundleImporter extends FormatImporter {
	// A .textbundle is a folder everywhere but macOS, where it is a package the
	// file picker hands over whole.
	static extensions = Platform.isMacOS
		? ['textbundle', 'textpack', 'zip']
		: ['textpack', 'zip'];

	interruption = 'pause' as const;

	private attachmentsFolderPath: TFolder;

	init() {
		if (!Platform.isMacOS) {
			this.draw(contentEl => contentEl.createEl('p', {
				text: i18n.importer.textbundle.msgPlatform(),
			}), 'source');
		}

		this.addFileChooserSetting(i18n.importer.textbundle.fileType(), TextbundleImporter.extensions, true);
		this.defaultOutputFolder = 'Textbundle';
	}

	async import(progress: ImportContext): Promise<void> {
		let { files } = this;
		if (files.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		const attachmentProbe = await this.getAvailablePathForAttachment('attachment', [], `${folder.path}/Textbundle.md`);
		this.attachmentsFolderPath = await this.createFolders(parseFilePath(attachmentProbe).parent);

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
			progress.reportSkipped(bundleName, i18n.importer.textbundle.reasonNoMarkdown());
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
					const { written } = await this.writeNote(progress, outputFolder!, filePath, mdContent);
					if (written) progress.reportNoteSuccess(mdFilename);
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
					progress.reportSkipped(entry.name, i18n.importer.textbundle.reasonNotMedia());
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

		let assetFileVaultPath = normalizePath(`${this.attachmentsFolderPath.path}/${entry.name}`);
		let existingFile = this.vault.getAbstractFileByPath(assetFileVaultPath);
		if (existingFile) {
			progress.reportSkipped(entry.name, i18n.importer.textbundle.reasonAlreadyExists());
			return;
		}

		let assetData = await entry.read();
		await this.vault.createBinary(assetFileVaultPath, assetData);
		progress.reportAttachmentSuccess(entry.name);
	}
}
