import { normalizePath, Notice, TFolder, Platform } from 'obsidian';
import { parseFilePath, NodePickedFolder, NodePickedFile, PickedFile, PickedFolder } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ProgressReporter } from '../main';
import { readZip, ZipEntryFile } from 'zip';

const assetMatcher = /!\[\]\(assets\/([^)]*)\)/g;

export class TextbundleImporter extends FormatImporter {
	private attachmentsFolderPath: TFolder;

	init() {
		if (!Platform.isMacOS) {
			this.modal.contentEl.createEl('p', {
				text:
					'Due to platform limitations, only textpack and zip files can be imported from this device.' +
					' Open your vault on a Mac to import textbundle files.'
			});
		}

		const formats = Platform.isMacOS
			? ['textbundle', 'textpack', 'zip']
			: ['textpack', 'zip'];

		this.addFileChooserSetting('Textbundle', formats, true);
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

		this.attachmentsFolderPath = await this.createFolders(`${folder.path}/assets`);

		for (let file of files) {
			if (file.extension === 'textpack') {
				await readZip(file, async (zip, entries) => {
					await this.process(progress, file.name, entries);
				});
			}
			else if (file.extension === 'zip') {
				await readZip(file, async (zip, entries) => {
					const textbundles = this.groupFilesByTextbundle(file.name, entries);
					for (const textbundle of textbundles) {
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

	groupFilesByTextbundle(zipName: string, entries: ZipEntryFile[]): ZipEntryFile[][] {
		const buckets: Record<string, ZipEntryFile[]> = {};
		const prefix = zipName + '/';
		const dotTextbundle = '.textbundle';
		for (const entry of entries) {
			if (!entry.fullpath.startsWith(prefix)) {
				console.log('Skipping', entry.fullpath);
				continue;
			}

			const path = entry.fullpath.slice(prefix.length);
			if (path.startsWith('._') || path.startsWith('__MACOSX')) {
				console.log('Skipping', entry.fullpath);
				continue;
			}

			const idx = path.indexOf(dotTextbundle);
			if (idx === -1) {
				console.log('Skipping', entry.fullpath);
				continue;
			}

			const textBundle = path.slice(0, idx) + '.textbundle';
			const rest = path.slice(idx + dotTextbundle.length + 1); // Skip the '.textbundle' and path separator

			if (rest.startsWith('._')) {
				console.log('Skipping', entry.fullpath);
				continue;
			}

			if (textBundle in buckets) {
				buckets[textBundle].push(entry);
			}
			else {
				buckets[textBundle] = [entry];
			}
		}

		return Object.values(buckets);
	}

	async process(progress: ProgressReporter, bundleName: string, entries: (PickedFile | PickedFolder | ZipEntryFile)[]) {
		// First look for the info.json and check that the file type is Markdown
		const infojson = entries.find((entry) => entry.name === 'info.json');
		if (infojson) {
			const text = await (infojson as NodePickedFile).readText();
			const parsed = JSON.parse(text);
			if (parsed.hasOwnProperty('type') && parsed.type !== 'net.daringfireball.markdown') {
				progress.reportSkipped(bundleName, 'The textbundle does not contain markdown');
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
						: bundleName;
					mdFilename = mdFilename.replace(/.textbundle$/, '');

					let mdContent = await (entry as NodePickedFile).readText();
					if (mdContent.match(assetMatcher)) {
						// Replace asset paths with new asset folder path.
						mdContent = mdContent.replace(assetMatcher, `![[${this.attachmentsFolderPath.path}/$1]]`);
					}
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
