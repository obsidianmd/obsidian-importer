import { App, normalizePath, TAbstractFile } from 'obsidian';
import { parseFilePath } from '../../filesystem';
import { assembleParentIds, parseAttachmentFolderPath } from './notion-utils';

export function cleanDuplicates({
	idsToFileInfo,
	pathsToAttachmentInfo,
	attachmentFolderPath,
	app,
	targetFolderPath,
	parentsInSubfolders,
}: {
	idsToFileInfo: Record<string, NotionFileInfo>;
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
	attachmentFolderPath: string;
	app: App;
	targetFolderPath: string;
	parentsInSubfolders: boolean;
}) {
	const loadedFiles = app.vault.getAllLoadedFiles();
	const pathDuplicateChecks = new Set<string>();
	const titleDuplicateChecks = new Set<string>(
		loadedFiles.map((file) => file.name)
	);

	if (parentsInSubfolders) {
		moveParentsToSubfolders({
			idsToFileInfo,
			pathsToAttachmentInfo,
		});
	}

	cleanDuplicateNotes({
		pathDuplicateChecks,
		titleDuplicateChecks,
		idsToFileInfo,
	});

	cleanDuplicateAttachments({
		loadedFiles,
		pathsToAttachmentInfo,
		titleDuplicateChecks,
		attachmentFolderPath,
		targetFolderPath,
		idsToFileInfo,
	});
}

function cleanDuplicateNotes({
	idsToFileInfo,
	pathDuplicateChecks,
	titleDuplicateChecks,
}: {
	idsToFileInfo: Record<string, NotionFileInfo>;
	pathDuplicateChecks: Set<string>;
	titleDuplicateChecks: Set<string>;
}) {
	for (let fileInfo of Object.values(idsToFileInfo)) {
		if (
			pathDuplicateChecks.has(
				`${assembleParentIds(fileInfo, idsToFileInfo).join('')}${
					fileInfo.title
				}`
			)
		) {
			let duplicateResolutionIndex = 2;
			fileInfo.title = fileInfo.title + ' ' + duplicateResolutionIndex;
			while (
				pathDuplicateChecks.has(
					`${assembleParentIds(fileInfo, idsToFileInfo).join('')}${
						fileInfo.title
					}`
				)
			) {
				duplicateResolutionIndex++;
				fileInfo.title = `${fileInfo.title.replace(
					/ \d+$/,
					''
				)} ${duplicateResolutionIndex}`;
			}
		}

		if (titleDuplicateChecks.has(fileInfo.title + '.md')) {
			fileInfo.fullLinkPathNeeded = true;
		}

		pathDuplicateChecks.add(
			`${assembleParentIds(fileInfo, idsToFileInfo).join('')}${
				fileInfo.title
			}`
		);
		titleDuplicateChecks.add(fileInfo.title + '.md');
	}
}

function moveParentsToSubfolders({
	idsToFileInfo,
	pathsToAttachmentInfo,
}: {
	idsToFileInfo: Record<string, NotionFileInfo>;
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
}) {
	const notesByLastParent = new Set(
		(Object.values(idsToFileInfo) as Pick<NotionFileInfo, 'parentIds'>[])
			.concat(
				Object.values(pathsToAttachmentInfo) as Pick<
					NotionAttachmentInfo,
					'parentIds'
				>[]
			)
			.map((fileInfo) =>
				fileInfo.parentIds.length > 0
					? fileInfo.parentIds[fileInfo.parentIds.length - 1]
					: ''
			)
	);
	for (let id of Object.keys(idsToFileInfo)) {
		if (notesByLastParent.has(id)) {
			// Nest any notes with children under the same subfolder, this supports Folder Note plugins in Obsidian
			idsToFileInfo[id].parentIds.push(id);
		}
	}
}

function cleanDuplicateAttachments({
	loadedFiles,
	pathsToAttachmentInfo,
	idsToFileInfo,
	titleDuplicateChecks,
	attachmentFolderPath,
	targetFolderPath,
}: {
	loadedFiles: TAbstractFile[];
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
	idsToFileInfo: Record<string, NotionFileInfo>;
	titleDuplicateChecks: Set<string>;
	attachmentFolderPath: string;
	targetFolderPath: string;
}) {
	const attachmentPaths = new Set(
		loadedFiles
			.filter((file) => !file.path.endsWith('.md'))
			.map((file) => file.path)
	);

	const { attachmentsInCurrentFolder, attachmentSubfolder } =
		parseAttachmentFolderPath(attachmentFolderPath);

	for (let attachmentInfo of Object.values(pathsToAttachmentInfo)) {
		if (titleDuplicateChecks.has(attachmentInfo.nameWithExtension)) {
			attachmentInfo.fullLinkPathNeeded = true;
		}

		let parentFolderPath = '';
		if (attachmentsInCurrentFolder) {
			parentFolderPath = normalizePath(
				`${targetFolderPath}${assembleParentIds(
					attachmentInfo,
					idsToFileInfo
				).join('')}${attachmentSubfolder ?? ''}`
			);
		}
		else {
			parentFolderPath = normalizePath(attachmentFolderPath + '/');
		}
		if (!parentFolderPath.endsWith('/')) parentFolderPath += '/';

		if (
			attachmentPaths.has(
				parentFolderPath + attachmentInfo.nameWithExtension
			)
		) {
			let duplicateResolutionIndex = 2;
			const { basename, extension } = parseFilePath(attachmentInfo.path);
			while (
				attachmentPaths.has(
					`${parentFolderPath}${basename} ${duplicateResolutionIndex}.${extension}`
				)
			) {
				duplicateResolutionIndex++;
			}
			attachmentInfo.nameWithExtension = `${basename} ${duplicateResolutionIndex}.${extension}`;
		}

		attachmentInfo.targetParentFolder = parentFolderPath;

		attachmentPaths.add(
			parentFolderPath + attachmentInfo.nameWithExtension
		);
		titleDuplicateChecks.add(attachmentInfo.nameWithExtension);
	}
}
