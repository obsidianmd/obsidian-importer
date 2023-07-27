import { FormatImporter } from 'format-importer';
import { ImportResult } from 'main';
import { FileSystemAdapter, Notice } from 'obsidian';
import { processFile } from './notion/importer';
import { escapeRegex } from '../util';

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

		const outputFolder = (await this.getOutputFolder()).path;

		const folderHTML = this.folderLocationSetting.descEl.innerHTML;
		const folderPaths = folderHTML
			.match(/<span class="u-pop">.*?<\/span>/g)
			.map(
				(folder) => folder.match(/<span class="u-pop">(.*?)<\/span>/)[1]
			);
		const folderPathsReplacement = new RegExp(
			folderPaths
				.map((folderPath) => '^' + escapeRegex(folderPath))
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

		await Promise.all(
			filePaths.map(
				(filePath) =>
					new Promise(async (resolve, reject) => {
						try {
							const destinationPath =
								outputFolder +
								filePath.replace(folderPathsReplacement, '');
							const text = await this.readPath(filePath);
							const [id, fileInfo] = processFile({
								text,
								filePath,
								destinationPath,
							});

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

		console.log(idsToFileInfo);
		console.log(
			'bodies',
			Object.values(idsToFileInfo).filter((page) => page.body)
		);
		console.log(
			'properties',
			Object.values(idsToFileInfo).filter((page) => page.properties)
		);

		this.showResult(results);
	}
}
