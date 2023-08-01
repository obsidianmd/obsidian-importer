import { readFile } from 'fs/promises';
import { ImportResult } from 'main';
import moment from 'moment';
import { App, normalizePath } from 'obsidian';
import { assembleParentIds, parseDate } from './notion-utils';
import { getParentFolder } from '../../util';

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
	const createdFolders = new Set<string>();

	await Promise.all(
		Object.entries(idsToFileInfo)
			.map(
				([_id, fileInfo]) =>
					new Promise(async (resolve) => {
						try {
							const parentTitles = assembleParentIds(
								fileInfo,
								idsToFileInfo
							);

							if (parentTitles.length > 0) {
								let createdFolder = '';
								for (let folder of parentTitles) {
									createdFolder += folder;
									if (!createdFolders.has(createdFolder)) {
										app.vault.createFolder(
											targetFolderPath +
												'/' +
												createdFolder
										);
										createdFolders.add(createdFolder);
									}
								}
							}
							const path = `${targetFolderPath}/${assembleParentIds(
								fileInfo,
								idsToFileInfo
							).join('')}${fileInfo.title}.md`;
							const file = await app.vault.create(
								path,
								fileInfo.body
							);
							if (fileInfo.yamlProperties) {
								await app.fileManager.processFrontMatter(
									file,
									(frontMatter) => {
										for (let property of fileInfo.yamlProperties) {
											if (
												moment.isMoment(
													property.content
												)
											) {
												frontMatter[property.title] =
													parseDate(property.content);
											} else {
												frontMatter[property.title] =
													property.content;
											}
										}
									}
								);
							}
							resolve(true);
						} catch (e) {
							console.error(e);
							results.failed.push(fileInfo.path);
							resolve(false);
						}
					})
			)
			.concat(
				Object.entries(pathsToAttachmentInfo).map(
					([path, attachmentInfo]) =>
						new Promise(async (resolve) => {
							try {
								const parentFolders = getParentFolder(
									attachmentInfo.path
								).split('/');

								let createdFolder = '';
								for (let folder of parentFolders) {
									createdFolder += folder + '/';
									if (!createdFolders.has(createdFolder)) {
										app.vault.createFolder(createdFolder);
										createdFolders.add(createdFolder);
									}
								}

								const data = await readFile(path);
								await app.vault.adapter.writeBinary(
									`${attachmentInfo.nameWithExtension}`,
									data
								);
								resolve(true);
							} catch (e) {
								console.error(e);
								results.failed.push(path);
								resolve(false);
							}
						})
				)
			)
	);
}
