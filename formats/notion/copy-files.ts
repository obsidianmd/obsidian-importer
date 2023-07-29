import { FormatImporter } from 'format-importer';
import { App, normalizePath, htmlToMarkdown } from 'obsidian';
import * as fs from 'fs';
import { ImportResult } from 'main';

export async function copyFiles({
	idsToFileInfo,
	pathsToAttachmentInfo,
	attachmentFolderPath,
	targetFolderPath,
	app,
	results,
}: {
	idsToFileInfo: Record<string, NotionFileInfo>;
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
	attachmentFolderPath: string;
	targetFolderPath: string;
	app: App;
	results: ImportResult;
}) {
	const normalizedAttachmentFolder = normalizePath(attachmentFolderPath);

	const createdFolders = new Set<string>();
	await Promise.all(
		Object.entries(idsToFileInfo)
			.map(
				([_id, fileInfo]) =>
					new Promise(async (resolve, reject) => {
						try {
							const parentTitles = fileInfo.parentIds.map(
								(parentId) => idsToFileInfo[parentId].title
							);

							if (parentTitles.length > 0) {
								let createdFolder = '';
								for (let folder of parentTitles) {
									createdFolder += '/' + folder;
									if (!createdFolders.has(createdFolder)) {
										app.vault.createFolder(
											targetFolderPath + createdFolder
										);
										createdFolders.add(createdFolder);
									}
								}
							}
							const path = `${targetFolderPath}/${parentTitles
								.map((parent) => parent + '/')
								.join('')}${fileInfo.title}.md`;
							const file = await app.vault.create(
								path,
								fileInfo.body
							);
							if (fileInfo.yamlProperties) {
								await app.fileManager.processFrontMatter(
									file,
									(frontMatter) => {
										for (let property of fileInfo.yamlProperties) {
											frontMatter[property.title] =
												property.content;
										}
									}
								);
							}
							resolve(true);
						} catch (e) {
							console.error(e);
							results.failed++;
							reject(e);
						}
					})
			)
			.concat(
				Object.entries(pathsToAttachmentInfo).map(
					([path, attachmentInfo]) =>
						new Promise(async (resolve, reject) => {
							try {
								const data = fs.readFileSync(path);
								await app.vault.adapter.writeBinary(
									`${normalizedAttachmentFolder}${attachmentInfo.nameWithExtension}`,
									data
								);
								resolve(true);
							} catch (e) {
								console.error(e);
								results.failed++;
								reject(e);
							}
						})
				)
			)
	);
}
