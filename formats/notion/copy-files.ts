import { readFile } from 'fs/promises';
import { ImportResult } from 'main';
import { moment } from 'obsidian';
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

	for (let id of Object.keys(idsToFileInfo)) {
		const fileInfo = idsToFileInfo[id];
		try {
			const path = `${targetFolderPath}${assembleParentIds(
				fileInfo,
				idsToFileInfo
			).join('')}${fileInfo.title}.md`;
			const file = await app.vault.create(path, fileInfo.markdownBody);
			if (fileInfo.yamlProperties) {
				await app.fileManager.processFrontMatter(
					file,
					(frontMatter) => {
						for (let property of fileInfo.yamlProperties) {
							if (moment.isMoment(property.content)) {
								frontMatter[property.title] = parseDate(
									property.content
								);
							} else {
								frontMatter[property.title] = property.content;
							}
						}
					}
				);
			}
		} catch (e) {
			console.error(e);
			results.failed.push(fileInfo.path);
		}
	}

	for (let path of Object.keys(pathsToAttachmentInfo)) {
		const attachmentInfo = pathsToAttachmentInfo[path];
		try {
			const data = await readFile(path);
			await app.vault.adapter.writeBinary(
				`${attachmentInfo.parentFolderPath}${attachmentInfo.nameWithExtension}`,
				data
			);
		} catch (e) {
			console.error(e);
			results.failed.push(path);
		}
	}
}
