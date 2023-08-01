import { App, TAbstractFile } from 'obsidian';
import { getFileExtension, stripFileExtension } from '../../util';
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
	for (let [_id, fileInfo] of Object.entries(idsToFileInfo)) {
		let pathDuplicateCheck = `${fileInfo.parentIds.join('/')}/${
			fileInfo.title
		}`;

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
		titleDuplicateChecks.add(fileInfo.title);
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
	const attachmentSubfolder = attachmentFolderPath.match(/\.\/(.*)/)?.[1];

	for (let [_path, attachmentInfo] of Object.entries(pathsToAttachmentInfo)) {
		if (titleDuplicateChecks.has(attachmentInfo.nameWithExtension))
			attachmentInfo.fullLinkPathNeeded = true;
		let thisAttachmentPath = '';

		if (attachmentsInCurrentFolder) {
			thisAttachmentPath = `${targetFolderPath}/${assembleParentIds(
				attachmentInfo,
				idsToFileInfo
			).join('')}/${
				attachmentSubfolder ? attachmentSubfolder[0] + '/' : ''
			}`.replace(/\/\//g, '/');
		} else {
			thisAttachmentPath = attachmentFolderPath;
		}

		if (
			attachmentPaths.has(
				thisAttachmentPath + attachmentInfo.nameWithExtension
			)
		) {
			let duplicateResolutionIndex = 2;
			const name = stripFileExtension(thisAttachmentPath);
			const extension = getFileExtension(
				attachmentInfo.nameWithExtension
			);
			while (
				attachmentPaths.has(
					`${name} ${duplicateResolutionIndex}.${extension}`
				)
			) {
				duplicateResolutionIndex++;
			}
			attachmentInfo.nameWithExtension = `${name} ${duplicateResolutionIndex}.${extension}`;
		}

		attachmentPaths.add(
			thisAttachmentPath + attachmentInfo.nameWithExtension
		);
	}
}
