import { App, TAbstractFile, TFile, normalizePath } from 'obsidian';
import { getFileExtension } from '../../util';
import { stripFileExtension } from '../../util';

export function cleanDuplicates({
	idsToFileInfo,
	pathsToAttachmentInfo,
	attachmentFolderPath,
	app,
}: {
	idsToFileInfo: Record<string, NotionFileInfo>;
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
	attachmentFolderPath: string;
	app: App;
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
		app,
		loadedFiles,
		pathsToAttachmentInfo,
		titleDuplicateChecks,
		attachmentFolderPath,
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

		if (titleDuplicateChecks.has(fileInfo.title)) {
			fileInfo.fullLinkPathNeeded = true;
		}

		pathDuplicateChecks.add(
			`${fileInfo.parentIds.join('/')}/${fileInfo.title}`
		);
		titleDuplicateChecks.add(fileInfo.title);
	}
}

function cleanDuplicateAttachments({
	app,
	loadedFiles,
	pathsToAttachmentInfo,
	titleDuplicateChecks,
	attachmentFolderPath,
}: {
	app: App;
	loadedFiles: TAbstractFile[];
	pathsToAttachmentInfo: Record<string, NotionAttachmentInfo>;
	titleDuplicateChecks: Set<string>;
	attachmentFolderPath: string;
}) {
	const attachmentFiles = new Set(
		loadedFiles
			.filter((file) => file.path.includes(attachmentFolderPath))
			.map((file) => file.name)
	);

	for (let [_path, attachmentInfo] of Object.entries(pathsToAttachmentInfo)) {
		if (titleDuplicateChecks.has(attachmentInfo.title))
			attachmentInfo.fullLinkPathNeeded = true;
		if (attachmentFiles.has(attachmentInfo.title)) {
			let duplicateResolutionIndex = 2;
			const name = stripFileExtension(attachmentInfo.title);
			const extension = getFileExtension(attachmentInfo.title);
			while (
				attachmentFiles.has(
					`${name} ${duplicateResolutionIndex}.${extension}`
				)
			) {
				duplicateResolutionIndex++;
			}
			attachmentInfo.title = `${name} ${duplicateResolutionIndex}.${extension}`;
		}
	}
}
