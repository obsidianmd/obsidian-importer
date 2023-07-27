import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import { FileSystemAdapter, Notice } from 'obsidian';
import { processFile } from './notion/importer';
import { escapeRegex, getParentFolder, stripFileExtension } from '../util';

export class NotionImporter extends FormatImporter {
	init() {
		this.addFolderChooserSetting('Notion HTML export folder', ['html']);

		this.fileLocationSetting?.settingEl.toggle(false);
		this.folderLocationSetting?.settingEl.toggle(true);

		this.addOutputLocationSetting('Notion');
	}

	async import(): Promise<void> {
		let { filePaths } = this;

		if (filePaths.length === 0) {
			new Notice('Please pick at least one folder to import.');
			return;
		}

		const folderHTML = this.folderLocationSetting.descEl.innerHTML;
		const folderPaths = folderHTML
			.match(/<span class="u-pop">.*?<\/span>/g)
			.map(
				(folder) => folder.match(/<span class="u-pop">(.*?)<\/span>/)[1]
			);
		const folderPathsReplacement = new RegExp(
			folderPaths
				.map((folderPath) => '^' + escapeRegex(folderPath) + '/')
				.join('|')
		);

		let { app } = this;
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		let results: ImportResult = {
			total: 0,
			skipped: 0,
			failed: 0,
		};

		const idsToFileInfo: Record<string, NotionFileInfo> = {};
		const hrefsToAttachmentInfo: Record<string, NotionAttachmentInfo> = {};

		await Promise.all(
			filePaths.map(
				(filePath) =>
					new Promise(async (resolve, reject) => {
						try {
							const normalizedFilePath = filePath.replace(
								folderPathsReplacement,
								''
							);
							const text = await this.readPath(filePath);
							const { id, fileInfo, attachments } = processFile({
								text,
								filePath,
								normalizedFilePath,
							});
							for (let [path, attachmentInfo] of Object.entries(
								attachments
							))
								hrefsToAttachmentInfo[path] = attachmentInfo;

							idsToFileInfo[id] = fileInfo;
							resolve(true);
						} catch (e) {
							console.error(e);
							results.failed++;
							reject(e);
						}
					})
			)
		);

		// Instead of a target path, have it so that it's just a title and a LIST of parent IDs

		const pathDuplicateChecks = new Set<string>();
		const titleDuplicateChecks = new Set<string>(
			app.vault.getAllLoadedFiles().map((file) => file.name)
		);

		for (let [_id, fileInfo] of Object.entries(idsToFileInfo)) {
			let pathDuplicateCheck = `${fileInfo.parentIds.join('/')}/${
				fileInfo.title
			}`;
			console.log(pathDuplicateCheck, new Set([...pathDuplicateChecks]));

			if (pathDuplicateChecks.has(pathDuplicateCheck)) {
				let duplicateResolutionIndex = 2;
				while (
					pathDuplicateChecks.has(
						`${pathDuplicateCheck} ${duplicateResolutionIndex}`
					)
				) {
					duplicateResolutionIndex++;
				}
				fileInfo.title = `${fileInfo.title} ${duplicateResolutionIndex}`;
			}

			if (titleDuplicateChecks.has(fileInfo.title)) {
				fileInfo.fullLinkPathNeeded = true;
			}

			pathDuplicateChecks.add(
				`${fileInfo.parentIds.join('/')}/${fileInfo.title}`
			);
			titleDuplicateChecks.add(fileInfo.title);
		}

		console.log(idsToFileInfo, hrefsToAttachmentInfo);

		this.showResult(results);
	}
}
