import { parseFilePath } from 'filesystem';
import { App, TAbstractFile, normalizePath } from 'obsidian';
import { assembleParentIds } from './notion-utils';

export function cleanDuplicates({
	idsToFileInfo,
	pathsToAttachmentInfo,
	attachmentFolderPath,
	app,
	targetFolderPath,
}: {
	idsToFileInfo: Record<string, NotionFileInfo>;
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
	attachmentFolderPath: string;
	app: App;
	targetFolderPath: string;
}) {
	const loadedFiles = app.vault.getAllLoadedFiles();
	const pathDuplicateChecks = new Set<string>();
	const titleDuplicateChecks = new Set<string>(
		loadedFiles.map((file) => file.name)
	);

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
		let pathDuplicateCheck = `${assembleParentIds(
			fileInfo,
			idsToFileInfo
		).join('')}${fileInfo.title}`;

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

	const attachmentsInCurrentFolder = /^\.\//.test(attachmentFolderPath);
	// Obsidian formatting for attachments in subfolders is ./<folder>
	const attachmentSubfolder = attachmentFolderPath.match(/\.\/(.*)/)?.[1];

	for (let attachmentInfo of Object.values(pathsToAttachmentInfo)) {
		if (titleDuplicateChecks.has(attachmentInfo.nameWithExtension))
			attachmentInfo.fullLinkPathNeeded = true;

		let parentFolderPath = '';
		if (attachmentsInCurrentFolder) {
			parentFolderPath = normalizePath(
				`${targetFolderPath}/${assembleParentIds(
					attachmentInfo,
					idsToFileInfo
				).join('')}${
					attachmentSubfolder ? attachmentSubfolder + '/' : ''
				}`
			);
		} else {
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
					`${parentFolderPath}/${basename} ${duplicateResolutionIndex}.${extension}`
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
	}
}
