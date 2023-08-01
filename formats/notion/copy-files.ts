import { readFile } from 'fs/promises';
import { ImportResult } from 'main';
import moment from 'moment';
import { App, normalizePath } from 'obsidian';
import { assembleParentIds, parseDate } from './notion-utils';
import {
	createFolderStructure,
	escapeRegex,
	getParentFolder,
} from '../../util';

export async function copyFiles({
	idsToFileInfo,
	pathsToAttachmentInfo,
	targetFolderPath,
	app,
	results,
}: {
	idsToFileInfo: Record<string, NotionFileInfo>;
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
	targetFolderPath: string;
	app: App;
	results: ImportResult;
}) {
	const flatFolderPaths = new Set<string>([targetFolderPath]);

	const allFolderPaths = Object.values(idsToFileInfo)
		.map(
			(fileInfo) =>
				targetFolderPath +
				assembleParentIds(fileInfo, idsToFileInfo).join('')
		)
		.concat(
			Object.values(pathsToAttachmentInfo).map(
				(attachmentInfo) => attachmentInfo.parentFolderPath
			)
		);

	for (let folderPath of allFolderPaths) {
		flatFolderPaths.add(folderPath);
	}

	await createFolderStructure(flatFolderPaths, app);

	await Promise.all(
		Object.entries(idsToFileInfo)
			.map(
				([_id, fileInfo]) =>
					new Promise(async (resolve) => {
						try {
							const path = `${targetFolderPath}${assembleParentIds(
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
								const data = await readFile(path);
								await app.vault.adapter.writeBinary(
									`${attachmentInfo.parentFolderPath}${attachmentInfo.nameWithExtension}`,
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
